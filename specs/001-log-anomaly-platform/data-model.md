# Data Model: Log Aggregation & Anomaly Detection Platform

**Branch**: `001-log-anomaly-platform` | **Date**: 2026-05-11 | **Spec**: [spec.md](spec.md)

## Architecture

Hybrid ClickHouse + PostgreSQL. ClickHouse stores high-volume telemetry (logs, traces, derived metrics). PostgreSQL stores operational data requiring ACID transactions and referential integrity (tenants, users, alerts, anomalies, configuration). Cross-engine references use value-based lookups (UUIDs stored as TEXT), not foreign keys.

## Entity Summary

| Entity | Engine | Table | Spec Reference |
|--------|--------|-------|----------------|
| Log Record | ClickHouse | `otel_logs` | FR-001–FR-009, FR-041–FR-044 |
| Trace Span | ClickHouse | `otel_traces` | FR-010–FR-012 |
| Derived Metrics | ClickHouse | `metrics_time_series`, `metrics_samples`, `metrics_samples_1h` | FR-013 |
| Security Event | ClickHouse | `security_events` | Deferred (OCSF-aligned, schema ready) |
| Tenant | PostgreSQL | `tenants` | FR-032 |
| User | PostgreSQL | `users` | FR-033–FR-034 |
| API Key | PostgreSQL | `api_keys` | FR-035 |
| Service | PostgreSQL | `services` | FR-036 |
| Service Dependency | PostgreSQL | `service_dependencies` | FR-037 |
| Deployment | PostgreSQL | `deployments` | FR-039–FR-040 |
| Anomaly Model | PostgreSQL | `anomaly_models` | FR-013–FR-014 |
| Anomaly | PostgreSQL | `anomalies` | FR-015–FR-017 |
| Anomaly Baseline | PostgreSQL | `anomaly_baselines` | FR-013, FR-045 |
| Alert Rule | PostgreSQL | `alert_rules` | FR-018, FR-021–FR-022 |
| Notification Channel | PostgreSQL | `notification_channels` | FR-019–FR-020 |
| Alert Event | PostgreSQL | `alert_events` | FR-018 |
| Redaction Rule | PostgreSQL | `redaction_rules` | FR-042–FR-043 |
| Root-Cause Report | PostgreSQL | `rca_reports` | FR-026–FR-028 |
| NL Query | PostgreSQL | `nl_queries` | FR-023–FR-025 |
| Ingest Usage | PostgreSQL | `ingest_usage` | FR-029 |
| Sampling Recommendation | PostgreSQL | `sampling_recommendations` | FR-030–FR-031 |
| Audit Log | PostgreSQL | `audit_log` | FR-038 |

**Total: 23 tables (6 ClickHouse + 17 PostgreSQL)**

---

## ClickHouse: Telemetry Storage

### Log Records (`otel_logs`)

Maps 1:1 to the OpenTelemetry Logs Data Model. Partitioned by `(tenant_id, toDate(timestamp))` for tenant isolation and time-range pruning.

```sql
CREATE TABLE otel_logs
(
    timestamp           DateTime64(9) CODEC(DoubleDelta, LZ4),
    observed_timestamp  DateTime64(9) CODEC(DoubleDelta, LZ4),

    id                  UUID DEFAULT generateUUIDv4(),
    tenant_id           LowCardinality(String),

    -- W3C Trace Context correlation
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    trace_flags         UInt8,

    -- OTel severity (1-24)
    severity_text       LowCardinality(String),
    severity_number     UInt8,

    body                String CODEC(ZSTD(3)),

    -- Resource attributes
    resource_fingerprint String CODEC(ZSTD(1)),
    resource_string      Map(LowCardinality(String), String),

    -- Log attributes (typed maps)
    attributes_string   Map(LowCardinality(String), String),
    attributes_number   Map(LowCardinality(String), Float64),
    attributes_bool     Map(LowCardinality(String), Bool),

    -- Syslog fields (RFC 5424, populated only for syslog sources)
    syslog_facility     UInt8 DEFAULT 0,
    syslog_hostname     LowCardinality(String) DEFAULT '',
    syslog_app_name     LowCardinality(String) DEFAULT '',

    source_type         LowCardinality(String),

    -- Anomaly detection (populated asynchronously by ML pipeline)
    anomaly_score       Float32 DEFAULT 0.0,
    anomaly_detected    Bool DEFAULT false,

    -- Materialized columns
    service_name        String MATERIALIZED resource_string['service.name'],
    host_name           String MATERIALIZED resource_string['host.name'],

    INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_id span_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_severity severity_text TYPE set(0) GRANULARITY 1,
    INDEX idx_source source_type TYPE set(0) GRANULARITY 1,
    INDEX idx_anomaly anomaly_detected TYPE set(2) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, resource_fingerprint, severity_number, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;
```

