# Data Model Suggestion 1: Entity-Centric Normalized Relational

> Project: Log Aggregation & Anomaly Detection · Created: 2026-05-11

## Philosophy

This approach models every concept as a dedicated PostgreSQL table with strict foreign key relationships, normalized to third normal form (3NF). Metadata about services, teams, alerts, anomalies, and configuration lives in well-typed columns with referential integrity enforced at the database level. Log and trace data — the high-volume telemetry — is stored in partitioned tables with time-based retention, while operational tables (users, teams, alert rules) follow traditional relational patterns.

The normalized relational model is the architecture used by mature enterprise platforms where data integrity, compliance auditability, and complex cross-entity queries are paramount. Systems like PagerDuty's incident management backend, Graylog's metadata layer, and enterprise SIEM platforms (Wazuh, Splunk's configuration store) use this pattern for their operational data. PostgreSQL's row-level security (RLS) provides database-enforced multi-tenant isolation without application-layer workarounds.

This model prioritizes correctness and queryability over raw ingestion throughput. It is most appropriate when the platform serves a moderate number of tenants with strict compliance requirements (ISO 27001, NIST SP 800-92) and when the team values the operational simplicity of a single database engine over the complexity of polyglot persistence.

**Best for:** Teams that want a single PostgreSQL deployment handling both telemetry and metadata, with strong referential integrity, RBAC, and compliance audit trails — suitable for moderate-scale deployments (up to ~50K logs/second).

**Trade-offs:**
- (+) Full referential integrity — orphaned records are impossible
- (+) PostgreSQL RLS provides database-enforced multi-tenant isolation
- (+) Rich JOIN queries across all entities (logs, traces, alerts, anomalies, services)
- (+) Mature ecosystem: pg_partman for retention, pg_stat_statements for query optimization
- (+) Single database engine reduces operational complexity
- (-) PostgreSQL is not optimized for high-cardinality columnar analytics — full-text search over billions of log lines will be slower than ClickHouse or Elasticsearch
- (-) Storage cost is higher than columnar engines (3-5x vs ClickHouse compression)
- (-) Write throughput caps around 50-100K rows/second on a single node without sharding
- (-) Partitioned tables with billions of rows require careful vacuum and index management

---

## Standards Alignment

| Standard | How It's Used |
|----------|---------------|
| OpenTelemetry Logs Data Model | Log record columns mirror OTLP fields: `timestamp`, `observed_timestamp`, `severity_number`, `severity_text`, `body`, `trace_id`, `span_id`, `resource_attributes`, `log_attributes` |
| OCSF (Open Cybersecurity Schema Framework) | Security events stored in `security_events` table with OCSF `class_uid`, `category_uid`, `activity_id`, `action_id` columns for normalized cross-source correlation |
| RFC 5424 (Syslog Protocol) | Syslog-specific fields (`facility`, `hostname`, `app_name`, `proc_id`, `msg_id`) mapped to dedicated columns in `log_records` |
| W3C Trace Context | `trace_id` and `span_id` columns enable log-to-trace correlation per W3C `traceparent` header |
| ISO 27001:2022 Annex A 8.15 | Audit trail table (`audit_log`) records all configuration changes with actor, action, and timestamp |
| NIST SP 800-92 | Retention policies modeled as `retention_policies` table with configurable per-source retention periods |
| OWASP Logging Vocabulary | Standard event type taxonomy used in `event_type` enum values |
| OAuth 2.0 / OIDC | Users and API keys support OAuth/OIDC-based authentication with `identity_provider` and `external_id` fields |

---

## Multi-Tenancy & Access Control

```sql
-- ============================================================
-- MULTI-TENANCY FOUNDATION
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,                -- URL-safe identifier
    plan            TEXT NOT NULL DEFAULT 'free',        -- free, pro, enterprise
    settings        JSONB NOT NULL DEFAULT '{}',        -- tenant-specific config
    retention_days  INT NOT NULL DEFAULT 30,
    max_ingest_gb   NUMERIC(10,2),                      -- monthly ingest limit
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    display_name    TEXT,
    identity_provider TEXT,                              -- 'oidc', 'saml', 'local'
    external_id     TEXT,                                -- IdP subject identifier
    role            TEXT NOT NULL DEFAULT 'viewer',      -- admin, editor, viewer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, email)
);

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    created_by      UUID REFERENCES users(id),
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,                       -- bcrypt hash of API key
    scopes          TEXT[] NOT NULL DEFAULT '{}',        -- e.g. {'logs:write', 'alerts:read'}
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_users_tenant ON users(tenant_id);

-- Row-Level Security: every table with tenant_id gets this policy
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

## Service & Infrastructure Registry

```sql
-- ============================================================
-- SERVICE REGISTRY
-- ============================================================

CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                       -- e.g. 'payment-service'
    namespace       TEXT,                                -- e.g. 'production', 'staging'
    environment     TEXT NOT NULL DEFAULT 'production',
    service_version TEXT,
    language        TEXT,                                -- e.g. 'go', 'python', 'java'
    owner_team      TEXT,
    tags            JSONB NOT NULL DEFAULT '{}',
    -- Resource attributes per OTel semantic conventions
    resource_attributes JSONB NOT NULL DEFAULT '{}',
    /*  Example resource_attributes:
        {
            "service.name": "payment-service",
            "service.namespace": "production",
            "host.name": "ip-10-0-1-42",
            "cloud.provider": "aws",
            "cloud.region": "us-east-1",
            "k8s.pod.name": "payment-service-7b9f4c-x2k9d",
            "k8s.namespace.name": "payments"
        }
    */
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name, namespace, environment)
);

