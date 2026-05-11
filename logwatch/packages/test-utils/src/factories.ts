import { randomUUID } from 'node:crypto';
import type {
  OtelLogRecord,
  SeverityText,
  TraceSpan,
  Tenant,
  User,
  UserRole,
  Service,
  ApiKey,
  Anomaly,
  AnomalyType,
  AnomalySeverity,
  AnomalyStatus,
  AlertRule,
  NotificationChannel,
  RedactionRule,
} from '@logwatch/shared';

let counter = 0;
function seq() {
  return ++counter;
}

export function createTenant(overrides: Partial<Tenant> = {}): Tenant {
  const n = seq();
  return {
    id: randomUUID(),
    name: `Test Tenant ${n}`,
    slug: `test-tenant-${n}`,
    plan: 'free',
    settings: {},
    retention_config: { logs_days: 30, traces_days: 14, metrics_days: 90 },
    max_ingest_gb_month: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createUser(overrides: Partial<User> = {}): User {
  const n = seq();
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    email: `user${n}@test.com`,
    display_name: `Test User ${n}`,
    identity_provider: null,
    external_id: null,
    role: 'viewer' as UserRole,
    last_login_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createService(overrides: Partial<Service> = {}): Service {
  const n = seq();
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    name: `service-${n}`,
    namespace: 'default',
    environment: 'production',
    language: null,
    owner_team: null,
    repository_url: null,
    tags: {},
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createApiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  const n = seq();
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    created_by: null,
    name: `API Key ${n}`,
    key_prefix: `lw_${n.toString().padStart(4, '0')}`,
    scopes: ['ingest'],
    expires_at: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createLogRecord(overrides: Partial<OtelLogRecord> = {}): OtelLogRecord {
  const now = new Date().toISOString();
  return {
    timestamp: now,
    observed_timestamp: now,
    id: randomUUID(),
    tenant_id: 'test-tenant',
    trace_id: randomUUID().replace(/-/g, ''),
    span_id: randomUUID().replace(/-/g, '').slice(0, 16),
    trace_flags: 1,
    severity_text: 'INFO' as SeverityText,
    severity_number: 9,
    body: `Test log message ${seq()}`,
    resource_fingerprint: 'fp-test',
    resource_string: { 'service.name': 'test-service' },
    attributes_string: {},
    attributes_number: {},
    attributes_bool: {},
    source_type: 'http',
    anomaly_score: 0,
    anomaly_detected: false,
    service_name: 'test-service',
    host_name: 'localhost',
    ...overrides,
  };
}

export function createTraceSpan(overrides: Partial<TraceSpan> = {}): TraceSpan {
  const now = new Date().toISOString();
  return {
    start_time: now,
    end_time: now,
    duration_ns: 1000000,
    tenant_id: 'test-tenant',
    trace_id: randomUUID().replace(/-/g, ''),
    span_id: randomUUID().replace(/-/g, '').slice(0, 16),
    parent_span_id: '',
    operation_name: 'test-operation',
    service_name: 'test-service',
    span_kind: 'SERVER',
    status_code: 'OK',
    status_message: '',
    resource_string: { 'service.name': 'test-service' },
    span_attributes_string: {},
    span_attributes_number: {},
    span_attributes_bool: {},
    events_name: [],
    events_timestamp: [],
    events_attributes: [],
    links_trace_id: [],
    links_span_id: [],
    has_error: false,
    ...overrides,
  };
}

export function createAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    service_id: null,
    model_id: null,
    anomaly_type: 'error_rate' as AnomalyType,
    severity: 'warning' as AnomalySeverity,
    score: 0.75,
    title: `Anomaly ${seq()}`,
    description: null,
    detected_at: now,
    window_start: now,
    window_end: now,
    sample_log_ids: [],
    related_trace_ids: [],
    status: 'open' as AnomalyStatus,
    resolved_at: null,
    resolved_by: null,
    user_feedback: null,
    created_at: now,
    ...overrides,
  };
}

export function createAlertRule(overrides: Partial<AlertRule> = {}): AlertRule {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    name: `Alert Rule ${seq()}`,
    description: null,
    enabled: true,
    rule_type: 'anomaly',
    condition: { anomaly_type: 'error_rate', severity_gte: 'warning' },
    notification_channel_ids: [],
    severity: 'warning',
    evaluation_interval_seconds: 60,
    cooldown_minutes: 15,
    mute_until: null,
    last_evaluated_at: null,
    last_fired_at: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

export function createNotificationChannel(
  overrides: Partial<NotificationChannel> = {},
): NotificationChannel {
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    name: `Channel ${seq()}`,
    channel_type: 'slack',
    config: { webhook_url: 'https://hooks.slack.com/test' },
    is_verified: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createRedactionRule(overrides: Partial<RedactionRule> = {}): RedactionRule {
  return {
    id: randomUUID(),
    tenant_id: randomUUID(),
    name: `Redaction Rule ${seq()}`,
    rule_type: 'custom',
    pattern: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b',
    replacement: '***REDACTED***',
    applies_to: 'all',
    enabled: true,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