**Validation rules**:
- `timestamp`: Required. If missing from source, set to `observed_timestamp` (server receipt time) per FR-044
- `severity_number`: 1–24 (OTel range). Invalid values default to 9 (INFO) per FR-044
- `body`: Truncated at configurable max size (default 64 KB) per FR-044
- `tenant_id`: Required. Enforced at ingestion — every record must belong to a tenant
- Sensitive patterns in `body` and `attributes_string` are redacted at ingestion time per FR-042

**State transitions**: None (append-only, immutable after write)

### Trace Spans (`otel_traces`)

```sql
CREATE TABLE otel_traces
(
    start_time          DateTime64(9) CODEC(DoubleDelta, LZ4),
    end_time            DateTime64(9) CODEC(DoubleDelta, LZ4),
    duration_ns         UInt64 CODEC(T64, LZ4),

    tenant_id           LowCardinality(String),
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    parent_span_id      String CODEC(ZSTD(1)),

    operation_name      LowCardinality(String),
    service_name        LowCardinality(String),
    span_kind           LowCardinality(String),
    status_code         LowCardinality(String),
    status_message      String CODEC(ZSTD(1)),

    resource_string     Map(LowCardinality(String), String),
    span_attributes_string Map(LowCardinality(String), String),
    span_attributes_number Map(LowCardinality(String), Float64),
    span_attributes_bool   Map(LowCardinality(String), Bool),

    events_name         Array(LowCardinality(String)),
    events_timestamp    Array(DateTime64(9)),
    events_attributes   Array(Map(LowCardinality(String), String)),

    links_trace_id      Array(String),
    links_span_id       Array(String),

    has_error           Bool MATERIALIZED status_code = 'ERROR',

    INDEX idx_trace_id trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id span_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_duration duration_ns TYPE minmax GRANULARITY 1,
    INDEX idx_status status_code TYPE set(0) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(start_time))
ORDER BY (tenant_id, service_name, operation_name, start_time)
TTL toDateTime(start_time) + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;
```

**Validation rules**:
- `trace_id`: 32-character hex string (W3C Trace Context)
- `span_id`: 16-character hex string
- `span_kind`: One of CLIENT, SERVER, PRODUCER, CONSUMER, INTERNAL
- `status_code`: One of OK, ERROR, UNSET

### Derived Metrics

Metrics are derived from logs and traces in v1 (no external Prometheus ingestion). The schema is ready for future Prometheus Remote Write support.

```sql
CREATE TABLE metrics_time_series
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    metric_name         LowCardinality(String),
    metric_type         LowCardinality(String),
    labels              Map(LowCardinality(String), String),
    description         String DEFAULT '',
    unit                LowCardinality(String) DEFAULT '',
    created_at          DateTime DEFAULT now(),
    updated_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, metric_name, fingerprint)
SETTINGS index_granularity = 8192;

CREATE TABLE metrics_samples
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    timestamp           DateTime64(3) CODEC(DoubleDelta, LZ4),
    value               Float64 CODEC(Gorilla, LZ4),

    INDEX idx_fingerprint fingerprint TYPE set(0) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, fingerprint, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;

CREATE TABLE metrics_samples_1h
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    timestamp           DateTime CODEC(DoubleDelta, LZ4),
    min_value           Float64,
    max_value           Float64,
    avg_value           Float64,
    count               UInt64,
    sum_value           Float64
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toYYYYMM(timestamp))
ORDER BY (tenant_id, fingerprint, timestamp)
TTL timestamp + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW metrics_samples_1h_mv
TO metrics_samples_1h
AS SELECT
    tenant_id,
    fingerprint,
    toStartOfHour(timestamp) AS timestamp,
    min(value) AS min_value,
    max(value) AS max_value,
    avg(value) AS avg_value,
    count() AS count,
    sum(value) AS sum_value
FROM metrics_samples
GROUP BY tenant_id, fingerprint, toStartOfHour(timestamp);
```

### Security Events (`security_events`)

OCSF-aligned. Schema is ready but security log analysis is deferred to a future release.

