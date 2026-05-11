import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor } from '../plugins/rbac.js';

export default async function alertsRoutes(fastify: FastifyInstance) {
  // GET /rules — list alert rules for tenant
  fastify.get('/rules', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          rule_type: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
        },
      },
    },
  }, async (request, reply) => {
    const { enabled, rule_type, severity } = request.query as {
      enabled?: boolean;
      rule_type?: string;
      severity?: string;
    };

    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex}`);
      params.push(enabled);
      paramIndex++;
    }

    if (rule_type) {
      conditions.push(`rule_type = $${paramIndex}`);
      params.push(rule_type);
      paramIndex++;
    }

    if (severity) {
      conditions.push(`severity = $${paramIndex}`);
      params.push(severity);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await fastify.pg.query(
      `SELECT * FROM alert_rules WHERE ${whereClause} ORDER BY created_at DESC`,
      params,
    );

    return reply.send({ data: result.rows });
  });

  // POST /rules — create an alert rule
  fastify.post('/rules', {
    preHandler: requireEditor,
    schema: {
      body: {
        type: 'object',
        required: ['name', 'rule_type', 'condition', 'notification_channel_ids'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          rule_type: { type: 'string', enum: ['anomaly', 'log_pattern', 'metric_threshold', 'log_absence'] },
          condition: { type: 'object' },
          notification_channel_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'], default: 'warning' },
          evaluation_interval_seconds: { type: 'integer', minimum: 60, maximum: 86400, default: 300 },
          cooldown_minutes: { type: 'integer', minimum: 1, maximum: 1440, default: 60 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const {
      name,
      description,
      rule_type,
      condition,
      notification_channel_ids,
      severity = 'warning',
      evaluation_interval_seconds = 300,
      cooldown_minutes = 60,
    } = request.body as {
      name: string;
      description?: string;
      rule_type: string;
      condition: Record<string, unknown>;
      notification_channel_ids: string[];
      severity?: string;
      evaluation_interval_seconds?: number;
      cooldown_minutes?: number;
    };

    const result = await fastify.pg.query(
      `INSERT INTO alert_rules (
        tenant_id, name, description, rule_type, condition,
        notification_channel_ids, severity, evaluation_interval_seconds,
        cooldown_minutes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        request.tenantId,
        name,
        description ?? null,
        rule_type,
        JSON.stringify(condition),
        notification_channel_ids,
        severity,
        evaluation_interval_seconds,
        cooldown_minutes,
        request.userId,
      ],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // GET /rules/:id — get a single rule
  fastify.get<{ Params: { id: string } }>('/rules/:id', {
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
      'SELECT * FROM alert_rules WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert rule not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /rules/:id — update a rule
  fastify.patch<{ Params: { id: string } }>('/rules/:id', {
    preHandler: requireEditor,
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
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          condition: { type: 'object' },
          notification_channel_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          evaluation_interval_seconds: { type: 'integer', minimum: 60, maximum: 86400 },
          cooldown_minutes: { type: 'integer', minimum: 1, maximum: 1440 },
          mute_until: { type: 'string', format: 'date-time', nullable: true },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body as {
      name?: string;
      description?: string;
      enabled?: boolean;
      condition?: Record<string, unknown>;
      notification_channel_ids?: string[];
      severity?: string;
      evaluation_interval_seconds?: number;
      cooldown_minutes?: number;
      mute_until?: string | null;
    };

    // Verify the rule exists and belongs to this tenant
    const existing = await fastify.pg.query(
      'SELECT id FROM alert_rules WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (existing.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert rule not found',
      });
    }

    // Build dynamic SET clause
    const setClauses: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      params.push(body.name);
      paramIndex++;
    }

    if (body.description !== undefined) {
      setClauses.push(`description = $${paramIndex}`);
      params.push(body.description);
      paramIndex++;
    }

    if (body.enabled !== undefined) {
      setClauses.push(`enabled = $${paramIndex}`);
      params.push(body.enabled);
      paramIndex++;
    }

    if (body.condition !== undefined) {
      setClauses.push(`condition = $${paramIndex}`);
      params.push(JSON.stringify(body.condition));
      paramIndex++;
    }

    if (body.notification_channel_ids !== undefined) {
      setClauses.push(`notification_channel_ids = $${paramIndex}`);
      params.push(body.notification_channel_ids);
      paramIndex++;
    }

    if (body.severity !== undefined) {
      setClauses.push(`severity = $${paramIndex}`);
      params.push(body.severity);
      paramIndex++;
    }

    if (body.evaluation_interval_seconds !== undefined) {
      setClauses.push(`evaluation_interval_seconds = $${paramIndex}`);
      params.push(body.evaluation_interval_seconds);
      paramIndex++;
    }

    if (body.cooldown_minutes !== undefined) {
      setClauses.push(`cooldown_minutes = $${paramIndex}`);
      params.push(body.cooldown_minutes);
      paramIndex++;
    }

    if (body.mute_until !== undefined) {
      setClauses.push(`mute_until = $${paramIndex}`);
      params.push(body.mute_until);
      paramIndex++;
    }

    params.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const updateQuery = `
      UPDATE alert_rules
      SET ${setClauses.join(', ')}
      WHERE id = $${idIndex} AND tenant_id = $${tenantIndex}
      RETURNING *
    `;

    const result = await fastify.pg.query(updateQuery, params);

    return reply.send(result.rows[0]);
  });

  // DELETE /rules/:id — delete a rule
  fastify.delete<{ Params: { id: string } }>('/rules/:id', {
    preHandler: requireEditor,
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
      'DELETE FROM alert_rules WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert rule not found',
      });
    }

    return reply.code(204).send();
  });

  // POST /rules/:id/mute — mute a rule
  fastify.post<{ Params: { id: string } }>('/rules/:id/mute', {
    preHandler: requireEditor,
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
        required: ['duration_minutes'],
        properties: {
          duration_minutes: { type: 'integer', minimum: 1, maximum: 43200 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { duration_minutes } = request.body as { duration_minutes: number };

    const result = await fastify.pg.query(
      `UPDATE alert_rules
       SET mute_until = NOW() + ($3 || ' minutes')::interval, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, request.tenantId, duration_minutes.toString()],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert rule not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // DELETE /rules/:id/mute — unmute a rule
  fastify.delete<{ Params: { id: string } }>('/rules/:id/mute', {
    preHandler: requireEditor,
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
      `UPDATE alert_rules
       SET mute_until = NULL, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert rule not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // GET /events — list alert events for tenant
  fastify.get('/events', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          alert_rule_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['firing', 'resolved'] },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const {
      alert_rule_id,
      status,
      from,
      to,
      limit = 50,
      offset = 0,
    } = request.query as {
      alert_rule_id?: string;
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    };

    const conditions: string[] = ['e.tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (alert_rule_id) {
      conditions.push(`e.alert_rule_id = $${paramIndex}`);
      params.push(alert_rule_id);
      paramIndex++;
    }

    if (status) {
      conditions.push(`e.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (from) {
      conditions.push(`e.fired_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`e.fired_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) AS total FROM alert_events e WHERE ${whereClause}`;
    const dataQuery = `
      SELECT
        e.*,
        r.name AS rule_name
      FROM alert_events e
      LEFT JOIN alert_rules r ON r.id = e.alert_rule_id
      WHERE ${whereClause}
      ORDER BY e.fired_at DESC
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

  // GET /events/:id — get a single alert event
  fastify.get<{ Params: { id: string } }>('/events/:id', {
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
      'SELECT * FROM alert_events WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Alert event not found',
      });
    }

    return reply.send(result.rows[0]);
  });
}
