import type { FastifyInstance } from 'fastify';
import { normalizeOtlpLog } from '../../services/normalizer.js';
import { IngestionService, BackpressureError } from '../../services/ingestion.js';
import { upsertService } from '../../services/service-registry.js';

export default async function otlpLogsRoute(fastify: FastifyInstance) {
  fastify.post('/logs', async (request, reply) => {
    const tenantId = request.tenantId;
    const observedTimestamp = new Date().toISOString();
    const body = request.body as {
      resourceLogs?: Array<{
        resource?: { attributes?: Array<{ key: string; value: { stringValue?: string } }> };
        scopeLogs?: Array<{
          logRecords?: Array<Record<string, unknown>>;
        }>;
      }>;
    };

    if (!body.resourceLogs?.length) {
      return reply.status(200).send({ partialSuccess: {} });
    }

    const ingestion = new IngestionService(fastify.redis, fastify.pg);
    const records = [];
    const serviceNames = new Set<string>();

    for (const resourceLog of body.resourceLogs) {
      const resourceAttributes: Record<string, string> = {};
      for (const attr of resourceLog.resource?.attributes ?? []) {
        if (attr.value.stringValue !== undefined) {
          resourceAttributes[attr.key] = attr.value.stringValue;
        }
      }

      const serviceName = resourceAttributes['service.name'];
      if (serviceName) serviceNames.add(serviceName);

      for (const scopeLog of resourceLog.scopeLogs ?? []) {
        for (const logRecord of scopeLog.logRecords ?? []) {
          records.push(
            normalizeOtlpLog(logRecord, resourceAttributes, tenantId, observedTimestamp),
          );
        }
      }
    }

    try {
      const result = await ingestion.ingest(records);

      for (const serviceName of serviceNames) {
        upsertService(fastify.pg, tenantId, serviceName).catch(() => {});
      }

      return reply.status(200).send({ partialSuccess: { rejectedLogRecords: result.rejected } });
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