CREATE TABLE service_dependencies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    dependency_type TEXT NOT NULL DEFAULT 'calls',       -- calls, publishes_to, reads_from
    discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    call_count_24h  BIGINT DEFAULT 0,
    UNIQUE(tenant_id, source_service_id, target_service_id, dependency_type)
);

CREATE INDEX idx_services_tenant ON services(tenant_id);
CREATE INDEX idx_service_deps_source ON service_dependencies(source_service_id);
CREATE INDEX idx_service_deps_target ON service_dependencies(target_service_id);
```

## Log Records (Partitioned)

```sql
-- ============================================================
-- LOG STORAGE (time-partitioned)
-- ============================================================

CREATE TABLE log_records (
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    -- OpenTelemetry Logs Data Model fields
    timestamp           TIMESTAMPTZ NOT NULL,            -- OTel: Timestamp (event time)
    observed_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(), -- OTel: ObservedTimestamp
    severity_number     SMALLINT,                        -- OTel: SeverityNumber (1-24)
    severity_text       TEXT,                            -- OTel: SeverityText (TRACE..FATAL)
    body                TEXT,                            -- OTel: Body (log message)
    -- Trace correlation (W3C Trace Context)
    trace_id            TEXT,                            -- 32-char hex from traceparent
    span_id             TEXT,                            -- 16-char hex from traceparent
    trace_flags         SMALLINT,                        -- W3C trace-flags
    -- Source identification
    service_id          UUID REFERENCES services(id),
    source_type         TEXT,                            -- 'otlp', 'syslog', 'http', 'fluent'
    -- Syslog-specific fields (RFC 5424)
    syslog_facility     SMALLINT,
    syslog_hostname     TEXT,
    syslog_app_name     TEXT,
    syslog_proc_id      TEXT,
    syslog_msg_id       TEXT,
    -- Flexible attributes
    resource_attributes JSONB NOT NULL DEFAULT '{}',
    log_attributes      JSONB NOT NULL DEFAULT '{}',
    /*  Example log_attributes:
        {
            "http.method": "POST",
            "http.status_code": 500,
            "http.url": "/api/v1/payments",
            "exception.type": "TimeoutError",
            "exception.message": "upstream connection timed out"
        }
    */
    -- Anomaly detection results (populated asynchronously)
    anomaly_score       REAL,                            -- 0.0-1.0 probability
    anomaly_detected    BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (tenant_id, timestamp, id)
) PARTITION BY RANGE (timestamp);

