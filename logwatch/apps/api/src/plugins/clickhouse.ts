import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { ClickHouseClient } from '@clickhouse/client';
import { createClickHouseClient } from '@logwatch/db';

declare module 'fastify' {
  interface FastifyInstance {
    clickhouse: ClickHouseClient;
  }
}

async function clickhousePlugin(fastify: FastifyInstance): Promise<void> {
  const client = createClickHouseClient();

  fastify.decorate('clickhouse', client);

  fastify.addHook('onClose', async () => {
    await client.close();
  });
}

export default fp(clickhousePlugin, { name: 'clickhouse' });
