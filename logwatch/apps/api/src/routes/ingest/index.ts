import type { FastifyInstance } from 'fastify';
import otlpLogsRoute from './otlp-logs.js';
import syslogRoute from './syslog.js';
import jsonIngestRoute from './json.js';

export default async function ingestRoutes(fastify: FastifyInstance) {
  await fastify.register(otlpLogsRoute, { prefix: '/otlp' });
  await fastify.register(syslogRoute, { prefix: '/syslog' });
  await fastify.register(jsonIngestRoute, { prefix: '/json' });
}