-- Create daily partitions (managed by pg_partman in production)
-- Example: CREATE TABLE log_records_2026_05_11 PARTITION OF log_records
--          FOR VALUES FROM ('2026-05-11') TO ('2026-05-12');

CREATE INDEX idx_log_records_service ON log_records(tenant_id, service_id, timestamp DESC);
CREATE INDEX idx_log_records_severity ON log_records(tenant_id, severity_number, timestamp DESC);
CREATE INDEX idx_log_records_trace ON log_records(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX idx_log_records_anomaly ON log_records(tenant_id, timestamp DESC)
    WHERE anomaly_detected = TRUE;

-- Full-text search index on log body
CREATE INDEX idx_log_records_body_fts ON log_records
    USING GIN (to_tsvector('english', body));

ALTER TABLE log_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_logs ON log_records
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

## Trace Spans (Partitioned)

```sql
-- ============================================================
-- DISTRIBUTED TRACES
-- ============================================================

CREATE TABLE trace_spans (
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL,
    trace_id            TEXT NOT NULL,                   -- W3C: 32-char hex
    span_id             TEXT NOT NULL,                   -- W3C: 16-char hex
    parent_span_id      TEXT,                            -- NULL for root spans
    operation_name      TEXT NOT NULL,
    service_id          UUID REFERENCES services(id),
    span_kind           TEXT,                            -- CLIENT, SERVER, PRODUCER, CONSUMER, INTERNAL
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    duration_ns         BIGINT NOT NULL,                 -- nanoseconds
    status_code         TEXT,                            -- OK, ERROR, UNSET
    status_message      TEXT,
    resource_attributes JSONB NOT NULL DEFAULT '{}',
    span_attributes     JSONB NOT NULL DEFAULT '{}',
    events              JSONB NOT NULL DEFAULT '[]',     -- span events array
    links               JSONB NOT NULL DEFAULT '[]',     -- span links array
    PRIMARY KEY (tenant_id, start_time, id)
) PARTITION BY RANGE (start_time);

CREATE INDEX idx_trace_spans_trace ON trace_spans(trace_id);
CREATE INDEX idx_trace_spans_service ON trace_spans(tenant_id, service_id, start_time DESC);
CREATE INDEX idx_trace_spans_errors ON trace_spans(tenant_id, start_time DESC)
    WHERE status_code = 'ERROR';

ALTER TABLE trace_spans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_traces ON trace_spans
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

## Anomaly Detection

```sql
-- ============================================================
-- ANOMALY DETECTION
-- ============================================================

CREATE TABLE anomaly_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_type      TEXT NOT NULL,                       -- 'logbert', 'statistical', 'llm_semantic'
    model_version   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'training',    -- training, active, retired
    config          JSONB NOT NULL DEFAULT '{}',
    training_started_at TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    last_evaluation_at TIMESTAMPTZ,
    precision_score REAL,                                -- model evaluation metrics
    recall_score    REAL,
    f1_score        REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomalies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_id        UUID REFERENCES anomaly_models(id),
    anomaly_type    TEXT NOT NULL,                       -- 'volume_spike', 'novel_pattern', 'error_rate', 'latency'
    severity        TEXT NOT NULL DEFAULT 'warning',     -- critical, warning, info
    score           REAL NOT NULL,                       -- 0.0-1.0
    title           TEXT NOT NULL,                       -- human-readable summary
    description     TEXT,                                -- AI-generated explanation
    -- Time window of the anomaly
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    -- Context
    sample_log_ids  UUID[],                              -- representative log record IDs
    related_trace_ids TEXT[],                            -- correlated trace IDs
    -- Resolution
    status          TEXT NOT NULL DEFAULT 'open',        -- open, acknowledged, resolved, false_positive
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID REFERENCES users(id),
    feedback        TEXT,                                -- user feedback on accuracy
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomaly_baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id),
    metric_name     TEXT NOT NULL,                       -- 'error_rate', 'log_volume', 'p99_latency'
    -- Learned baseline values
    baseline_mean   DOUBLE PRECISION NOT NULL,
    baseline_stddev DOUBLE PRECISION NOT NULL,
    baseline_p50    DOUBLE PRECISION,
    baseline_p95    DOUBLE PRECISION,
    baseline_p99    DOUBLE PRECISION,
    -- Time-of-week patterns
    hourly_pattern  JSONB,                               -- 24-element array of expected values
    dow_pattern     JSONB,                               -- 7-element array (Mon-Sun multipliers)
    sample_count    BIGINT NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, service_id, metric_name)
);

