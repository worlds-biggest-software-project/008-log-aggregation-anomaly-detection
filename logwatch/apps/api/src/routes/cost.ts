import type { FastifyInstance } from 'fastify';
import { requireViewer, requireEditor } from '../plugins/rbac.js';
import { SamplingService } from '../services/sampling.js';

export default async function costRoutes(fastify: FastifyInstance) {
  // GET /usage — get usage data
  fastify.get('/usage', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          service_id: { type: 'string', format: 'uuid' },
          from: { type: 'string' },
          to: { type: 'string' },
          granularity: { type: 'string', enum: ['daily'], default: 'daily' },
        },
      },
    },
  }, async (request, reply) => {
    const { service_id, from, to } = request.query as {
      service_id?: string;
      from?: string;
      to?: string;
      granularity?: string;
    };

    const conditions: string[] = ['u.tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (service_id) {
      conditions.push(`u.service_id = $${paramIndex}`);
      params.push(service_id);
      paramIndex++;
    }

    if (from) {
      conditions.push(`u.date >= $${paramIndex}`);
      params.push(from);
      paramIndex++;
    }

    if (to) {
      conditions.push(`u.date <= $${paramIndex}`);
      params.push(to);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await fastify.pg.query(
      `SELECT
        u.id,
        u.tenant_id,
        u.service_id,
        s.name AS service_name,
        u.date,
        u.log_count,
        u.log_bytes,
        u.trace_count,
        u.trace_bytes,
        u.estimated_cost_usd,
        u.created_at
      FROM ingest_usage u
      LEFT JOIN services s ON s.id = u.service_id
      WHERE ${whereClause}
      ORDER BY u.date DESC, s.name ASC`,
      params,
    );

    return reply.send({ data: result.rows });
  });

  // GET /recommendations — list sampling recommendations
  fastify.get('/recommendations', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          service_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['pending', 'applied', 'dismissed'] },
        },
      },
    },
  }, async (request, reply) => {
    const { service_id, status } = request.query as {
      service_id?: string;
      status?: string;
    };

    const conditions: string[] = ['r.tenant_id = $1'];
    const params: unknown[] = [request.tenantId];
    let paramIndex = 2;

    if (service_id) {
      conditions.push(`r.service_id = $${paramIndex}`);
      params.push(service_id);
      paramIndex++;
    }

    if (status) {
      conditions.push(`r.status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const result = await fastify.pg.query(
      `SELECT
        r.id,
        r.tenant_id,
        r.service_id,
        s.name AS service_name,
        r.pattern,
        r.current_volume_daily,
        r.recommended_sample_rate,
        r.estimated_savings_pct,
        r.reasoning,
        r.status,
        r.applied_at,
        r.applied_by,
        r.created_at
      FROM sampling_recommendations r
      LEFT JOIN services s ON s.id = r.service_id
      WHERE ${whereClause}
      ORDER BY r.created_at DESC`,
      params,
    );

    return reply.send({ data: result.rows });
  });

  // POST /recommendations/generate — trigger recommendation generation
  fastify.post('/recommendations/generate', {
    preHandler: requireEditor,
  }, async (request, reply) => {
    const samplingService = new SamplingService(fastify.pg, fastify.clickhouse);
    const recommendations = await samplingService.generateRecommendations(request.tenantId);

    return reply.send({
      data: recommendations,
      count: recommendations.length,
    });
  });

  // POST /recommendations/:id/apply — apply a sampling recommendation
  fastify.post<{ Params: { id: string } }>('/recommendations/:id/apply', {
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
    const samplingService = new SamplingService(fastify.pg, fastify.clickhouse);

    try {
      await samplingService.applyRecommendation(request.tenantId, id, request.userId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Recommendation not found') {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Recommendation not found',
        });
      }
      throw err;
    }

    // Return updated recommendation
    const result = await fastify.pg.query(
      `SELECT r.*, s.name AS service_name
       FROM sampling_recommendations r
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, request.tenantId],
    );

    return reply.send(result.rows[0]);
  });

  // POST /recommendations/:id/dismiss — dismiss a recommendation
  fastify.post<{ Params: { id: string } }>('/recommendations/:id/dismiss', {
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
    const samplingService = new SamplingService(fastify.pg, fastify.clickhouse);

    try {
      await samplingService.dismissRecommendation(request.tenantId, id);
    } catch (err) {
      if (err instanceof Error && err.message === 'Recommendation not found') {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Recommendation not found',
        });
      }
      throw err;
    }

    // Return updated recommendation
    const result = await fastify.pg.query(
      `SELECT r.*, s.name AS service_name
       FROM sampling_recommendations r
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.id = $1 AND r.tenant_id = $2`,
      [id, request.tenantId],
    );

    return reply.send(result.rows[0]);
  });
}
