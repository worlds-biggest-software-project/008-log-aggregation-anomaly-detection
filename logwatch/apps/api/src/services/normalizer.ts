import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  normalizeSeverity,
  MAX_BODY_SIZE,
  DEFAULT_SEVERITY_NUMBER,
  DEFAULT_SEVERITY_TEXT,
} from '@logwatch/shared';
import type { OtelLogRecord, JsonLogInput, SeverityText } from '@logwatch/shared';

export function normalizeJsonLog(
  input: JsonLogInput,
  tenantId: string,
  observedTimestamp: string,
): OtelLogRecord {
  const { severity_text, severity_number } = normalizeSeverity(input.severity);

  let body = input.body ?? '';
  if (body.length > MAX_BODY_SIZE) {
    body = body.slice(0, MAX_BODY_SIZE);
  }

  const resourceString: Record<string, string> = {};
  if (input.service) {
    resourceString['service.name'] = input.service;
  }

  const resourceFingerprint = createHash('sha256')
    .update(JSON.stringify(resourceString))
    .digest('hex')
    .slice(0, 16);

  return {
    timestamp: input.timestamp ?? observedTimestamp,
    observed_timestamp: observedTimestamp,
    id: randomUUID(),
    tenant_id: tenantId,
    trace_id: '',
    span_id: '',
    trace_flags: 0,
    severity_text,
    severity_number,
    body,
    resource_fingerprint: resourceFingerprint,
    resource_string: resourceString,
    attributes_string: input.attributes ?? {},
    attributes_number: {},
    attributes_bool: {},
    source_type: 'http',
    anomaly_score: 0,
    anomaly_detected: false,
    service_name: input.service ?? '',
    host_name: '',
  };
}

export function normalizeOtlpLog(
  record: Record<string, unknown>,
  resourceAttributes: Record<string, string>,
  tenantId: string,
  observedTimestamp: string,
): OtelLogRecord {
  const timestamp = (record.timeUnixNano as string) ?? observedTimestamp;
  const severityInput =
    (record.severityNumber as number) ?? (record.severityText as string);
  const { severity_text, severity_number } = normalizeSeverity(severityInput);

  let body = String(record.body ?? '');
  if (body.length > MAX_BODY_SIZE) {
    body = body.slice(0, MAX_BODY_SIZE);
  }

  const resourceFingerprint = createHash('sha256')
    .update(JSON.stringify(resourceAttributes))
    .digest('hex')
    .slice(0, 16);

  const attributesString: Record<string, string> = {};
  const attributesNumber: Record<string, number> = {};
  const attributesBool: Record<string, boolean> = {};

  if (record.attributes && Array.isArray(record.attributes)) {
    for (const attr of record.attributes as Array<{
      key: string;
      value: { stringValue?: string; intValue?: string; boolValue?: boolean };
    }>) {
      if (attr.value.stringValue !== undefined) {
        attributesString[attr.key] = attr.value.stringValue;
      } else if (attr.value.intValue !== undefined) {
        attributesNumber[attr.key] = Number(attr.value.intValue);
      } else if (attr.value.boolValue !== undefined) {
        attributesBool[attr.key] = attr.value.boolValue;
      }
    }
  }

  return {
    timestamp,
    observed_timestamp: observedTimestamp,
    id: randomUUID(),
    tenant_id: tenantId,
    trace_id: (record.traceId as string) ?? '',
    span_id: (record.spanId as string) ?? '',
    trace_flags: (record.flags as number) ?? 0,
    severity_text,
    severity_number,
    body,
    resource_fingerprint: resourceFingerprint,
    resource_string: resourceAttributes,
    attributes_string: attributesString,
    attributes_number: attributesNumber,
    attributes_bool: attributesBool,
    source_type: 'otlp',
    anomaly_score: 0,
    anomaly_detected: false,
    service_name: resourceAttributes['service.name'] ?? '',
    host_name: resourceAttributes['host.name'] ?? '',
  };
}

export function normalizeSyslogToLog(
  parsed: {
    severity_text: SeverityText;
    severity_number: number;
    timestamp: string;
    hostname: string;
    app_name: string;
    facility: number;
    message: string;
    structured_data: Record<string, string>;
  },
  tenantId: string,
  observedTimestamp: string,
): OtelLogRecord {
  let body = parsed.message;
  if (body.length > MAX_BODY_SIZE) {
    body = body.slice(0, MAX_BODY_SIZE);
  }

  const resourceString: Record<string, string> = {};
  if (parsed.app_name) resourceString['service.name'] = parsed.app_name;
  if (parsed.hostname) resourceString['host.name'] = parsed.hostname;

  const resourceFingerprint = createHash('sha256')
    .update(JSON.stringify(resourceString))
    .digest('hex')
    .slice(0, 16);

  return {
    timestamp: parsed.timestamp || observedTimestamp,
    observed_timestamp: observedTimestamp,
    id: randomUUID(),
    tenant_id: tenantId,
    trace_id: '',
    span_id: '',
    trace_flags: 0,
    severity_text: parsed.severity_text,
    severity_number: parsed.severity_number,
    body,
    resource_fingerprint: resourceFingerprint,
    resource_string: resourceString,
    attributes_string: parsed.structured_data,
    attributes_number: {},
    attributes_bool: {},
    source_type: 'syslog',
    anomaly_score: 0,
    anomaly_detected: false,
    service_name: parsed.app_name ?? '',
    host_name: parsed.hostname ?? '',
  };
}
