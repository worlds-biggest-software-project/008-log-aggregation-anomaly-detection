import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';

import authPlugin from './plugins/auth.js';
import clickhousePlugin from './plugins/clickhouse.js';
import postgresPlugin from './plugins/postgres.js';
import redisPlugin from './plugins/redis.js';

import ingestRoutes from './routes/ingest/index.js';
import logsRoutes from './routes/logs.js';
import tracesRoutes from './routes/traces.js';
import anomaliesRoutes from './routes/anomalies.js';
import alertsRoutes from './routes/alerts.js';
import servicesRoutes from './routes/services.js';
import adminRoutes from './routes/admin.js';
import aiRoutes from './routes/ai.js';
import deploymentsRoutes from './routes/deployments.js';
import costRoutes from './routes/cost.js';
import notificationsRoutes from './routes/notifications.js';
import logsLiveRoutes from './routes/logs-live.js';

const PORT = parseInt(process.env['PORT'] ?? '4000', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = Fastify({
  logger: {
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport:
      process.env['NODE_ENV'] !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

await app.register(cors, {
  origin: process.env['CORS_ORIGIN'] ?? false,
  credentials: true,
});

await app.register(rateLimit, {
  global: true,
  max: parseInt(process.env['RATE_LIMIT_MAX'] ?? '1000', 10),
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry in ${context.after}.`,
  }),
});

await app.register(sensible);

await app.register(authPlugin);
await app.register(clickhousePlugin);
await app.register(postgresPlugin);
await app.register(redisPlugin);

const API_PREFIX = '/api/v1';

await app.register(ingestRoutes, { prefix: `${API_PREFIX}/ingest` });
await app.register(logsRoutes, { prefix: `${API_PREFIX}/logs` });
await app.register(tracesRoutes, { prefix: `${API_PREFIX}/traces` });
await app.register(anomaliesRoutes, { prefix: `${API_PREFIX}/anomalies` });
await app.register(alertsRoutes, { prefix: `${API_PREFIX}/alerts` });
await app.register(servicesRoutes, { prefix: `${API_PREFIX}/services` });
await app.register(adminRoutes, { prefix: `${API_PREFIX}/admin` });
await app.register(aiRoutes, { prefix: `${API_PREFIX}/ai` });
await app.register(deploymentsRoutes, { prefix: `${API_PREFIX}/deployments` });
await app.register(costRoutes, { prefix: `${API_PREFIX}/cost` });
await app.register(notificationsRoutes, { prefix: `${API_PREFIX}/notifications` });
await app.register(logsLiveRoutes, { prefix: `${API_PREFIX}/logs/live` });

app.get('/health', async (_request, reply) => {
  const checks: Record<string, 'ok' | 'error'> = {};
  let overallOk = true;

  try {
    await app.clickhouse.ping();
    checks['clickhouse'] = 'ok';
  } catch {
    checks['clickhouse'] = 'error';
    overallOk = false;
  }

  try {
    await app.pg.query('SELECT 1');
    checks['postgres'] = 'ok';
  } catch {
    checks['postgres'] = 'error';
    overallOk = false;
  }

  try {
    await app.redis.ping();
    checks['redis'] = 'ok';
  } catch {
    checks['redis'] = 'error';
    overallOk = false;
  }

  const statusCode = overallOk ? 200 : 503;
  return reply.code(statusCode).send({
    status: overallOk ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  });
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Received shutdown signal, closing server');
  try {
    await app.close();
    app.log.info('Server closed gracefully');
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'Error during graceful shutdown');
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.fatal(err, 'Failed to start server');
  process.exit(1);
}
