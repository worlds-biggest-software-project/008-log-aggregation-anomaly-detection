import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { UserRole } from '@logwatch/shared';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string;
    userRole: UserRole;
  }
}

interface JwtPayload {
  tenant_id: string;
  sub: string;
  role: UserRole;
}

interface ApiKeyRow {
  id: string;
  tenant_id: string;
  key_hash: string;
  scopes: string[];
  expires_at: string | null;
}

const INGEST_PATH_PREFIX = '/api/v1/ingest/';
const HEALTH_PATH = '/health';

const AUTH_SKIPPED_PATHS = new Set([HEALTH_PATH]);

function isIngestPath(url: string): boolean {
  return url.startsWith(INGEST_PATH_PREFIX) || url === '/api/v1/ingest';
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('tenantId', '');
  fastify.decorateRequest('userId', '');
  fastify.decorateRequest('userRole', 'viewer' as UserRole);

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const { url } = request;

    if (AUTH_SKIPPED_PATHS.has(url.split('?')[0] ?? '')) {
      return;
    }

    const authHeader = request.headers['authorization'];
    const apiKeyHeader = request.headers['x-api-key'];

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const secret = process.env['JWT_SECRET'] ?? process.env['NEXTAUTH_SECRET'] ?? '';

      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, secret) as JwtPayload;
      } catch {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' });
      }

      if (!payload.tenant_id || !payload.sub) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Token missing required claims' });
      }

      request.tenantId = payload.tenant_id;
      request.userId = payload.sub;
      request.userRole = payload.role ?? 'viewer';
      return;
    }

    if (apiKeyHeader && isIngestPath(url.split('?')[0] ?? '')) {
      const rawKey = apiKeyHeader as string;
      const prefix = rawKey.slice(0, 8);

      let row: ApiKeyRow | undefined;
      try {
        const result = await fastify.pg.query<ApiKeyRow>(
          `SELECT id, tenant_id, key_hash, scopes, expires_at
             FROM api_keys
            WHERE key_prefix = $1
            LIMIT 1`,
          [prefix],
        );
        row = result.rows[0];
      } catch (err) {
        fastify.log.error(err, 'api_keys lookup failed');
        return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Auth check failed' });
      }

      if (!row) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' });
      }

      if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'API key expired' });
      }

      const valid = await bcrypt.compare(rawKey, row.key_hash);
      if (!valid) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid API key' });
      }

      const routeScope = 'ingest';
      if (!row.scopes.includes(routeScope)) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'API key lacks required scope' });
      }

      request.tenantId = row.tenant_id;
      request.userId = '';
      request.userRole = 'viewer';

      fastify.pg
        .query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id])
        .catch((err) => fastify.log.warn(err, 'Failed to update last_used_at for api key'));

      return;
    }

    return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing authentication' });
  });
}

export default fp(authPlugin, { name: 'auth' });
