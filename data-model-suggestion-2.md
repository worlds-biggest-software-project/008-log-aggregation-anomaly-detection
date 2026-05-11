# Data Model Suggestion 2: Hybrid Columnar + Relational (ClickHouse + PostgreSQL)

> Project: Log Aggregation & Anomaly Detection · Created: 2026-05-11

## Philosophy

This approach uses two database engines, each optimized for its workload: ClickHouse for high-volume telemetry ingestion and analytical queries (logs, traces, metrics), and PostgreSQL for operational data that requires ACID transactions and referential integrity (users, tenants, alert rules, configuration). This is the architecture used by SigNoz, ClickStack (ClickHouse's own observability platform), and OneUptime — the dominant pattern for modern open-source observability platforms.

ClickHouse is a columnar OLAP database that achieves 10-20x compression ratios on log data through columnar encoding (LZ4, ZSTD, delta encoding) and stores data sorted by time for efficient range scans. It can sustain millions of log record inserts per second on commodity hardware. Its MergeTree engine family supports time-based partitioning with automatic TTL-based data expiration, making retention management trivial. Full-text search is handled via token bloom filter indexes (introduced in ClickHouse 23.3+), which provide sub-second search over billions of log lines without the operational complexity of maintaining an inverted index like Elasticsearch.

PostgreSQL handles the transactional workload: user authentication, RBAC, alert rule CRUD, notification delivery tracking, and audit logging. These tables require strong consistency, foreign key constraints, and row-level security — properties that ClickHouse does not offer. The two engines communicate through the application layer: the ingestion pipeline writes telemetry to ClickHouse and metadata to PostgreSQL; the query layer joins results from both stores.

**Best for:** Production-grade observability platforms targeting high ingestion volumes (100K-10M logs/second), where storage cost efficiency and query performance are critical. This is the architecture recommended by ClickHouse for observability workloads and proven at scale by SigNoz.

**Trade-offs:**
- (+) 10-20x compression vs PostgreSQL; 3-10x vs Elasticsearch — dramatically lower storage cost
- (+) Millions of rows/second ingestion throughput on a single ClickHouse node
- (+) Sub-second analytical queries over billions of rows (columnar scan + vectorized execution)
- (+) Time-based TTL handles retention automatically — no manual partition management
- (+) PostgreSQL handles ACID transactions for configuration and RBAC perfectly
- (-) Two database engines to operate, monitor, back up, and upgrade
- (-) No cross-engine JOIN — application must stitch results from ClickHouse and PostgreSQL
- (-) ClickHouse has no row-level security — multi-tenant isolation must be enforced at the application/query layer
- (-) ClickHouse does not support UPDATE/DELETE efficiently — corrections require INSERT of replacement rows
- (-) More complex deployment: requires ClickHouse Keeper (or ZooKeeper) for replicated setups

---

## Standards Alignment

| Standard | How It's Used |
|----------|---------------|
| OpenTelemetry Logs Data Model | ClickHouse `otel_logs` table columns map 1:1 to OTLP LogRecord fields; SigNoz's proven schema is the template |
| OpenTelemetry Traces Data Model | ClickHouse `otel_traces` table follows OTel TraceSpan semantic conventions with all standard attributes |
| OCSF (Open Cybersecurity Schema Framework) | Security events in ClickHouse `security_events` table use OCSF `class_uid`, `category_uid`, `activity_id` for normalized correlation |
| RFC 5424 (Syslog Protocol) | Syslog fields stored as Map columns in ClickHouse for zero-overhead ingestion |
| W3C Trace Context | `trace_id` and `span_id` columns enable log-to-trace correlation; indexed for fast lookup |
| Prometheus Remote Write | Metrics stored in ClickHouse time-series tables compatible with Prometheus data model (metric name, labels, value, timestamp) |
| ISO 27001:2022 Annex A 8.15 | Audit trail in PostgreSQL `audit_log` table with full change tracking |
| NIST SP 800-92 | TTL-based retention in ClickHouse + retention policy configuration in PostgreSQL |

---

## ClickHouse: Telemetry Storage

### Log Records

```sql
-- ============================================================
-- CLICKHOUSE: LOG RECORDS
-- ============================================================
-- Engine: MergeTree (or ReplicatedMergeTree for HA)
-- Based on SigNoz's proven schema + OpenTelemetry Logs Data Model

CREATE TABLE otel_logs
(
    -- Time
    timestamp           DateTime64(9) CODEC(DoubleDelta, LZ4),  -- nanosecond precision
    observed_timestamp  DateTime64(9) CODEC(DoubleDelta, LZ4),

    -- Identifiers
    id                  UUID DEFAULT generateUUIDv4(),
    tenant_id           LowCardinality(String),                  -- multi-tenant partition key

    -- Trace correlation (W3C Trace Context)
    trace_id            String CODEC(ZSTD(1)),                   -- 32-char hex
    span_id             String CODEC(ZSTD(1)),                   -- 16-char hex
    trace_flags         UInt8,

    -- Severity (OTel SeverityNumber: 1-24)
    severity_text       LowCardinality(String),                  -- TRACE, DEBUG, INFO, WARN, ERROR, FATAL
    severity_number     UInt8,

    -- Body
    body                String CODEC(ZSTD(3)),                   -- log message (highest compression)

    -- Resource attributes (service identification)
    resource_fingerprint String CODEC(ZSTD(1)),                  -- hash for grouping
    resource_string      Map(LowCardinality(String), String),
    /*  Example:
        {'service.name': 'payment-service', 'host.name': 'ip-10-0-1-42',
         'k8s.namespace.name': 'payments', 'cloud.region': 'us-east-1'}
    */

    -- Log attributes (variable per log line)
    attributes_string   Map(LowCardinality(String), String),
    attributes_number   Map(LowCardinality(String), Float64),
    attributes_bool     Map(LowCardinality(String), Bool),

    -- Syslog fields (RFC 5424, populated only for syslog sources)
    syslog_facility     UInt8 DEFAULT 0,
    syslog_hostname     LowCardinality(String) DEFAULT '',
    syslog_app_name     LowCardinality(String) DEFAULT '',

    -- Source tracking
    source_type         LowCardinality(String),                  -- 'otlp', 'syslog', 'http', 'fluent_bit'

    -- Anomaly detection (populated asynchronously)
    anomaly_score       Float32 DEFAULT 0.0,
    anomaly_detected    Bool DEFAULT false,

    -- Materialized columns for common queries
    service_name        String MATERIALIZED resource_string['service.name'],
    host_name           String MATERIALIZED resource_string['host.name'],

    INDEX idx_trace_id trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_span_id span_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,    -- full-text search
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

-- Distributed table for clustered deployments
-- CREATE TABLE otel_logs_distributed AS otel_logs
-- ENGINE = Distributed('cluster', 'observability', 'otel_logs', sipHash64(tenant_id));
```

### Trace Spans

```sql
-- ============================================================
-- CLICKHOUSE: TRACE SPANS
-- ============================================================

CREATE TABLE otel_traces
(
    -- Time
    start_time          DateTime64(9) CODEC(DoubleDelta, LZ4),
    end_time            DateTime64(9) CODEC(DoubleDelta, LZ4),
    duration_ns         UInt64 CODEC(T64, LZ4),

    -- Identifiers
    tenant_id           LowCardinality(String),
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    parent_span_id      String CODEC(ZSTD(1)),

    -- Span metadata
    operation_name      LowCardinality(String),
    service_name        LowCardinality(String),
    span_kind           LowCardinality(String),              -- CLIENT, SERVER, PRODUCER, CONSUMER, INTERNAL
    status_code         LowCardinality(String),              -- OK, ERROR, UNSET
    status_message      String CODEC(ZSTD(1)),

    -- Attributes
    resource_string     Map(LowCardinality(String), String),
    span_attributes_string Map(LowCardinality(String), String),
    span_attributes_number Map(LowCardinality(String), Float64),
    span_attributes_bool   Map(LowCardinality(String), Bool),

    -- Events (span events as nested arrays)
    events_name         Array(LowCardinality(String)),
    events_timestamp    Array(DateTime64(9)),
    events_attributes   Array(Map(LowCardinality(String), String)),

    -- Links
    links_trace_id      Array(String),
    links_span_id       Array(String),

    -- Computed
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

### Metrics (Time Series)

```sql
-- ============================================================
-- CLICKHOUSE: METRICS (Prometheus-compatible)
-- ============================================================

-- Time series metadata (fingerprint → labels mapping)
CREATE TABLE metrics_time_series
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,                              -- xxHash64 of sorted labels
    metric_name         LowCardinality(String),
    metric_type         LowCardinality(String),              -- gauge, counter, histogram, summary
    labels              Map(LowCardinality(String), String),
    description         String DEFAULT '',
    unit                LowCardinality(String) DEFAULT '',
    created_at          DateTime DEFAULT now(),
    updated_at          DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (tenant_id, metric_name, fingerprint)
SETTINGS index_granularity = 8192;

-- Metric samples (the actual data points)
CREATE TABLE metrics_samples
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    timestamp           DateTime64(3) CODEC(DoubleDelta, LZ4),
    value               Float64 CODEC(Gorilla, LZ4),         -- Gorilla encoding for time-series floats
    
    INDEX idx_fingerprint fingerprint TYPE set(0) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, fingerprint, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;

-- Pre-aggregated metric rollups (1-minute resolution → 1-hour)
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

-- Materialized view for automatic rollup
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

### Security Events (OCSF)

```sql
-- ============================================================
-- CLICKHOUSE: SECURITY EVENTS (OCSF-aligned)
-- ============================================================

CREATE TABLE security_events
(
    timestamp           DateTime64(9) CODEC(DoubleDelta, LZ4),
    tenant_id           LowCardinality(String),

    -- OCSF core fields
    class_uid           UInt32,                              -- OCSF event class (e.g., 3001 = Authentication)
    category_uid        UInt16,                              -- OCSF category (e.g., 3 = Identity & Access)
    activity_id         UInt8,                               -- OCSF activity (e.g., 1 = Logon)
    action_id           UInt8,                               -- 0=Unknown, 1=Allowed, 2=Denied
    severity_id         UInt8,                               -- 0-6 (Unknown to Fatal)
    type_uid            UInt64,                              -- class_uid * 100 + activity_id
    message             String CODEC(ZSTD(3)),
    status              LowCardinality(String),              -- Success, Failure, Other

    -- Actor
    actor_user           String CODEC(ZSTD(1)),
    actor_ip             String CODEC(ZSTD(1)),
    actor_process        String CODEC(ZSTD(1)),

    -- Target
    target_resource      String CODEC(ZSTD(1)),
    target_user          String CODEC(ZSTD(1)),

    -- Source log reference
    source_log_id       UUID,
    source_type         LowCardinality(String),

    -- Enrichment
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

## PostgreSQL: Operational Data

### Tenants, Users, and Access Control

```sql
-- ============================================================
-- POSTGRESQL: MULTI-TENANCY & AUTH
-- ============================================================

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

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    name            TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,                       -- first 8 chars for identification
    key_hash        TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS on all PostgreSQL tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

### Service Registry

```sql
-- ============================================================
-- POSTGRESQL: SERVICE REGISTRY
-- ============================================================

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

CREATE TABLE service_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'calls',
    discovered_from TEXT DEFAULT 'traces',                -- 'traces', 'manual', 'config'
    call_count_24h  BIGINT DEFAULT 0,
    avg_duration_ms DOUBLE PRECISION,
    error_rate_24h  REAL DEFAULT 0.0,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, source_service_id, target_service_id, dependency_type)
);

CREATE INDEX idx_services_tenant ON services(tenant_id);
CREATE INDEX idx_svc_deps_source ON service_dependencies(source_service_id);
CREATE INDEX idx_svc_deps_target ON service_dependencies(target_service_id);
```

### Anomaly Detection Models & Results

```sql
-- ============================================================
-- POSTGRESQL: ANOMALY DETECTION (model management)
-- ============================================================

CREATE TABLE anomaly_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_type      TEXT NOT NULL,                       -- 'logbert', 'statistical_rcf', 'llm_semantic', 'isolation_forest'
    model_version   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'training',
    config          JSONB NOT NULL DEFAULT '{}',
    artifact_path   TEXT,                                -- S3/GCS path to serialized model
    training_started_at TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    training_log_count BIGINT,
    precision_score REAL,
    recall_score    REAL,
    f1_score        REAL,
    false_positive_rate REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomalies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_id        UUID REFERENCES anomaly_models(id),
    anomaly_type    TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'warning',
    score           REAL NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,                                -- AI-generated explanation
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    -- ClickHouse references (not FK — cross-engine)
    sample_log_ids  TEXT[],                              -- UUIDs of log records in ClickHouse
    related_trace_ids TEXT[],
    -- Resolution
    status          TEXT NOT NULL DEFAULT 'open',
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    user_feedback   TEXT CHECK (user_feedback IN ('helpful', 'not_helpful', 'false_positive')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX idx_anomalies_tenant ON anomalies(tenant_id, detected_at DESC);
CREATE INDEX idx_anomalies_open ON anomalies(tenant_id, status) WHERE status = 'open';
```

### Alerting & Notifications

```sql
-- ============================================================
-- POSTGRESQL: ALERTING
-- ============================================================

CREATE TABLE notification_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    channel_type    TEXT NOT NULL,                        -- 'slack', 'pagerduty', 'email', 'webhook'
    config          JSONB NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    rule_type       TEXT NOT NULL,
    -- The condition is a ClickHouse query template
    condition       JSONB NOT NULL,
    /*  Example condition:
        {
            "query_type": "clickhouse",
            "query": "SELECT count() FROM otel_logs WHERE tenant_id = {tenant_id} AND severity_number >= 17 AND timestamp > now() - INTERVAL 5 MINUTE",
            "operator": ">",
            "threshold": 100
        }
    */
    notification_channel_ids UUID[] NOT NULL DEFAULT '{}',
    severity        TEXT NOT NULL DEFAULT 'warning',
    evaluation_interval_seconds INT NOT NULL DEFAULT 60,
    cooldown_minutes INT NOT NULL DEFAULT 15,
    last_evaluated_at TIMESTAMPTZ,
    last_fired_at   TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id, enabled) WHERE enabled = TRUE;
CREATE INDEX idx_alert_events_firing ON alert_events(tenant_id, status) WHERE status = 'firing';
```

### Root Cause Analysis, NL Queries, Cost Management

```sql
-- ============================================================
-- POSTGRESQL: AI FEATURES
-- ============================================================

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

CREATE TABLE nl_queries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    natural_language TEXT NOT NULL,
    generated_query TEXT NOT NULL,                        -- the ClickHouse SQL or LogQL translation
    query_language  TEXT NOT NULL DEFAULT 'clickhouse_sql',
    execution_time_ms INT,
    result_count    INT,
    results_summary TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- POSTGRESQL: COST MANAGEMENT
-- ============================================================

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

-- ============================================================
-- POSTGRESQL: AUDIT LOG
-- ============================================================

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

## Example Queries

### Full-text search across log bodies (ClickHouse)
```sql
-- Sub-second search over billions of log lines using token bloom filter
SELECT timestamp, severity_text, body,
       resource_string['service.name'] AS service,
       attributes_string['http.status_code'] AS status_code
FROM otel_logs
WHERE tenant_id = 'tenant-abc'
  AND timestamp >= now() - INTERVAL 1 HOUR
  AND hasToken(body, 'TimeoutError')
ORDER BY timestamp DESC
LIMIT 100;
```

### Service RED metrics (Rate, Error, Duration) from traces (ClickHouse)
```sql
SELECT
    service_name,
    toStartOfMinute(start_time) AS minute,
    count() AS request_count,
    countIf(status_code = 'ERROR') / count() AS error_rate,
    quantile(0.99)(duration_ns / 1e6) AS p99_ms
FROM otel_traces
WHERE tenant_id = 'tenant-abc'
  AND start_time >= now() - INTERVAL 1 HOUR
  AND span_kind = 'SERVER'
GROUP BY service_name, minute
ORDER BY minute DESC;
```

### Cross-engine: anomaly with ClickHouse log samples
```sql
-- Step 1: PostgreSQL — get anomaly details
SELECT id, title, description, sample_log_ids, window_start, window_end
FROM anomalies
WHERE tenant_id = '...' AND status = 'open'
ORDER BY detected_at DESC LIMIT 10;

-- Step 2: ClickHouse — fetch the actual log samples (application stitches)
SELECT timestamp, severity_text, body, anomaly_score
FROM otel_logs
WHERE tenant_id = 'tenant-abc'
  AND id IN ('uuid-1', 'uuid-2', 'uuid-3')  -- from step 1
ORDER BY timestamp;
```

### Ingestion volume by service over last 7 days (ClickHouse)
```sql
SELECT
    resource_string['service.name'] AS service,
    toDate(timestamp) AS day,
    count() AS log_count,
    sum(length(body)) AS bytes_raw
FROM otel_logs
WHERE tenant_id = 'tenant-abc'
  AND timestamp >= now() - INTERVAL 7 DAY
GROUP BY service, day
ORDER BY bytes_raw DESC;
```

---

## Table Count Summary

| Category | Engine | Tables | Notes |
|----------|--------|--------|-------|
| Log Storage | ClickHouse | 1 | otel_logs (partitioned by tenant+day, TTL 30d) |
| Trace Storage | ClickHouse | 1 | otel_traces (partitioned by tenant+day, TTL 14d) |
| Metric Storage | ClickHouse | 3 | metrics_time_series, metrics_samples, metrics_samples_1h + MV |
| Security Events | ClickHouse | 1 | security_events (OCSF-aligned, TTL 365d) |
| Multi-Tenancy & Auth | PostgreSQL | 3 | tenants, users, api_keys |
| Service Registry | PostgreSQL | 2 | services, service_dependencies |
| Anomaly Detection | PostgreSQL | 3 | anomaly_models, anomalies, anomaly_baselines |
| Alerting | PostgreSQL | 3 | notification_channels, alert_rules, alert_events |
| AI Features | PostgreSQL | 2 | rca_reports, nl_queries |
| Cost Management | PostgreSQL | 2 | ingest_usage, sampling_recommendations |
| Audit | PostgreSQL | 1 | audit_log (partitioned) |
| **Total** | **Both** | **22** | **6 ClickHouse + 16 PostgreSQL** |

---

## Key Design Decisions

1. **ClickHouse for telemetry, PostgreSQL for operations.** This is the SigNoz/ClickStack-proven architecture. ClickHouse handles what it is best at (append-only columnar analytics at massive scale) while PostgreSQL handles what it is best at (ACID transactions, foreign keys, RLS). Neither engine is asked to do something it was not designed for.

2. **OTLP-native ClickHouse schema.** The `otel_logs` and `otel_traces` tables map 1:1 to OpenTelemetry data model fields. This eliminates transformation overhead in the ingestion pipeline — the OTLP Collector can write directly to ClickHouse via the native ClickHouse exporter.

3. **Map columns for variable attributes.** ClickHouse's `Map(LowCardinality(String), String)` type stores OpenTelemetry attributes without schema changes when new attributes appear. This is more efficient than JSONB because Map columns participate in columnar compression and can be queried with native operators (`resource_string['service.name']`).

4. **Token bloom filter for full-text search.** The `tokenbf_v1` index on `body` enables sub-second full-text search over billions of log lines without the operational complexity of Elasticsearch's inverted index. It has a small false-positive rate but eliminates 99%+ of irrelevant granules before scanning.

5. **LowCardinality for enum-like strings.** Columns like `severity_text`, `source_type`, `span_kind`, and `service_name` use `LowCardinality(String)` which stores a dictionary of unique values — reducing storage by 5-10x for columns with fewer than ~10K unique values.

6. **Gorilla encoding for metric values.** The `metrics_samples` table uses Gorilla encoding (`CODEC(Gorilla, LZ4)`) for float values, which is specifically designed for time-series data and achieves 2-4x better compression than generic LZ4 on metric workloads.

7. **Materialized views for automatic rollup.** The `metrics_samples_1h_mv` materialized view automatically aggregates raw metric samples into 1-hour rollups. This provides fast long-range queries (weeks/months) without scanning raw data, while raw samples are retained for short-term precision.

8. **TTL-based retention.** Each ClickHouse table has a TTL clause that automatically drops expired partitions. Logs default to 30 days, traces to 14 days, metrics to 90 days (raw) / 365 days (rollups), and security events to 365 days. Tenants can override these defaults via the PostgreSQL `tenants.retention_config` JSONB field, and the application adjusts ClickHouse TTL accordingly.

9. **Cross-engine references by value, not FK.** PostgreSQL's `anomalies.sample_log_ids` stores ClickHouse log record UUIDs as TEXT arrays, not foreign keys. The application layer handles the cross-engine lookup. This is an inherent trade-off of polyglot persistence — referential integrity across engines is application-enforced.

10. **OCSF-aligned security events table.** A dedicated `security_events` table uses OCSF `class_uid`, `category_uid`, and `activity_id` columns for normalized security event correlation. This enables queries like "show all denied authentication attempts across all sources" regardless of whether the source was a firewall, application, or cloud provider.
