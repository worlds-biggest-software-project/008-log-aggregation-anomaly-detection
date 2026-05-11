import type { FastifyInstance } from 'fastify';
import { requireViewer } from '../plugins/rbac.js';
import { listServices } from '../services/service-registry.js';

export default async function servicesRoutes(fastify: FastifyInstance) {
  // GET / — list services for tenant
  fastify.get('/', {
    preHandler: requireViewer,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          environment: { type: 'string' },
          namespace: { type: 'string' },
          owner_team: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { environment, namespace, owner_team, limit, offset } = request.query as {
      environment?: string;
      namespace?: string;
      owner_team?: string;
      limit?: number;
      offset?: number;
    };

    const result = await listServices(fastify.pg, request.tenantId, {
      environment,
      namespace,
      owner_team,
      limit,
      offset,
    });

    return reply.send(result);
  });

  // GET /:id — get single service
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
      'SELECT * FROM services WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Service not found',
      });
    }

    return reply.send(result.rows[0]);
  });

  // GET /:id/baselines — get anomaly baselines for a service
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

    // Verify the service exists and belongs to this tenant
    const serviceResult = await fastify.pg.query(
      'SELECT id, name FROM services WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (serviceResult.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Service not found',
      });
    }

    const baselinesResult = await fastify.pg.query(
      `SELECT metric_name, baseline_mean, baseline_stddev, baseline_p50, baseline_p95, baseline_p99,
              hourly_pattern, dow_pattern, sample_count, last_updated_at
       FROM anomaly_baselines
       WHERE tenant_id = $1 AND service_id = $2
       ORDER BY metric_name`,
      [request.tenantId, id],
    );

    return reply.send({
      service: serviceResult.rows[0],
      baselines: baselinesResult.rows,
    });
  });

  // GET /:id/dependencies — get service dependencies
  fastify.get<{ Params: { id: string } }>('/:id/dependencies', {
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

    // Verify the service exists and belongs to this tenant
    const serviceResult = await fastify.pg.query(
      'SELECT id FROM services WHERE id = $1 AND tenant_id = $2',
      [id, request.tenantId],
    );

    if (serviceResult.rows.length === 0) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: 'Service not found',
      });
    }

    const [outgoingResult, incomingResult] = await Promise.all([
      fastify.pg.query(
        `SELECT
          sd.id,
          sd.target_service_id,
          s.name AS target_service_name,
          sd.dependency_type,
          sd.discovered_from,
          sd.call_count_24h,
          sd.avg_duration_ms,
          sd.error_rate_24h,
          sd.last_seen_at
        FROM service_dependencies sd
        JOIN services s ON s.id = sd.target_service_id
        WHERE sd.source_service_id = $1 AND sd.tenant_id = $2
        ORDER BY sd.call_count_24h DESC`,
        [id, request.tenantId],
      ),
      fastify.pg.query(
        `SELECT
          sd.id,
          sd.source_service_id,
          s.name AS source_service_name,
          sd.dependency_type,
          sd.discovered_from,
          sd.call_count_24h,
          sd.avg_duration_ms,
          sd.error_rate_24h,
          sd.last_seen_at
        FROM service_dependencies sd
        JOIN services s ON s.id = sd.source_service_id
        WHERE sd.target_service_id = $1 AND sd.tenant_id = $2
        ORDER BY sd.call_count_24h DESC`,
        [id, request.tenantId],
      ),
    ]);

    return reply.send({
      outgoing: outgoingResult.rows,
      incoming: incomingResult.rows,
    });
  });
}
