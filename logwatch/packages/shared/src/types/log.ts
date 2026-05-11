export type SeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface OtelLogRecord {
  timestamp: string;
  observed_timestamp: string;
  id: string;
  tenant_id: string;
  trace_id: string;
  span_id: string;
  trace_flags: number;
  severity_text: SeverityText;
  severity_number: number;
  body: string;
  resource_fingerprint: string;
  resource_string: Record<string, string>;
  attributes_string: Record<string, string>;
  attributes_number: Record<string, number>;
  attributes_bool: Record<string, boolean>;
  source_type: 'otlp' | 'syslog' | 'http' | 'fluent_bit';
  anomaly_score: number;
  anomaly_detected: boolean;
  service_name: string;
  host_name: string;
}

export interface LogSearchParams {
  q?: string;
  service?: string;
  severity?: SeverityText;
  from: string;
  to?: string;
  trace_id?: string;
  attributes?: string;
  limit?: number;
  offset?: number;
  sort?: 'timestamp_asc' | 'timestamp_desc';
}

export interface LogSearchResult {
  data: OtelLogRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface JsonLogInput {
  timestamp?: string;
  severity?: string;
  body: string;
  service?: string;
  attributes?: Record<string, string>;
}

export interface IngestRequest {
  logs: JsonLogInput[];
}

export const MAX_BODY_SIZE = 65536;
export const DEFAULT_SEVERITY_NUMBER = 9;
export const DEFAULT_SEVERITY_TEXT: SeverityText = 'INFO';
