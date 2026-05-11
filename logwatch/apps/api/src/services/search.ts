import type { ClickHouseClient } from '@clickhouse/client';
import type { LogSearchParams, LogSearchResult, OtelLogRecord } from '@logwatch/shared';

export async function searchLogs(
  ch: ClickHouseClient,
  tenantId: string,
  params: LogSearchParams,
): Promise<LogSearchResult> {
  const conditions = ['tenant_id = {tenantId:String}'];
  const queryParams: Record<string, string | number> = { tenantId };

  conditions.push('timestamp >= {from:String}');
  queryParams.from = params.from;

  if (params.to) {
    conditions.push('timestamp <= {to:String}');
    queryParams.to = params.to;
  }

  if (params.q) {
    conditions.push('hasToken(body, {q:String})');
    queryParams.q = params.q;
  }

  if (params.service) {
    conditions.push("resource_string['service.name'] = {service:String}");
    queryParams.service = params.service;
  }

  if (params.severity) {
    conditions.push('severity_text = {severity:String}');
    queryParams.severity = params.severity;
  }

  if (params.trace_id) {
    conditions.push('trace_id = {traceId:String}');
    queryParams.traceId = params.trace_id;
  }

  if (params.attributes) {
    const [key, value] = params.attributes.split(':');
    if (key && value) {
      conditions.push(`attributes_string[{attrKey:String}] = {attrVal:String}`);
      queryParams.attrKey = key;
      queryParams.attrVal = value;
    }
  }

  const limit = Math.min(params.limit ?? 50, 1000);
  const offset = params.offset ?? 0;
  const sortDir = params.sort === 'timestamp_asc' ? 'ASC' : 'DESC';
  const where = conditions.join(' AND ');

  const countQuery = `SELECT count() AS total FROM otel_logs WHERE ${where}`;
  const dataQuery = `SELECT * FROM otel_logs WHERE ${where} ORDER BY timestamp ${sortDir} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

  const [countResult, dataResult] = await Promise.all([
    ch.query({
      query: countQuery,
      query_params: queryParams,
      format: 'JSONEachRow',
    }),
    ch.query({
      query: dataQuery,
      query_params: { ...queryParams, limit, offset },
      format: 'JSONEachRow',
    }),
  ]);

  const countRows = await countResult.json<{ total: string }>();
  const total = parseInt(countRows[0]?.total ?? '0', 10);
  const data = await dataResult.json<OtelLogRecord>();

  return {
    data,
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}
