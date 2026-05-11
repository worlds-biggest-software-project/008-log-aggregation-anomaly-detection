import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor, requireAdmin } from '../plugins/rbac.js';

export default async function adminRoutes(fastify: FastifyInstance) {
  /* ================================================================== */
  /*  Tenant Settings                                                   */
  /* ================================================================== */

  // GET /settings — retrieve tenant settings
  fastify.get('/settings', {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const result = await fastify.pg.query(
      'SELECT * FROM tenants WHERE id = $1',
      [request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Tenant not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /settings — update tenant settings
  fastify.patch('/settings', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          settings: { type: 'object' },
          retention_config: { type: 'object' },
          max_ingest_gb_month: { type: 'number' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as {
      name?: string;
      settings?: Record<string, unknown>;
      retention_config?: Record<string, unknown>;
      max_ingest_gb_month?: number;
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      params.push(body.name);
      paramIndex++;
    }

    if (body.settings !== undefined) {
      setClauses.push(`settings = $${paramIndex}`);
      params.push(JSON.stringify(body.settings));
      paramIndex++;
    }

    if (body.retention_config !== undefined) {
      setClauses.push(`retention_config = $${paramIndex}`);
      params.push(JSON.stringify(body.retention_config));
      paramIndex++;
    }

    if (body.max_ingest_gb_month !== undefined) {
      setClauses.push(`max_ingest_gb_month = $${paramIndex}`);
      params.push(body.max_ingest_gb_month);
      paramIndex++;
    }

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const result = await fastify.pg.query(
      `UPDATE tenants SET ${setClauses.join(', ')} WHERE id = $${tenantIndex} RETURNING *`,
      params,
    );

    return reply.send(result.rows[0]);
  });

  /* ================================================================== */
  /*  User Management                                                   */
  /* ================================================================== */

  // GET /users — list users for tenant
  fastify.get('/users', {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const result = await fastify.pg.query(
      'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at',
      [request.tenantId],
    );

    return reply.send({ data: result.rows });
  });

  // POST /users — create a user
  fastify.post('/users', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['email', 'role'],
        properties: {
          email: { type: 'string', format: 'email' },
          display_name: { type: 'string' },
          role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { email, display_name, role } = request.body as {
      email: string;
      display_name?: string;
      role: string;
    };

    const result = await fastify.pg.query(
      `INSERT INTO users (tenant_id, email, display_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [request.tenantId, email, display_name ?? null, role],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // PATCH /users/:id — update a user
  fastify.patch<{ Params: { id: string } }>('/users/:id', {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          display_name: { type: 'string' },
          role: { type: 'string', enum: ['viewer', 'editor', 'admin'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      display_name?: string;
      role?: string;
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (body.display_name !== undefined) {
      setClauses.push(`display_name = $${paramIndex}`);
      params.push(body.display_name);
      paramIndex++;
    }

    if (body.role !== undefined) {
      setClauses.push(`role = $${paramIndex}`);
      params.push(body.role);
      paramIndex++;
    }

    params.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const result = await fastify.pg.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idIndex} AND tenant_id = $${tenantIndex} RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // DELETE /users/:id — delete a user
  fastify.delete<{ Params: { id: string } }>('/users/:id', {
    preHandler: requireAdmin,
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

    // Prevent self-deletion
    if (request.userId === id) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Cannot delete your own account',
      });
    }

    const result = await fastify.pg.query(
      'DELETE FROM users WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'User not found',
      });
    }

    return reply.code(204).send();
  });

  /* ================================================================== */
  /*  API Key Management                                                */
  /* ================================================================== */

  // GET /api-keys — list API keys for tenant
  fastify.get('/api-keys', {
    preHandler: requireAdmin,
  }, async (request, reply) => {
    const result = await fastify.pg.query(
      'SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC',
      [request.tenantId],
    );

    return reply.send({ data: result.rows });
  });

  // POST /api-keys — create an API key
  fastify.post('/api-keys', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'scopes'],
        properties: {
          name: { type: 'string' },
          scopes: {
            type: 'array',
            items: { type: 'string', enum: ['ingest', 'query', 'alerts', 'admin'] },
            minItems: 1,
          },
          expires_at: { type: 'string', format: 'date-time', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, scopes, expires_at } = request.body as {
      name: string;
      scopes: string[];
      expires_at?: string;
    };

    const crypto = await import('crypto');
    const rawKey = crypto.randomBytes(32).toString('hex');
    const prefix = rawKey.slice(0, 8);
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const result = await fastify.pg.query(
      `INSERT INTO api_keys (tenant_id, created_by, name, key_prefix, key_hash, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [request.tenantId, request.userId, name, prefix, hash, scopes, expires_at ?? null],
    );

    return reply.code(201).send({
      ...result.rows[0],
      raw_key: rawKey,
    });
  });

  // DELETE /api-keys/:id — revoke an API key
  fastify.delete<{ Params: { id: string } }>('/api-keys/:id', {
    preHandler: requireAdmin,
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
      'DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'API key not found',
      });
    }

    return reply.code(204).send();
  });

  /* ================================================================== */
  /*  Redaction Rules                                                    */
  /* ================================================================== */

  // GET /redaction-rules — list redaction rules for tenant
  fastify.get('/redaction-rules', {
    preHandler: requireViewer,
  }, async (request, reply) => {
    const result = await fastify.pg.query(
      'SELECT * FROM redaction_rules WHERE tenant_id = $1',
      [request.tenantId],
    );

    return reply.send({ data: result.rows });
  });

  // POST /redaction-rules — create a redaction rule
  fastify.post('/redaction-rules', {
    preHandler: requireAdmin,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'pattern', 'replacement', 'applies_to'],
        properties: {
          name: { type: 'string' },
          pattern: { type: 'string' },
          replacement: { type: 'string' },
          applies_to: { type: 'string', enum: ['body', 'attributes', 'all'] },
          enabled: { type: 'boolean', default: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { name, pattern, replacement, applies_to, enabled = true } = request.body as {
      name: string;
      pattern: string;
      replacement: string;
      applies_to: string;
      enabled?: boolean;
    };

    const result = await fastify.pg.query(
      `INSERT INTO redaction_rules (tenant_id, name, rule_type, pattern, replacement, applies_to, enabled, created_by)
       VALUES ($1, $2, 'custom', $3, $4, $5, $6, $7)
       RETURNING *`,
      [request.tenantId, name, pattern, replacement, applies_to, enabled, request.userId],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // PATCH /redaction-rules/:id — update a redaction rule
  fastify.patch<{ Params: { id: string } }>('/redaction-rules/:id', {
    preHandler: requireAdmin,
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pattern: { type: 'string' },
          replacement: { type: 'string' },
          applies_to: { type: 'string', enum: ['body', 'attributes', 'all'] },
          enabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      name?: string;
      pattern?: string;
      replacement?: string;
      applies_to?: string;
      enabled?: boolean;
    };

    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      params.push(body.name);
      paramIndex++;
    }

    if (body.pattern !== undefined) {
      setClauses.push(`pattern = $${paramIndex}`);
      params.push(body.pattern);
      paramIndex++;
    }

    if (body.replacement !== undefined) {
      setClauses.push(`replacement = $${paramIndex}`);
      params.push(body.replacement);
      paramIndex++;
    }

    if (body.applies_to !== undefined) {
      setClauses.push(`applies_to = $${paramIndex}`);
      params.push(body.applies_to);
      paramIndex++;
    }

    if (body.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex}`);
      params.push(body.enabled);
      paramIndex++;
    }

    params.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const result = await fastify.pg.query(
      `UPDATE redaction_rules SET ${setClauses.join(', ')} WHERE id = $${idIndex} AND tenant_id = $${tenantIndex} RETURNING *`,
      params,
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Redaction rule not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // DELETE /redaction-rules/:id — delete a redaction rule
  fastify.delete<{ Params: { id: string } }>('/redaction-rules/:id', {
    preHandler: requireAdmin,
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

    await fastify.pg.query(
      'DELETE FROM redaction_rules WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    return reply.code(204).send();
  });

  /* ================================================================== */
  /*  Audit Log                                                         */
  /* ================================================================== */

  // GET /audit-log — stub for future audit trail
  fastify.get('/audit-log', {
    preHandler: requireAdmin,
  }, async (_request, reply) => {
    return reply.send({ data: [], message: 'Audit log not yet populated' });
  });
}
