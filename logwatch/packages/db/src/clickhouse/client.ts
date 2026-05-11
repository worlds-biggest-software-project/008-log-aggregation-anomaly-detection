import { createClient, type ClickHouseClient, type QueryParams } from '@clickhouse/client';

export type { ClickHouseClient };

export function createClickHouseClient(): ClickHouseClient {
  const url = process.env['CLICKHOUSE_URL'];
  const database = process.env['CLICKHOUSE_DATABASE'];
  const username = process.env['CLICKHOUSE_USER'];
  const password = process.env['CLICKHOUSE_PASSWORD'];

  if (!url) throw new Error('CLICKHOUSE_URL environment variable is required');
  if (!database) throw new Error('CLICKHOUSE_DATABASE environment variable is required');

  return createClient({
    url,
    database,
    username: username ?? 'default',
    password: password ?? '',
  });
}

export interface TenantQueryParams {
  tenant_id: string;
  [key: string]: unknown;
}

export async function queryWithTenant<T>(
  client: ClickHouseClient,
  query: string,
  params: TenantQueryParams,
): Promise<T[]> {
  const { tenant_id, ...rest } = params;

  const queryParams: QueryParams = {
    query,
    query_params: { tenant_id, ...rest },
    format: 'JSONEachRow',
  };

  const result = await client.query(queryParams);
  return result.json<T>();
}
