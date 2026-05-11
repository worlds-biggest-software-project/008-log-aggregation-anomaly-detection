export type SpanKind = 'CLIENT' | 'SERVER' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
export type SpanStatusCode = 'OK' | 'ERROR' | 'UNSET';

export interface TraceSpan {
  start_time: string;
  end_time: string;
  duration_ns: number;
  tenant_id: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  operation_name: string;
  service_name: string;
  span_kind: SpanKind;
  status_code: SpanStatusCode;
  status_message: string;
  resource_string: Record<string, string>;
  span_attributes_string: Record<string, string>;
  span_attributes_number: Record<string, number>;
  span_attributes_bool: Record<string, boolean>;
  events_name: string[];
  events_timestamp: string[];
  events_attributes: Record<string, string>[];
  links_trace_id: string[];
  links_span_id: string[];
  has_error: boolean;
}

export interface TraceDetail {
  trace_id: string;
  span_count: number;
  duration_ms: number;
  services: string[];
  spans: TraceSpan[];
}

export interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  has_error: boolean;
  start_time: string;
}

export interface TraceSearchParams {
  service?: string;
  operation?: string;
  status?: SpanStatusCode;
  min_duration_ms?: number;
  max_duration_ms?: number;
  from: string;
  to?: string;
  limit?: number;
  offset?: number;
}
