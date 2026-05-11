import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createPgPool } from '@logwatch/db';

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
  }
}

async function postgresPlugin(fastify: FastifyInstance): Promise<void> {
  const pool = createPgPool();

  fastify.decorate('pg', pool);

  fastify.addHook('onClose', async () => {
    await pool.end();
  });
}

export default fp(postgresPlugin, { name: 'postgres' });
