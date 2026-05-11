import type { FastifyInstance } from 'fastify';
import { parseSyslog } from '@logwatch/shared';
import { normalizeSyslogToLog } from '../../services/normalizer.js';
import { IngestionService, BackpressureError } from '../../services/ingestion.js';
import { upsertService } from '../../services/service-registry.js';

export default async function syslogRoute(fastify: FastifyInstance) {
  fastify.post('/', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const tenantId = request.tenantId;
    const observedTimestamp = new Date().toISOString();
    const rawBody = typeof request.body === 'string'
      ? request.body
      : Buffer.isBuffer(request.body)
        ? (request.body as Buffer).toString('utf-8')
        : JSON.stringify(request.body);

    const lines = rawBody.split('\n').filter((l) => l.trim());
    const records = [];
    const serviceNames = new Set<string>();

    for (const line of lines) {
      const parsed = parseSyslog(line);
      if (!parsed) continue;

      const record = normalizeSyslogToLog(parsed, tenantId, observedTimestamp);
      records.push(record);
      if (parsed.app_name) serviceNames.add(parsed.app_name);
    }

    if (records.length === 0) {
      return reply.status(202).send({ accepted: 0 });
    }

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