CREATE INDEX idx_anomalies_tenant_time ON anomalies(tenant_id, detected_at DESC);
CREATE INDEX idx_anomalies_service ON anomalies(tenant_id, service_id, detected_at DESC);
CREATE INDEX idx_anomalies_status ON anomalies(tenant_id, status) WHERE status = 'open';
```

## Alerting & Incidents

```sql
-- ============================================================
-- ALERTING
-- ============================================================

CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    -- Condition
    rule_type       TEXT NOT NULL,                       -- 'threshold', 'anomaly', 'log_pattern', 'absence'
    condition       JSONB NOT NULL,
    /*  Example condition (threshold):
        {
            "metric": "error_rate",
            "operator": ">",
            "threshold": 0.05,
            "window_minutes": 5,
            "service_filter": {"name": "payment-service"}
        }
    */
    -- Notification
    notification_channels UUID[] NOT NULL DEFAULT '{}',
    severity        TEXT NOT NULL DEFAULT 'warning',
    -- Suppression
    cooldown_minutes INT NOT NULL DEFAULT 15,
    mute_until      TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    channel_type    TEXT NOT NULL,                       -- 'slack', 'pagerduty', 'email', 'webhook'
    config          JSONB NOT NULL,
    /*  Example config (slack):
        {
            "webhook_url": "https://hooks.slack.com/services/...",
            "channel": "#alerts-production",
            "mention_on_critical": "@oncall"
        }
    */
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id   UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    anomaly_id      UUID REFERENCES anomalies(id),
    status          TEXT NOT NULL DEFAULT 'firing',      -- firing, resolved
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
    notification_sent BOOLEAN NOT NULL DEFAULT FALSE,
    notification_response JSONB,                         -- delivery status from channel
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id);
CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id, fired_at DESC);
CREATE INDEX idx_alert_events_firing ON alert_events(tenant_id, status)
    WHERE status = 'firing';
```

## Root Cause Analysis & AI

```sql
-- ============================================================
-- ROOT CAUSE ANALYSIS
-- ============================================================

CREATE TABLE rca_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    anomaly_id      UUID REFERENCES anomalies(id),
    -- AI-generated root cause analysis
    summary         TEXT NOT NULL,                       -- plain-language narrative
    probable_cause  TEXT,
    confidence      REAL,                                -- 0.0-1.0
    -- Evidence chain
    evidence        JSONB NOT NULL DEFAULT '[]',
    /*  Example evidence:
        [
            {"type": "deployment", "service": "payment-service", "deployed_at": "2026-05-11T14:30:00Z", "commit": "abc123"},
            {"type": "log_pattern", "pattern": "TimeoutError connecting to redis", "count": 847, "window": "14:30-14:45"},
            {"type": "metric_change", "metric": "redis.connection_pool.active", "before": 10, "after": 50},
            {"type": "trace_anomaly", "trace_id": "abc...", "span": "redis.get", "p99_before_ms": 5, "p99_after_ms": 2400}
        ]
    */
    related_services UUID[],                             -- services involved in the incident
    -- User feedback
    helpful         BOOLEAN,
    feedback_notes  TEXT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nl_queries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    natural_language TEXT NOT NULL,                      -- user's plain-English question
    generated_query TEXT NOT NULL,                       -- translated LogQL/SQL
    query_language  TEXT NOT NULL,                       -- 'sql', 'logql'
    results_summary TEXT,                                -- AI-generated result explanation
    execution_time_ms INT,
    result_count    INT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rca_reports_anomaly ON rca_reports(anomaly_id);
