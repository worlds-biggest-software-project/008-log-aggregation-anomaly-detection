import type { ClickHouseClient } from '@clickhouse/client';
import type { TraceSpan, TraceDetail, TraceSummary, TraceSearchParams } from '@logwatch/shared';

export async function getTraceById(
  ch: ClickHouseClient,
  tenantId: string,
  traceId: string,
): Promise<TraceDetail | null> {
  const result = await ch.query({
    query: `SELECT * FROM otel_traces WHERE tenant_id = {tenantId:String} AND trace_id = {traceId:String} ORDER BY start_time ASC`,
    query_params: { tenantId, traceId },
    format: 'JSONEachRow',
  });

  const spans = await result.json<TraceSpan>();

  if (spans.length === 0) {
    return null;
  }

  let minStart = BigInt(new Date(spans[0]!.start_time).getTime()) * 1_000_000n;
  let maxEnd = BigInt(new Date(spans[0]!.end_time).getTime()) * 1_000_000n;
  const serviceSet = new Set<string>();

  for (const span of spans) {
    const startNs = BigInt(new Date(span.start_time).getTime()) * 1_000_000n;
    const endNs = BigInt(new Date(span.end_time).getTime()) * 1_000_000n;
    if (startNs < minStart) minStart = startNs;
    if (endNs > maxEnd) maxEnd = endNs;
    serviceSet.add(span.service_name);
  }

  const durationMs = Number(maxEnd - minStart) / 1e6;

  return {
    trace_id: traceId,
    span_count: spans.length,
    duration_ms: durationMs,
    services: [...serviceSet],
    spans,
  };
}

export async function searchTraces(
  ch: ClickHouseClient,
  tenantId: string,
  params: TraceSearchParams,
): Promise<{ data: TraceSummary[]; pagination: { total: number; limit: number; offset: number; has_more: boolean } }> {
  const conditions = ['tenant_id = {tenantId:String}'];
  const queryParams: Record<string, string | number> = { tenantId };

  conditions.push('start_time >= {from:String}');
  queryParams.from = params.from;

  if (params.to) {
    conditions.push('start_time <= {to:String}');
    queryParams.to = params.to;
  }

  if (params.service) {
    conditions.push('service_name = {service:String}');
    queryParams.service = params.service;
  }

  if (params.operation) {
    conditions.push('operation_name = {operation:String}');
    queryParams.operation = params.operation;
  }

  if (params.status) {
    conditions.push('status_code = {status:String}');
    queryParams.status = params.status;
  }

  const where = conditions.join(' AND ');

  const havingConditions: string[] = [];
  if (params.min_duration_ms != null) {
    havingConditions.push('duration_ms >= {minDuration:Float64}');
    queryParams.minDuration = params.min_duration_ms;
  }
  if (params.max_duration_ms != null) {
    havingConditions.push('duration_ms <= {maxDuration:Float64}');
    queryParams.maxDuration = params.max_duration_ms;
  }

  const havingClause = havingConditions.length > 0 ? `HAVING ${havingConditions.join(' AND ')}` : '';

  const limit = Math.min(params.limit ?? 50, 1000);
  const offset = params.offset ?? 0;

  const innerQuery = `
    SELECT
      trace_id,
      min(start_time) AS start_time,
      count() AS span_count,
      (toUnixTimestamp64Nano(max(end_time)) - toUnixTimestamp64Nano(min(start_time))) / 1000000 AS duration_ms,
      anyIf(service_name, parent_span_id = '') AS root_service,
      anyIf(operation_name, parent_span_id = '') AS root_operation,
      max(has_error) AS has_error
    FROM otel_traces
    WHERE ${where}
    GROUP BY trace_id
    ${havingClause}`;

  const countQuery = `SELECT count() AS total FROM (${innerQuery})`;
  const dataQuery = `${innerQuery} ORDER BY start_time DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

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

  const rawData = await dataResult.json<{
    trace_id: string;
    start_time: string;
    span_count: number;
    duration_ms: number;
    root_service: string;
    root_operation: string;
    has_error: boolean | number;
  }>();

  const data: TraceSummary[] = rawData.map((row) => ({
    trace_id: row.trace_id,
    root_service: row.root_service,
    root_operation: row.root_operation,
    duration_ms: row.duration_ms,
    span_count: row.span_count,
    has_error: Boolean(row.has_error),
    start_time: row.start_time,
  }));

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
