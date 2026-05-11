import type { FastifyInstance } from 'fastify';
import type { IngestRequest } from '@logwatch/shared';
import { normalizeJsonLog } from '../../services/normalizer.js';
import { IngestionService, BackpressureError } from '../../services/ingestion.js';
import { upsertService } from '../../services/service-registry.js';

export default async function jsonIngestRoute(fastify: FastifyInstance) {
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['logs'],
        properties: {
          logs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['body'],
              properties: {
                timestamp: { type: 'string' },
                severity: { type: 'string' },
                body: { type: 'string' },
                service: { type: 'string' },
                attributes: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId;
    const observedTimestamp = new Date().toISOString();
    const { logs } = request.body as IngestRequest;

    const records = logs.map((input) =>
      normalizeJsonLog(input, tenantId, observedTimestamp),
    );

    const serviceNames = new Set(
      logs.filter((l) => l.service).map((l) => l.service!),
    );

    const ingestion = new IngestionService(fastify.redis, fastify.pg);

    try {
      const result = await ingestion.ingest(records);

      for (const serviceName of serviceNames) {
        upsertService(fastify.pg, tenantId, serviceName).catch(() => {});
      }

      return reply.status(202).send({ accepted: result.accepted });
    } catch (err) {
      if (err instanceof BackpressureError) {
        return reply.status(429).send({
          error: { code: 'BACKPRESSURE', message: 'Ingestion buffer full. Retry later.' },
        });
      }
      throw err;
    }
  });
}