CREATE INDEX idx_nl_queries_user ON nl_queries(tenant_id, user_id, created_at DESC);
```

## Retention & Cost Management

```sql
-- ============================================================
-- RETENTION & COST MANAGEMENT
-- ============================================================

CREATE TABLE retention_policies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    -- What it applies to
    signal_type     TEXT NOT NULL,                       -- 'logs', 'traces', 'metrics'
    service_filter  JSONB,                               -- optional service name/tag filter
    severity_filter TEXT[],                              -- e.g. {'DEBUG', 'INFO'} for aggressive retention
    -- Retention rules
    hot_retention_days  INT NOT NULL DEFAULT 7,          -- fast-query storage
    warm_retention_days INT NOT NULL DEFAULT 30,         -- compressed, slower queries
    cold_retention_days INT NOT NULL DEFAULT 90,         -- archived, restore-on-demand
    -- Sampling
    sampling_rate   REAL DEFAULT 1.0,                    -- 1.0 = keep all, 0.1 = keep 10%
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE TABLE ingest_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    date            DATE NOT NULL,
    signal_type     TEXT NOT NULL,                       -- 'logs', 'traces', 'metrics'
    -- Volume metrics
    record_count    BIGINT NOT NULL DEFAULT 0,
    bytes_ingested  BIGINT NOT NULL DEFAULT 0,
    bytes_stored    BIGINT NOT NULL DEFAULT 0,           -- after compression
    -- Cost (calculated)
    estimated_cost_usd NUMERIC(10,4),
    UNIQUE(tenant_id, service_id, date, signal_type)
);

CREATE TABLE sampling_recommendations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id),
    log_pattern     TEXT NOT NULL,                       -- e.g. 'Health check response 200'
    current_volume_day BIGINT NOT NULL,
    recommended_rate REAL NOT NULL,                      -- e.g. 0.01 = sample 1%
    estimated_savings_gb NUMERIC(10,2),
    reason          TEXT NOT NULL,                       -- AI explanation
    status          TEXT NOT NULL DEFAULT 'pending',     -- pending, applied, dismissed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingest_usage_tenant_date ON ingest_usage(tenant_id, date DESC);
CREATE INDEX idx_sampling_recs_tenant ON sampling_recommendations(tenant_id, status);
```

## Audit Log

```sql
-- ============================================================
-- AUDIT LOG (ISO 27001 compliance)
-- ============================================================

CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    actor_id        UUID,                                -- user who performed the action
    actor_type      TEXT NOT NULL,                       -- 'user', 'api_key', 'system'
    action          TEXT NOT NULL,                       -- 'create', 'update', 'delete', 'login', 'export'
    resource_type   TEXT NOT NULL,                       -- 'alert_rule', 'user', 'retention_policy', etc.
    resource_id     UUID,
    changes         JSONB,                               -- before/after diff
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
```

## Example Queries

### Find anomalous log patterns for a service in the last hour
```sql
SELECT l.timestamp, l.severity_text, l.body, l.anomaly_score,
       a.title AS anomaly_title, a.description AS anomaly_description
FROM log_records l
LEFT JOIN anomalies a ON a.service_id = l.service_id
    AND l.timestamp BETWEEN a.window_start AND a.window_end
WHERE l.tenant_id = '...'
  AND l.service_id = '...'
  AND l.timestamp > now() - INTERVAL '1 hour'
  AND l.anomaly_detected = TRUE
ORDER BY l.anomaly_score DESC
LIMIT 50;
```

### Trace a request across services (log-to-trace correlation)
```sql
SELECT ts.operation_name, ts.service_id, s.name AS service_name,
       ts.duration_ns / 1e6 AS duration_ms, ts.status_code,
       l.body AS related_log