```sql
CREATE TABLE security_events
(
    timestamp           DateTime64(9) CODEC(DoubleDelta, LZ4),
    tenant_id           LowCardinality(String),

    class_uid           UInt32,
    category_uid        UInt16,
    activity_id         UInt8,
    action_id           UInt8,
    severity_id         UInt8,
    type_uid            UInt64,
    message             String CODEC(ZSTD(3)),
    status              LowCardinality(String),

    actor_user           String CODEC(ZSTD(1)),
    actor_ip             String CODEC(ZSTD(1)),
    actor_process        String CODEC(ZSTD(1)),

    target_resource      String CODEC(ZSTD(1)),
    target_user          String CODEC(ZSTD(1)),

    source_log_id       UUID,
    source_type         LowCardinality(String),

    enrichments         Map(LowCardinality(String), String),

    INDEX idx_class class_uid TYPE set(0) GRANULARITY 1,
    INDEX idx_category category_uid TYPE set(0) GRANULARITY 1,
    INDEX idx_action action_id TYPE set(0) GRANULARITY 1,
    INDEX idx_actor_ip actor_ip TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, class_uid, activity_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 365 DAY DELETE
SETTINGS index_granularity = 8192;
```

---

## PostgreSQL: Operational Data

All PostgreSQL tables use row-level security (RLS) for tenant isolation. The application sets `app.current_tenant` per request.

### Tenant (`tenants`)

```sql
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',
    settings        JSONB NOT NULL DEFAULT '{}',
    retention_config JSONB NOT NULL DEFAULT '{"logs_days": 30, "traces_days": 14, "metrics_days": 90}',
    max_ingest_gb_month NUMERIC(10,2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation**: `slug` must be unique, lowercase alphanumeric with hyphens. `plan` in ('free', 'pro', 'enterprise').

**Relationships**: Parent of all tenant-scoped entities.

### User (`users`)

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    display_name    TEXT,
    identity_provider TEXT,
    external_id     TEXT,
    role            TEXT NOT NULL DEFAULT 'viewer',
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, email)
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

**Validation**: `role` in ('viewer', 'editor', 'admin'). `email` unique per tenant.

**RBAC permissions** (FR-033):
- **Viewer**: Read-only access to logs, traces, anomalies, alerts, dashboards, cost data
- **Editor**: Viewer + create/modify/delete alert rules, notification channels, sampling rules, redaction rules
- **Admin**: Editor + manage tenant settings, users, API keys, retention policies

### API Key (`api_keys`)

```sql
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    name            TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,
    key_hash        TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation**: `key_hash` is bcrypt or argon2 hash (never store plaintext). `key_prefix` is first 8 characters for identification. `scopes` drawn from ('ingest', 'query', 'alerts', 'admin').

### Service (`services`)

```sql
CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    namespace       TEXT DEFAULT 'default',
    environment     TEXT NOT NULL DEFAULT 'production',
    language        TEXT,
    owner_team      TEXT,
    repository_url  TEXT,
    tags            JSONB NOT NULL DEFAULT '{}',
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name, namespace, environment)
);

CREATE INDEX idx_services_tenant ON services(tenant_id);
```

**Validation**: `(tenant_id, name, namespace, environment)` must be unique. Auto-registered from telemetry resource attributes (FR-036).

### Service Dependency (`service_dependencies`)

```sql
CREATE TABLE service_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'calls',
    discovered_from TEXT DEFAULT 'traces',
    call_count_24h  BIGINT DEFAULT 0,
    avg_duration_ms DOUBLE PRECISION,
    error_rate_24h  REAL DEFAULT 0.0,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, source_service_id, target_service_id, dependency_type)
);

CREATE INDEX idx_svc_deps_source ON service_dependencies(source_service_id);
CREATE INDEX idx_svc_deps_target ON service_dependencies(target_service_id);
```

**Validation**: `discovered_from` in ('traces', 'manual', 'config'). Auto-derived from trace span parent-child relationships (FR-037).

### Deployment (`deployments`) — NEW

```sql
CREATE TABLE deployments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    version         TEXT NOT NULL,
    commit_sha      TEXT,
    deployer        TEXT,
    changelog       TEXT,
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_service ON deployments(tenant_id, service_id, deployed_at DESC);
```

**Validation**: `version` is required. `commit_sha` is a 40-character hex string if provided.

**Relationships**: References `services(id)`. Used by root-cause analysis (FR-027) to correlate anomalies with recent deployments.

### Anomaly Model (`anomaly_models`)

