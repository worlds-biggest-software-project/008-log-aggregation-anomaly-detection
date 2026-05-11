import type { Pool } from 'pg';

export async function upsertService(
  pool: Pool,
  tenantId: string,
  serviceName: string,
  namespace = 'default',
  environment = 'production',
  additionalFields: {
    language?: string;
    host_name?: string;
  } = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO services (tenant_id, name, namespace, environment, language, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, name, namespace, environment)
     DO UPDATE SET last_seen_at = now()
     RETURNING id`,
    [tenantId, serviceName, namespace, environment, additionalFields.language ?? null],
  );
  return result.rows[0]!.id;
}

export async function listServices(
  pool: Pool,
  tenantId: string,
  filters: {
    environment?: string;
    namespace?: string;
    owner_team?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.environment) {
    conditions.push(`environment = $${idx++}`);
    params.push(filters.environment);
  }
  if (filters.namespace) {
    conditions.push(`namespace = $${idx++}`);
    params.push(filters.namespace);
  }
  if (filters.owner_team) {
    conditions.push(`owner_team = $${idx++}`);
    params.push(filters.owner_team);
  }

  const limit = Math.min(filters.limit ?? 50, 1000);
  const offset = filters.offset ?? 0;
  const where = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM services WHERE ${where}`, params),
    pool.query(
      `SELECT * FROM services WHERE ${where} ORDER BY last_seen_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    ),
  ]);

  return {
    data: dataResult.rows,
    pagination: {
      total: countResult.rows[0].total,
      limit,
      offset,
      has_more: offset + limit < countResult.rows[0].total,
    },
  };
}