FROM trace_spans ts
JOIN services s ON s.id = ts.service_id
LEFT JOIN log_records l ON l.trace_id = ts.trace_id AND l.span_id = ts.span_id
WHERE ts.trace_id = '0af7651916cd43dd8448eb211c80319c'
ORDER BY ts.start_time;
```

### Cost attribution per team per day
```sql
SELECT s.owner_team, iu.date, iu.signal_type,
       SUM(iu.bytes_ingested) / 1e9 AS gb_ingested,
       SUM(iu.estimated_cost_usd) AS cost_usd
FROM ingest_usage iu
JOIN services s ON s.id = iu.service_id
WHERE iu.tenant_id = '...'
  AND iu.date BETWEEN '2026-05-01' AND '2026-05-11'
GROUP BY s.owner_team, iu.date, iu.signal_type
ORDER BY cost_usd DESC;
```

---

## Table Count Summary

| Category | Tables | Notes |
|----------|--------|-------|
| Multi-Tenancy & Auth | 3 | tenants, users, api_keys |
| Service Registry | 2 | services, service_dependencies |
| Log Storage | 1 | log_records (partitioned by day) |
| Trace Storage | 1 | trace_spans (partitioned by day) |
| Anomaly Detection | 3 | anomaly_models, anomalies, anomaly_baselines |
| Alerting | 3 | alert_rules, notification_channels, alert_events |
| Root Cause / AI | 2 | rca_reports, nl_queries |
| Retention & Cost | 3 | retention_policies, ingest_usage, sampling_recommendations |
| Audit | 1 | audit_log (partitioned) |
| **Total** | **19** | |

---

## Key Design Decisions

1. **PostgreSQL as sole engine.** Choosing a single database engine dramatically reduces operational complexity (one backup strategy, one monitoring stack, one upgrade path). The trade-off is lower throughput than ClickHouse for pure analytics, but PostgreSQL's partitioning, GIN indexes, and RLS cover the needs of moderate-scale deployments.

2. **Time-partitioned telemetry tables.** `log_records`, `trace_spans`, and `audit_log` are partitioned by time range (daily). This enables efficient retention management (DROP PARTITION is instant), fast time-range queries, and parallelized vacuuming. Managed by pg_partman in production.

3. **OTLP-aligned log schema.** Every column in `log_records` maps directly to an OpenTelemetry Logs Data Model field. This eliminates transformation overhead during OTLP ingestion and ensures semantic compatibility with the broader OTel ecosystem.

4. **JSONB for variable attributes.** `resource_attributes`, `log_attributes`, and `span_attributes` use JSONB columns because attribute keys vary per service and deployment. GIN indexes on these columns support containment queries (`@>`) for filtering on specific attribute values.

5. **Row-Level Security for multi-tenancy.** Every table with a `tenant_id` column has an RLS policy. The application sets `app.current_tenant` at connection time, and PostgreSQL enforces isolation at the query engine level — even buggy application code cannot leak data across tenants.

6. **Anomaly scores stored inline.** The `anomaly_score` and `anomaly_detected` columns on `log_records` are populated asynchronously by the anomaly detection pipeline. This allows efficient queries for "show me anomalous logs" without joining to a separate results table.

7. **Explicit service dependency graph.** The `service_dependencies` table stores directed edges between services, discovered from trace data. This enables dependency-aware root cause analysis ("which upstream service might have caused this downstream error?").

8. **Separation of anomaly models and results.** `anomaly_models` tracks model lifecycle (training, active, retired) with evaluation metrics. `anomalies` tracks detected anomalies with user feedback. This separation supports A/B testing of different model versions and continuous improvement based on false-positive feedback.

9. **Cost management as a first-class concern.** `ingest_usage` and `sampling_recommendations` tables address the #1 operational pain point identified in the market research: log volume cost explosion. Per-service, per-day cost tracking enables team-level chargeback.

10. **ISO 27001-compliant audit trail.** The `audit_log` table records all configuration changes with before/after diffs, actor identification, and IP address. Partitioned separately from telemetry data to support different retention policies (audit logs often retained for years).