```sql
CREATE TABLE anomaly_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_type      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'training',
    config          JSONB NOT NULL DEFAULT '{}',
    artifact_path   TEXT,
    training_started_at TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    training_log_count BIGINT,
    precision_score REAL,
    recall_score    REAL,
    f1_score        REAL,
    false_positive_rate REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation**: `model_type` in ('logbert', 'statistical_rcf', 'llm_semantic', 'isolation_forest'). `status` in ('training', 'ready', 'failed', 'retired').

**State transitions**: `training` → `ready` | `failed`. `ready` → `retired` (when replaced by newer version).

### Anomaly (`anomalies`)

```sql
CREATE TABLE anomalies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_id        UUID REFERENCES anomaly_models(id),
    anomaly_type    TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'warning',
    score           REAL NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    sample_log_ids  TEXT[],
    related_trace_ids TEXT[],
    status          TEXT NOT NULL DEFAULT 'open',
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    user_feedback   TEXT CHECK (user_feedback IN ('helpful', 'not_helpful', 'false_positive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomalies_tenant ON anomalies(tenant_id, detected_at DESC);
CREATE INDEX idx_anomalies_open ON anomalies(tenant_id, status) WHERE status = 'open';
```

**Validation**: `anomaly_type` in ('volume_spike', 'novel_pattern', 'error_rate', 'latency'). `severity` in ('critical', 'warning', 'info'). `score` range 0.0–1.0. `status` in ('open', 'acknowledged', 'resolved', 'false_positive').

**State transitions**: `open` → `acknowledged` → `resolved` | `false_positive`. Any state → `false_positive`.

**Cross-engine**: `sample_log_ids` and `related_trace_ids` reference ClickHouse `otel_logs.id` and `otel_traces.trace_id` by value.

### Anomaly Baseline (`anomaly_baselines`)

```sql
CREATE TABLE anomaly_baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id),
    metric_name     TEXT NOT NULL,
    baseline_mean   DOUBLE PRECISION NOT NULL,
    baseline_stddev DOUBLE PRECISION NOT NULL,
    baseline_p50    DOUBLE PRECISION,
    baseline_p95    DOUBLE PRECISION,
    baseline_p99    DOUBLE PRECISION,
    hourly_pattern  JSONB,
    dow_pattern     JSONB,
    sample_count    BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, service_id, metric_name)
);
```

**Validation**: `metric_name` examples: 'error_rate', 'log_volume', 'p99_latency'. Baselines require ≥7 days of data for full AI detection (FR-045); statistical detection uses partial baselines during learning period.

### Alert Rule (`alert_rules`)

```sql
CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    rule_type       TEXT NOT NULL,
    condition       JSONB NOT NULL,
    notification_channel_ids UUID[] NOT NULL DEFAULT '{}',
    severity        TEXT NOT NULL DEFAULT 'warning',
    evaluation_interval_seconds INT NOT NULL DEFAULT 60,
    cooldown_minutes INT NOT NULL DEFAULT 15,
    mute_until      TIMESTAMPTZ,
    last_evaluated_at TIMESTAMPTZ,
    last_fired_at   TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id, enabled) WHERE enabled = TRUE;
```

**Validation**: `rule_type` in ('anomaly', 'log_pattern', 'metric_threshold', 'log_absence'). `cooldown_minutes` ≥ 1. `evaluation_interval_seconds` ≥ 10.

### Notification Channel (`notification_channels`)

```sql
CREATE TABLE notification_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    channel_type    TEXT NOT NULL,
    config          JSONB NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation**: `channel_type` in ('slack', 'pagerduty', 'email', 'webhook'). `config` shape depends on `channel_type` (e.g., Slack requires `webhook_url`; PagerDuty requires `integration_key`).

### Alert Event (`alert_events`)

```sql
CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id   UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    anomaly_id      UUID REFERENCES anomalies(id),
    status          TEXT NOT NULL DEFAULT 'firing',
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    notification_results JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_events_firing ON alert_events(tenant_id, status) WHERE status = 'firing';
```

**State transitions**: `firing` → `resolved`.

### Redaction Rule (`redaction_rules`) — NEW

```sql
CREATE TABLE redaction_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    rule_type       TEXT NOT NULL DEFAULT 'custom',
    pattern         TEXT NOT NULL,
    replacement     TEXT NOT NULL DEFAULT '***REDACTED***',
    applies_to      TEXT NOT NULL DEFAULT 'all',
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redaction_rules_tenant ON redaction_rules(tenant_id, enabled) WHERE enabled = TRUE;
```

**Validation**: `rule_type` in ('custom', 'builtin'). `pattern` is a valid regex for custom rules, or a built-in identifier ('credit_card', 'email', 'bearer_token') for built-in rules. `applies_to` in ('body', 'attributes', 'all'). Built-in patterns (FR-043) are seeded per tenant and can be enabled/disabled but not modified.

