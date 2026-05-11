import type { FastifyInstance } from 'fastify';
import { requireViewer } from '../plugins/rbac.js';
import { getTraceById, searchTraces } from '../services/trace-query.js';
import { searchLogs } from '../services/search.js';
import type { TraceSearchParams } from '@logwatch/shared';

export default async function tracesRoutes(fastify: FastifyInstance) {
  // GET / — list traces
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        required: ['from'],
        properties: {
          service: { type: 'string' },
          operation: { type: 'string' },
          status: { type: 'string', enum: ['OK', 'ERROR', 'UNSET'] },
          min_duration_ms: { type: 'number', minimum: 0 },
          max_duration_ms: { type: 'number', minimum: 0 },
          from: { type: 'string' },
          to: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    preHandler: requireViewer,
  }, async (request, reply) => {
    const params = request.query as TraceSearchParams;
    const result = await searchTraces(fastify.clickhouse, request.tenantId, params);
    return reply.send(result);
  });

  // GET /:traceId — get trace detail
  fastify.get('/:traceId', {
    schema: {
      params: {
        type: 'object',
        required: ['traceId'],
        properties: {
          traceId: { type: 'string' },
        },
      },
    },
    preHandler: requireViewer,
  }, async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    const detail = await getTraceById(fastify.clickhouse, request.tenantId, traceId);

    if (!detail) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: `Trace ${traceId} not found`,
      });
    }

    return reply.send(detail);
  });

  // GET /:traceId/logs — get logs associated with a trace
  fastify.get('/:traceId/logs', {
    schema: {
      params: {
        type: 'object',
        required: ['traceId'],
        properties: {
          traceId: { type: 'string' },
        },
      },
    },
    preHandler: requireViewer,
  }, async (request, reply) => {
    const { traceId } = request.params as { traceId: string };
    const result = await searchLogs(fastify.clickhouse, request.tenantId, {
      from: '1970-01-01',
      trace_id: traceId,
      limit: 100,
    });
    return reply.send(result);
  });
}
