import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor } from '../plugins/rbac.js';

export default async function anomaliesRoutes(fastify: FastifyInstance) {
  // GET / — list anomalies for tenant
  fastify.get('/', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'false_positive'] },
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          service_id: { type: 'string', format: 'uuid' },
          anomaly_type: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const {
      status,
      severity,
      service_id,
      anomaly_type,
      from,
      to,
      limit = 50,
      offset = 0,
    } = request.query as {
      status?: string;
      severity?: string;
      service_id?: string;
      anomaly_type?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    };

    const conditions: string[] = ['a.tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`a.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    if (severity) {
      conditions.push(`a.severity = $${paramIndex}`);
      params.push(severity);
      paramIndex++;
    }

    if (service_id) {
      conditions.push(`a.service_id = $${paramIndex}`);
      params.push(service_id);
      paramIndex++;
    }

    if (anomaly_type) {
      conditions.push(`a.anomaly_type = $${paramIndex}`);
      params.push(anomaly_type);
      paramIndex++;
    }

    if (from) {
      conditions.push(`a.detected_at >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`a.detected_at <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countQuery = `SELECT COUNT(*) AS total FROM anomalies a WHERE ${whereClause}`;
    const dataQuery = `
      SELECT
        a.*,
        s.name AS service_name
      FROM anomalies a
      LEFT JOIN services s ON s.id = a.service_id
      WHERE ${whereClause}
      ORDER BY a.detected_at DESC
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

  // GET /:id — get anomaly detail
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
      'SELECT * FROM anomalies WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Anomaly not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // PATCH /:id — update anomaly status/feedback
  fastify.patch<{ Params: { id: string } }>('/:id', {
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
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'false_positive'] },
          user_feedback: { type: 'string', enum: ['helpful', 'not_helpful', 'false_positive'] },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { status, user_feedback } = request.body as {
      status?: string;
      user_feedback?: string;
    };

    // Verify the anomaly exists and belongs to this tenant
    const existing = await fastify.pg.query(
      'SELECT id FROM anomalies WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (existing.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Anomaly not found',
      });
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      if (status === 'resolved') {
        setClauses.push(`resolved_at = NOW()`);
        setClauses.push(`resolved_by = $${paramIndex}`);
        params.push(request.userId);
        paramIndex++;
      }
    }

    if (user_feedback !== undefined) {
      setClauses.push(`user_feedback = $${paramIndex}`);
      params.push(user_feedback);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      // Nothing to update — return the existing row
      const current = await fastify.pg.query(
        'SELECT * FROM anomalies WHERE id = $1 AND tenant_id = $2',
        [id, request.tenantId],
      );
      return reply.send(current.rows[0]);
    }

    params.push(id);
    const idIndex = paramIndex;
    paramIndex++;

    params.push(request.tenantId);
    const tenantIndex = paramIndex;

    const updateQuery = `
      UPDATE anomalies
      SET ${setClauses.join(', ')}
      WHERE id = $${idIndex} AND tenant_id = $${tenantIndex}
      RETURNING *
    `;

    const result = await fastify.pg.query(updateQuery, params);

    return reply.send(result.rows[0]);
  });

  // GET /:id/baselines — get baselines for the anomaly's service
  fastify.get<{ Params: { id: string } }>('/:id/baselines', {
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

    // Fetch the anomaly to get its service_id
    const anomalyResult = await fastify.pg.query(
      'SELECT service_id FROM anomalies WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (anomalyResult.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Anomaly not found',
      });
    }

    const { service_id } = anomalyResult.rows[0];

    const baselinesResult = await fastify.pg.query(
      'SELECT * FROM anomaly_baselines WHERE tenant_id = $1 AND service_id = $2',
      [request.tenantId, service_id],
    );

    return reply.send({ baselines: baselinesResult.rows });
  });
}
