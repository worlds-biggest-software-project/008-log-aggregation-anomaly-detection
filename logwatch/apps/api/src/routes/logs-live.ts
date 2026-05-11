import type { FastifyInstance } from 'fastify';
import type { OtelLogRecord } from '@logwatch/shared';

const STREAM_KEY = 'logwatch:ingest:logs';

export default async function logsLiveRoute(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const tenantId = request.tenantId;
    const query = request.query as {
      service?: string;
      severity?: string;
      q?: string;
    };

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':\n\n');

    let lastId = '$';
    let closed = false;

    request.raw.on('close', () => {
      closed = true;
    });

    const poll = async () => {
      while (!closed) {
        try {
          const results = await fastify.redis.xread(
            'COUNT',
            '100',
            'BLOCK',
            '2000',
            'STREAMS',
            STREAM_KEY,
            lastId,
          );

          if (!results || closed) continue;

          for (const [, messages] of results) {
            for (const [id, fields] of messages) {
              lastId = id;
              const dataIdx = fields.indexOf('data');
              if (dataIdx === -1 || !fields[dataIdx + 1]) continue;

              let record: OtelLogRecord;
              try {
                record = JSON.parse(fields[dataIdx + 1]!) as OtelLogRecord;
              } catch {
                continue;
              }

              if (record.tenant_id !== tenantId) continue;
              if (query.service && record.service_name !== query.service) continue;
              if (query.severity && record.severity_text !== query.severity) continue;
              if (query.q && !record.body.includes(query.q)) continue;

              reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
            }
          }
        } catch (err) {
          if (!closed) {
            console.error('Live tail error:', err);
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      reply.raw.end();
    };

    poll();
    return reply;
  });
}