### Root-Cause Report (`rca_reports`)

```sql
CREATE TABLE rca_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    anomaly_id      UUID REFERENCES anomalies(id),
    summary         TEXT NOT NULL,
    probable_cause  TEXT,
    confidence      REAL,
    evidence        JSONB NOT NULL DEFAULT '[]',
    related_service_ids UUID[],
    helpful         BOOLEAN,
    feedback_notes  TEXT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Validation**: `confidence` range 0.0–1.0. `evidence` is an array of objects with `type` ('log_pattern', 'trace', 'deployment', 'metric_change'), `description`, and `reference_id`.

### NL Query (`nl_queries`)

```sql
CREATE TABLE nl_queries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    natural_language TEXT NOT NULL,
    generated_query TEXT NOT NULL,
    query_language  TEXT NOT NULL DEFAULT 'clickhouse_sql',
    execution_time_ms INT,
    result_count    INT,
    results_summary TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Ingest Usage (`ingest_usage`)

```sql
CREATE TABLE ingest_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_name    TEXT NOT NULL,
    date            DATE NOT NULL,
    signal_type     TEXT NOT NULL,
    record_count    BIGINT NOT NULL DEFAULT 0,
    bytes_raw       BIGINT NOT NULL DEFAULT 0,
    bytes_compressed BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,4),
    UNIQUE(tenant_id, service_name, date, signal_type)
);
```

**Validation**: `signal_type` in ('logs', 'traces'). Aggregated daily by a background worker.

### Sampling Recommendation (`sampling_recommendations`)

```sql
CREATE TABLE sampling_recommendations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_name    TEXT NOT NULL,
    log_pattern     TEXT NOT NULL,
    current_volume_per_day BIGINT NOT NULL,
    recommended_sample_rate REAL NOT NULL,
    estimated_savings_gb NUMERIC(10,2),
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    applied_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**State transitions**: `pending` → `applied` | `dismissed`.

### Audit Log (`audit_log`)

```sql
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    actor_id        UUID,
    actor_type      TEXT NOT NULL,
    action          TEXT NOT NULL,
    resource_type   TEXT NOT NULL,
    resource_id     UUID,
    changes         JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
```

**Validation**: `actor_type` in ('user', 'api_key', 'system'). `action` in ('create', 'update', 'delete'). `changes` stores `{"before": {...}, "after": {...}}` diff.

---

## Entity Relationship Diagram (Textual)

```
Tenant 1──* User
Tenant 1──* API Key
Tenant 1──* Service
Tenant 1──* Alert Rule
Tenant 1──* Notification Channel
Tenant 1──* Redaction Rule
Tenant 1──* Anomaly
Tenant 1──* Ingest Usage
Tenant 1──* Audit Log

Service 1──* Service Dependency (as source)
Service 1──* Service Dependency (as target)
Service 1──* Deployment
Service 1──* Anomaly Model
Service 1──* Anomaly
Service 1──* Anomaly Baseline

Anomaly *──1 Anomaly Model
Anomaly 1──* Root-Cause Report
Anomaly *──1 Alert Event
Anomaly ──── Log Records (cross-engine, by UUID)
Anomaly ──── Trace Spans (cross-engine, by trace_id)

Alert Rule *──* Notification Channel (via UUID array)
Alert Rule 1──* Alert Event

User 1──* NL Query

Log Record ──── Trace Span (correlated via trace_id + span_id)
```

---

## Cross-Engine Reference Pattern

ClickHouse and PostgreSQL do not share foreign keys. Cross-engine references follow this pattern:

1. PostgreSQL stores ClickHouse record identifiers as `TEXT` or `TEXT[]` columns
2. The application layer performs the cross-engine lookup in two steps
3. Example: `anomalies.sample_log_ids` stores UUIDs of ClickHouse `otel_logs` records

```
PostgreSQL anomalies → sample_log_ids: ['uuid-1', 'uuid-2']
    ↓ (application layer)
ClickHouse otel_logs WHERE id IN ('uuid-1', 'uuid-2')
```

---

## Retention Defaults

| Data Type | Engine | Default TTL | Configurable |
|-----------|--------|-------------|-------------|
| Logs | ClickHouse | 30 days | Yes, via `tenants.retention_config` |
| Traces | ClickHouse | 14 days | Yes |
| Metrics (raw) | ClickHouse | 90 days | Yes |
| Metrics (1h rollup) | ClickHouse | 365 days | No |
| Security Events | ClickHouse | 365 days | No |
| Audit Log | PostgreSQL | Unlimited (partitioned) | No |
