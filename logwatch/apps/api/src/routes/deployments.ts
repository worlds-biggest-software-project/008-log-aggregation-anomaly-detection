import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor } from '../plugins/rbac.js';

export default async function deploymentsRoutes(fastify: FastifyInstance) {
  // POST / — record a deployment
  fastify.post('/', {
    preHandler: requireEditor,
    schema: {
      body: {
        type: 'object',
        required: ['service_id', 'version'],
        properties: {
          service_id: { type: 'string', format: 'uuid' },
          version: { type: 'string' },
          commit_sha: { type: 'string' },
          deployer: { type: 'string' },
          changelog: { type: 'string' },
          deployed_at: { type: 'string', format: 'date-time' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      service_id,
      version,
      commit_sha,
      deployer,
      changelog,
      deployed_at,
    } = request.body as {
      service_id: string;
      version: string;
      commit_sha?: string;
      deployer?: string;
      changelog?: string;
      deployed_at?: string;
    };

    const result = await fastify.pg.query(
      `INSERT INTO deployments (
        tenant_id, service_id, version, commit_sha, deployer, changelog, deployed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        request.tenantId,
        service_id,
        version,
        commit_sha ?? null,
        deployer ?? null,
        changelog ?? null,
        deployed_at ?? new Date().toISOString(),
      ],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // GET / — list deployments
  fastify.get('/', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          service_id: { type: 'string', format: 'uuid' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const {
      service_id,
      from,
      to,
      limit = 50,
      offset = 0,
    } = request.query as {
      service_id?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    };

    const conditions: string[] = ['d.tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (service_id) {
      conditions.push(`d.service_id = $${paramIndex}`);
      params.push(service_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`d.deployed_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`d.deployed_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) AS total FROM deployments d WHERE ${whereClause}`;
    const dataQuery = `
      SELECT
        d.*,
        s.name AS service_name
      FROM deployments d
      LEFT JOIN services s ON s.id = d.service_id
      WHERE ${whereClause}
      ORDER BY d.deployed_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataParams = [...params, limit, offset];

    const [countResult, dataResult] = await Promise.all([
      fastify.pg.query(countQuery, params),
      fastify.pg.query(dataQuery, dataParams),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return reply.send({
      data: dataResult.rows,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  });

  // GET /:id — get single deployment
  fastify.get<{ Params: { id: string } }>('/:id', {
    preHandler: requireViewer,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await fastify.pg.query(
      `SELECT d.*, s.name AS service_name
       FROM deployments d
       LEFT JOIN services s ON s.id = d.service_id
       WHERE d.id = $1 AND d.tenant_id = $2`,
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Deployment not found',
      });
    }

    return reply.send(result.rows[0]);
  });
}
