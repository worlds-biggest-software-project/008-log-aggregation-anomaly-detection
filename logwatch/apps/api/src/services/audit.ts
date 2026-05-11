import type { Pool } from 'pg';

export interface AuditEntry {
  tenant_id: string;
  actor_id: string | null;
  actor_type: 'user' | 'api_key' | 'system';
  action: 'create' | 'update' | 'delete';
  resource_type: string;
  resource_id: string | null;
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  ip_address: string | null;
  user_agent: string | null;
}

export async function recordAuditEvent(pool: Pool, entry: AuditEntry): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (tenant_id, actor_id, actor_type, action, resource_type, resource_id, changes, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      entry.tenant_id,
      entry.actor_id,
      entry.actor_type,
      entry.action,
      entry.resource_type,
      entry.resource_id,
      entry.changes ? JSON.stringify(entry.changes) : null,
      entry.ip_address,
      entry.user_agent,
    ],
  );
}

export async function queryAuditLog(
  pool: Pool,
  tenantId: string,
  filters: {
    action?: string;
    resource_type?: string;
    actor_id?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let idx = 2;

  if (filters.action) {
    conditions.push(`action = $${idx++}`);
    params.push(filters.action);
  }
  if (filters.resource_type) {
    conditions.push(`resource_type = $${idx++}`);
    params.push(filters.resource_type);
  }
  if (filters.actor_id) {
    conditions.push(`actor_id = $${idx++}`);
    params.push(filters.actor_id);
  }
  if (filters.from) {
    conditions.push(`created_at >= $${idx++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= $${idx++}`);
    params.push(filters.to);
  }

  const limit = Math.min(filters.limit ?? 50, 1000);
  const offset = filters.offset ?? 0;

  const where = conditions.join(' AND ');

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM audit_log WHERE ${where}`, params),
    pool.query(
      `SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
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
