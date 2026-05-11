import type { FastifyInstance } from 'fastify';
import type { LogSearchParams } from '@logwatch/shared';
import { searchLogs } from '../services/search.js';

export default async function logsRoute(fastify: FastifyInstance) {
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        required: ['from'],
        properties: {
          q: { type: 'string' },
          service: { type: 'string' },
          severity: { type: 'string', enum: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] },
          from: { type: 'string' },
          to: { type: 'string' },
          trace_id: { type: 'string' },
          attributes: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          sort: { type: 'string', enum: ['timestamp_asc', 'timestamp_desc'], default: 'timestamp_desc' },
        },
      },
    },
  }, async (request, reply) => {
    const params = request.query as LogSearchParams;
    const result = await searchLogs(fastify.clickhouse, request.tenantId, params);
    return reply.send(result);
  });
}
