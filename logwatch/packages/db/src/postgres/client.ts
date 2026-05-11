import pg from 'pg';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

export type PgPool = pg.Pool;

export function createPgPool(): PgPool {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  return new Pool({ connectionString });
}

export async function withTenant<T>(
  pool: PgPool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = $1`, [tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
