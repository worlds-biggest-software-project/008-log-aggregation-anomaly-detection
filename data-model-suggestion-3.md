# Data Model Suggestion 3: Event-Sourced / Audit-First (Immutable Event Store + CQRS)

> Project: Log Aggregation & Anomaly Detection · Created: 2026-05-11

## Philosophy

This approach treats the platform's own operational data with the same rigor it applies to customer telemetry: every state change is an immutable event in an append-only store. The event store is the single source of truth. Current state is derived by replaying events into materialized read models (CQRS — Command Query Responsibility Segregation). Telemetry data (logs, traces, metrics) is inherently event-sourced by nature — it is already an append-only stream. This model extends that principle to the platform's configuration, alerting, and anomaly management.

Event sourcing is the architecture of financial trading systems (where regulatory audit trails are mandatory), healthcare EHRs (where every change must be traceable), and distributed systems like Apache Kafka (which is itself an immutable log). For an observability platform subject to ISO 27001 and NIST SP 800-92 compliance requirements, event sourcing eliminates the need for a separate audit log — the event store IS the audit log. Every configuration change, alert rule modification, anomaly resolution, and user action is a first-class event with a timestamp, actor, and payload.

The key insight for an observability platform is that logs are already events — so the entire system speaks one language. The ingestion pipeline, the anomaly detection pipeline, the alerting pipeline, and the configuration management system all produce and consume events from the same event store. This enables powerful temporal queries: "What was the alert threshold for this service at the time this anomaly was detected?" is trivially answerable by replaying events up to that timestamp.

**Best for:** Organizations with strict compliance requirements (SOX, HIPAA, ISO 27001) where a complete, tamper-evident audit trail of every system state change is mandatory. Also ideal when the platform needs temporal queries ("what was true at time X?") for debugging and forensics.

**Trade-offs:**
- (+) Complete audit trail by construction — no separate audit log table needed
- (+) Temporal queries ("state at time X") are native — replay events up to any timestamp
- (+) Event replay enables rebuilding read models after schema changes or bug fixes
- (+) Natural fit for an observability platform — logs and traces are already event streams
- (+) Supports multiple read models from the same event stream (different views for different consumers)
- (+) Tamper-evident: hash chains on events detect unauthorized modifications
- (-) Higher storage for operational data — events are never deleted, only superseded
- (-) Read model materialization adds latency — eventual consistency between writes and reads
- (-) More complex implementation: projections, snapshots, event versioning
- (-) Debugging requires understanding both the event store and the current read model
- (-) Schema evolution of events requires careful versioning (upcasting old events)

---

## Standards Alignment

| Standard | How It's Used |
|----------|---------------|
| OpenTelemetry Logs Data Model | Log events in the telemetry event stream follow OTLP field structure |
| ISO 27001:2022 Annex A 8.15 | The event store IS the audit trail — every configuration change is an immutable event with actor, timestamp, and payload |
| NIST SP 800-92 | Event store retention satisfies "log protection and storage" requirements; hash chains provide tamper evidence |
| OCSF | Security-relevant events in the stream carry OCSF class_uid and category_uid for normalized correlation |
| W3C Trace Context | Trace correlation events carry W3C trace_id and span_id for cross-signal linking |
| RFC 5424 | Syslog ingestion events preserve RFC 5424 structured data elements |
| OWASP Logging Vocabulary | Platform operational events use OWASP-standardized event type names |

---

## Event Store (ClickHouse — Append-Only)

```sql
-- ============================================================
-- THE EVENT STORE: Single source of truth for ALL platform state
-- ============================================================
-- Every state change in the system is an event. Events are NEVER updated or deleted.
-- Current state is computed by projecting (replaying) events.

CREATE TABLE event_store
(
    -- Event identity
    event_id            UUID DEFAULT generateUUIDv4(),
    sequence_number     UInt64,                              -- monotonically increasing per stream
    
    -- Stream identity (the "aggregate" this event belongs to)
    stream_type         LowCardinality(String),              -- 'tenant', 'service', 'alert_rule', 'anomaly', 'user', 'log_ingest', 'trace_ingest'
    stream_id           String,                              -- UUID of the aggregate root
    
    -- Event metadata
    event_type          LowCardinality(String),              -- e.g. 'AlertRuleCreated', 'AnomalyDetected', 'LogBatchIngested'
    event_version       UInt16 DEFAULT 1,                    -- schema version for upcasting
    
    -- Temporal
    occurred_at         DateTime64(6) CODEC(DoubleDelta, LZ4),  -- when the event happened
    recorded_at         DateTime64(6) DEFAULT now64(6),          -- when the event was recorded
    
    -- Actor (who/what caused this event)
    actor_type          LowCardinality(String),              -- 'user', 'api_key', 'system', 'pipeline'
    actor_id            String DEFAULT '',                   -- UUID of the actor
    
    -- Multi-tenancy
    tenant_id           LowCardinality(String),
    
    -- Payload (the event data)
    payload             String CODEC(ZSTD(3)),               -- JSON-encoded event payload
    /*  Example payloads by event_type:

        AlertRuleCreated:
        {
            "name": "High error rate",
            "rule_type": "threshold",
            "condition": {"metric": "error_rate", "operator": ">", "threshold": 0.05},
            "severity": "critical",
            "notification_channels": ["uuid-slack-prod"]
        }

        AnomalyDetected:
        {
            "anomaly_type": "novel_pattern",
            "service_name": "payment-service",
            "score": 0.94,
            "title": "New TimeoutError pattern in payment-service",
            "window_start": "2026-05-11T14:30:00Z",
            "window_end": "2026-05-11T14:45:00Z",
            "sample_log_ids": ["uuid1", "uuid2"]
        }

        AlertRuleUpdated:
        {
            "field": "condition.threshold",
            "old_value": 0.05,
            "new_value": 0.10,
            "reason": "Reducing sensitivity after false positives"
        }

        UserLoggedIn:
        {
            "email": "alice@example.com",
            "ip_address": "203.0.113.42",
            "identity_provider": "oidc",
            "user_agent": "Mozilla/5.0..."
        }
    */

    -- Tamper evidence
    prev_event_hash     String DEFAULT '',                   -- SHA-256 of previous event in stream
    event_hash          String,                              -- SHA-256(event_id + stream_id + payload + prev_hash)

    -- Causation & correlation
    causation_id        String DEFAULT '',                   -- event_id that caused this event
    correlation_id      String DEFAULT '',                   -- groups related events across streams

    INDEX idx_stream_type stream_type TYPE set(0) GRANULARITY 1,
    INDEX idx_event_type event_type TYPE set(0) GRANULARITY 1,
    INDEX idx_actor actor_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_correlation correlation_id TYPE bloom_filter(0.01) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toYYYYMM(occurred_at))
ORDER BY (tenant_id, stream_type, stream_id, sequence_number)
SETTINGS index_granularity = 8192;

-- CRITICAL: No TTL on the event store — events are retained forever
-- (or moved to cold storage via lifecycle policy)
```

## Telemetry Event Streams (ClickHouse)

```sql
-- ============================================================
-- TELEMETRY EVENTS: Logs as first-class events
-- ============================================================
-- Log records ARE events. They flow through the same event infrastructure.
-- This table is optimized for log-specific queries while sharing the event paradigm.

CREATE TABLE log_events
(
    -- Event envelope
    event_id            UUID DEFAULT generateUUIDv4(),
    tenant_id           LowCardinality(String),
    occurred_at         DateTime64(9) CODEC(DoubleDelta, LZ4),
    observed_at         DateTime64(9) CODEC(DoubleDelta, LZ4),
    
    -- OTel Logs Data Model
    severity_number     UInt8,
    severity_text       LowCardinality(String),
    body                String CODEC(ZSTD(3)),
    
    -- Trace correlation
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    trace_flags         UInt8,
    
    -- Resource & attributes (OTel)
    resource_fingerprint String CODEC(ZSTD(1)),
    resource_attrs      Map(LowCardinality(String), String),
    log_attrs           Map(LowCardinality(String), String),
    log_attrs_number    Map(LowCardinality(String), Float64),
    
    -- Source
    source_type         LowCardinality(String),
    
    -- Anomaly detection results
    anomaly_score       Float32 DEFAULT 0.0,
    anomaly_detected    Bool DEFAULT false,
    anomaly_event_id    String DEFAULT '',                   -- references event_store event_id for the AnomalyDetected event
    
    -- Materialized
    service_name        String MATERIALIZED resource_attrs['service.name'],

    INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_anomaly anomaly_detected TYPE set(2) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(occurred_at))
ORDER BY (tenant_id, resource_fingerprint, severity_number, occurred_at)
TTL toDateTime(occurred_at) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192;


CREATE TABLE trace_events
(
    event_id            UUID DEFAULT generateUUIDv4(),
    tenant_id           LowCardinality(String),
    
    -- Span data
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    parent_span_id      String CODEC(ZSTD(1)),
    operation_name      LowCardinality(String),
    service_name        LowCardinality(String),
    span_kind           LowCardinality(String),
    status_code         LowCardinality(String),
    status_message      String CODEC(ZSTD(1)),
    
    start_time          DateTime64(9) CODEC(DoubleDelta, LZ4),
    end_time            DateTime64(9) CODEC(DoubleDelta, LZ4),
    duration_ns         UInt64 CODEC(T64, LZ4),
    
    resource_attrs      Map(LowCardinality(String), String),
    span_attrs          Map(LowCardinality(String), String),
    span_attrs_number   Map(LowCardinality(String), Float64),
    
    events_name         Array(LowCardinality(String)),
    events_timestamp    Array(DateTime64(9)),
    
    has_error           Bool MATERIALIZED status_code = 'ERROR',

    INDEX idx_trace trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status status_code TYPE set(0) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(start_time))
ORDER BY (tenant_id, service_name, operation_name, start_time)
TTL toDateTime(start_time) + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192;


CREATE TABLE metric_events
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    metric_name         LowCardinality(String),
    metric_type         LowCardinality(String),
    labels              Map(LowCardinality(String), String),
    timestamp           DateTime64(3) CODEC(DoubleDelta, LZ4),
    value               Float64 CODEC(Gorilla, LZ4)
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, fingerprint, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
```

## Read Models (PostgreSQL — Materialized Projections)

Read models are materialized views of the event store, rebuilt by replaying events. They provide the fast, query-friendly current-state views that the UI and API need. If a read model becomes corrupted or needs schema changes, it can be rebuilt from the event store.

```sql
-- ============================================================
-- READ MODEL: Current state projections (rebuilt from event replay)
-- ============================================================

-- Projection metadata: tracks which events have been processed by each read model
CREATE TABLE projection_checkpoints (
    projection_name TEXT PRIMARY KEY,
    last_event_id   TEXT NOT NULL,                          -- last processed event_id
    last_sequence   BIGINT NOT NULL,
    last_processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL DEFAULT 'running',        -- running, paused, rebuilding
    error_message   TEXT
);

-- ============================================================
-- READ MODEL: Tenants (projected from TenantCreated, TenantUpdated, TenantPlanChanged events)
-- ============================================================

CREATE TABLE rm_tenants (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',
    settings        JSONB NOT NULL DEFAULT '{}',
    retention_config JSONB NOT NULL DEFAULT '{}',
    max_ingest_gb_month NUMERIC(10,2),
    -- Temporal: the event that last modified this row
    last_event_id   TEXT NOT NULL,
    last_event_at   TIMESTAMPTZ NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,              -- optimistic concurrency
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- READ MODEL: Users (projected from UserCreated, UserRoleChanged, UserLoggedIn events)
-- ============================================================

CREATE TABLE rm_users (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    email           TEXT NOT NULL,
    display_name    TEXT,
    identity_provider TEXT,
    external_id     TEXT,
    role            TEXT NOT NULL DEFAULT 'viewer',
    login_count     INT NOT NULL DEFAULT 0,
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    last_event_id   TEXT NOT NULL,
    last_event_at   TIMESTAMPTZ NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL,
    UNIQUE(tenant_id, email)
);

-- ============================================================
-- READ MODEL: Services (projected from ServiceDiscovered, ServiceMetadataUpdated events)
-- ============================================================

CREATE TABLE rm_services (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    name            TEXT NOT NULL,
    namespace       TEXT DEFAULT 'default',
    environment     TEXT NOT NULL DEFAULT 'production',
    language        TEXT,
    owner_team      TEXT,
    tags            JSONB NOT NULL DEFAULT '{}',
    first_seen_at   TIMESTAMPTZ NOT NULL,
    last_seen_at    TIMESTAMPTZ NOT NULL,
    last_event_id   TEXT NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, name, namespace, environment)
);

CREATE TABLE rm_service_dependencies (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    source_service_id UUID NOT NULL REFERENCES rm_services(id),
    target_service_id UUID NOT NULL REFERENCES rm_services(id),
    dependency_type TEXT NOT NULL DEFAULT 'calls',
    call_count_24h  BIGINT DEFAULT 0,
    avg_duration_ms DOUBLE PRECISION,
    error_rate_24h  REAL DEFAULT 0.0,
    last_seen_at    TIMESTAMPTZ NOT NULL,
    last_event_id   TEXT NOT NULL,
    UNIQUE(tenant_id, source_service_id, target_service_id, dependency_type)
);

-- ============================================================
-- READ MODEL: Alert Rules (projected from AlertRuleCreated, AlertRuleUpdated, AlertRuleDisabled events)
-- ============================================================

CREATE TABLE rm_alert_rules (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    name            TEXT NOT NULL,
    description     TEXT,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    rule_type       TEXT NOT NULL,
    condition       JSONB NOT NULL,
    notification_channel_ids UUID[] NOT NULL DEFAULT '{}',
    severity        TEXT NOT NULL DEFAULT 'warning',
    evaluation_interval_seconds INT NOT NULL DEFAULT 60,
    cooldown_minutes INT NOT NULL DEFAULT 15,
    last_evaluated_at TIMESTAMPTZ,
    last_fired_at   TIMESTAMPTZ,
    created_by      UUID,
    -- Event sourcing metadata
    last_event_id   TEXT NOT NULL,
    last_event_at   TIMESTAMPTZ NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- READ MODEL: Anomalies (projected from AnomalyDetected, AnomalyAcknowledged, AnomalyResolved events)
-- ============================================================

CREATE TABLE rm_anomalies (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    service_id      UUID REFERENCES rm_services(id),
    anomaly_type    TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'warning',
    score           REAL NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    detected_at     TIMESTAMPTZ NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    window_end      TIMESTAMPTZ NOT NULL,
    sample_log_ids  TEXT[],
    related_trace_ids TEXT[],
    -- Status lifecycle (each state change is an event)
    status          TEXT NOT NULL DEFAULT 'open',
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,
    resolved_at     TIMESTAMPTZ,
    resolved_by     UUID,
    user_feedback   TEXT,
    -- Event sourcing
    last_event_id   TEXT NOT NULL,
    last_event_at   TIMESTAMPTZ NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_rm_anomalies_open ON rm_anomalies(tenant_id, status) WHERE status = 'open';
CREATE INDEX idx_rm_anomalies_time ON rm_anomalies(tenant_id, detected_at DESC);

-- ============================================================
-- READ MODEL: Notification Channels, RCA Reports, NL Queries
-- ============================================================

CREATE TABLE rm_notification_channels (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    name            TEXT NOT NULL,
    channel_type    TEXT NOT NULL,
    config          JSONB NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    last_event_id   TEXT NOT NULL,
    version         BIGINT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE rm_alert_events (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    alert_rule_id   UUID NOT NULL REFERENCES rm_alert_rules(id),
    anomaly_id      UUID REFERENCES rm_anomalies(id),
    status          TEXT NOT NULL DEFAULT 'firing',
    fired_at        TIMESTAMPTZ NOT NULL,
    resolved_at     TIMESTAMPTZ,
    notification_results JSONB DEFAULT '[]',
    last_event_id   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL
);

CREATE TABLE rm_rca_reports (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    anomaly_id      UUID REFERENCES rm_anomalies(id),
    summary         TEXT NOT NULL,
    probable_cause  TEXT,
    confidence      REAL,
    evidence        JSONB NOT NULL DEFAULT '[]',
    helpful         BOOLEAN,
    feedback_notes  TEXT,
    last_event_id   TEXT NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL
);

-- ============================================================
-- READ MODEL: Usage & Cost (projected from IngestBatchRecorded events)
-- ============================================================

CREATE TABLE rm_ingest_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES rm_tenants(id),
    service_name    TEXT NOT NULL,
    date            DATE NOT NULL,
    signal_type     TEXT NOT NULL,
    record_count    BIGINT NOT NULL DEFAULT 0,
    bytes_raw       BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10,4),
    UNIQUE(tenant_id, service_name, date, signal_type)
);
```

## Event Type Catalog

The event store is only as useful as the event types are well-defined. Here is the catalog of event types for the platform:

```sql
-- ============================================================
-- EVENT TYPE CATALOG (reference, not a table)
-- ============================================================

-- TENANT LIFECYCLE
-- TenantCreated          { name, slug, plan }
-- TenantUpdated          { field, old_value, new_value }
-- TenantPlanChanged      { old_plan, new_plan }
-- TenantRetentionChanged { old_config, new_config }

-- USER LIFECYCLE
-- UserCreated            { email, display_name, role, identity_provider }
-- UserRoleChanged        { old_role, new_role }
-- UserLoggedIn           { ip_address, user_agent, identity_provider }
-- UserLoggedOut          { session_duration_seconds }
-- ApiKeyCreated          { name, scopes, expires_at }
-- ApiKeyRevoked          { reason }

-- SERVICE DISCOVERY
-- ServiceDiscovered      { name, namespace, environment, resource_attributes }
-- ServiceMetadataUpdated { field, old_value, new_value }
-- ServiceDependencyDiscovered { source_service, target_service, dependency_type }

-- TELEMETRY INGESTION
-- LogBatchIngested       { service_name, record_count, bytes_raw, source_type }
-- TraceBatchIngested     { service_name, span_count, trace_count }
-- MetricBatchIngested    { service_name, sample_count, metric_count }

-- ANOMALY DETECTION
-- AnomalyModelTrained    { model_type, model_version, service_id, training_log_count, metrics }
-- AnomalyModelActivated  { model_id, replaced_model_id }
-- AnomalyModelRetired    { model_id, reason }
-- AnomalyDetected        { anomaly_type, severity, score, title, description, window_start, window_end, sample_log_ids }
-- AnomalyAcknowledged    { anomaly_id, acknowledged_by }
-- AnomalyResolved        { anomaly_id, resolved_by, feedback }
-- AnomalyMarkedFalsePositive { anomaly_id, user_id, reason }
-- BaselineUpdated        { service_id, metric_name, old_baseline, new_baseline }

-- ALERTING
-- AlertRuleCreated       { name, rule_type, condition, severity, notification_channels }
-- AlertRuleUpdated       { field, old_value, new_value }
-- AlertRuleEnabled       { }
-- AlertRuleDisabled      { reason }
-- AlertFired             { alert_rule_id, anomaly_id, current_value, threshold }
-- AlertResolved          { alert_rule_id, resolution_reason }
-- NotificationSent       { channel_type, channel_id, alert_event_id, delivery_status }
-- NotificationFailed     { channel_id, alert_event_id, error_message }

-- NOTIFICATION CHANNELS
-- NotificationChannelCreated  { name, channel_type, config }
-- NotificationChannelVerified { channel_id }
-- NotificationChannelDeleted  { channel_id, reason }

-- AI / ROOT CAUSE ANALYSIS
-- RcaReportGenerated     { anomaly_id, summary, probable_cause, confidence, evidence }
-- RcaFeedbackReceived    { rca_report_id, helpful, feedback_notes }
-- NlQueryExecuted        { natural_language, generated_query, execution_time_ms, result_count }

-- RETENTION & COST
-- RetentionPolicyChanged { signal_type, old_days, new_days }
-- SamplingRuleApplied    { service_name, log_pattern, sample_rate }
-- IngestBatchRecorded    { service_name, signal_type, record_count, bytes_raw, date }
```

## Example Queries

### Replay alert rule history (what was the threshold at a given time?)
```sql
-- ClickHouse: Get all events for a specific alert rule, up to a point in time
SELECT occurred_at, event_type, payload
FROM event_store
WHERE tenant_id = 'tenant-abc'
  AND stream_type = 'alert_rule'
  AND stream_id = 'alert-rule-uuid'
  AND occurred_at <= '2026-05-11T14:30:00Z'
ORDER BY sequence_number ASC;

-- The application replays these events to reconstruct the alert rule's state
-- at exactly 2026-05-11T14:30:00Z — including the threshold, severity, 
-- and notification channels that were active at that moment.
```

### Find all actions by a specific user (complete audit trail)
```sql
SELECT occurred_at, event_type, stream_type, stream_id,
       payload
FROM event_store
WHERE tenant_id = 'tenant-abc'
  AND actor_type = 'user'
  AND actor_id = 'user-uuid'
ORDER BY occurred_at DESC
LIMIT 100;
```

### Correlate an anomaly detection with its alert and notification
```sql
-- Follow the correlation chain: anomaly → alert → notification
SELECT occurred_at, event_type, stream_type, payload
FROM event_store
WHERE tenant_id = 'tenant-abc'
  AND correlation_id = 'incident-correlation-uuid'
ORDER BY occurred_at ASC;

-- Returns events like:
-- AnomalyDetected → AlertFired → NotificationSent → AnomalyAcknowledged → AnomalyResolved
```

### Verify event store integrity (tamper detection)
```sql
-- Check hash chain continuity for a stream
SELECT event_id, sequence_number, event_hash, prev_event_hash
FROM event_store
WHERE tenant_id = 'tenant-abc'
  AND stream_type = 'alert_rule'
  AND stream_id = 'alert-rule-uuid'
ORDER BY sequence_number ASC;

-- Application verifies: for each event N, prev_event_hash == event_hash of event N-1
-- Any break in the chain indicates tampering or data corruption.
```

---

## Table Count Summary

| Category | Engine | Tables | Notes |
|----------|--------|--------|-------|
| Event Store | ClickHouse | 1 | event_store — all operational events, never deleted |
| Log Telemetry | ClickHouse | 1 | log_events (TTL 30d) |
| Trace Telemetry | ClickHouse | 1 | trace_events (TTL 14d) |
| Metric Telemetry | ClickHouse | 1 | metric_events (TTL 90d) |
| Projection Metadata | PostgreSQL | 1 | projection_checkpoints |
| Read Models (Tenants/Users) | PostgreSQL | 2 | rm_tenants, rm_users |
| Read Models (Services) | PostgreSQL | 2 | rm_services, rm_service_dependencies |
| Read Models (Anomalies) | PostgreSQL | 1 | rm_anomalies |
| Read Models (Alerting) | PostgreSQL | 3 | rm_alert_rules, rm_notification_channels, rm_alert_events |
| Read Models (AI) | PostgreSQL | 1 | rm_rca_reports |
| Read Models (Cost) | PostgreSQL | 1 | rm_ingest_usage |
| **Total** | **Both** | **15** | **4 ClickHouse + 11 PostgreSQL** |

---

## Key Design Decisions

1. **Single event store as source of truth.** All operational state changes flow through one append-only event table. This eliminates the need for a separate audit log and guarantees that no state change can occur without producing a traceable event. The event store is the audit trail.

2. **Hash chains for tamper evidence.** Each event stores the hash of the previous event in its stream (`prev_event_hash`). This creates a cryptographic chain that detects unauthorized modifications — critical for ISO 27001 and NIST SP 800-92 compliance where log integrity must be provable.

3. **Correlation IDs for cross-stream tracing.** The `correlation_id` field groups related events across different streams. When an anomaly triggers an alert that sends a notification, all three events share a correlation ID. This enables "incident timeline" queries that reconstruct the full lifecycle of a detection event.

4. **Causation IDs for dependency tracking.** The `causation_id` field records which event directly caused the current event. "AlertFired" was caused by "AnomalyDetected"; "NotificationSent" was caused by "AlertFired". This enables causal analysis of event chains.

5. **Read models prefixed with `rm_`.** All PostgreSQL projection tables use the `rm_` prefix to clearly distinguish them from source-of-truth data. If any `rm_` table becomes corrupted, it can be rebuilt by replaying events from the event store — no data is lost.

6. **Projection checkpoints for resumability.** The `projection_checkpoints` table tracks which events each read model has processed. If a projection worker crashes, it resumes from the last checkpoint rather than replaying the entire event store.

7. **Event type catalog as a contract.** The comprehensive event type catalog serves as a schema contract between producers and consumers. New features add new event types; old event types are never removed or modified (only versioned via `event_version`).

8. **Telemetry as events, not separate entities.** Log records, trace spans, and metric samples are modeled as events in their own ClickHouse tables. This creates a unified mental model: everything in the system is an event. The telemetry tables are optimized differently from the event store (TTL, indexes, sort order) but share the same conceptual framework.

9. **Optimistic concurrency via version numbers.** Each read model row includes a `version` field that increments with each event projection. This prevents concurrent projection workers from applying events out of order and enables the API to detect stale reads.

10. **Event store has no TTL.** Unlike telemetry tables (which have 14-90 day TTLs), the operational event store retains events indefinitely. This is by design: the event store is the legal record of all platform configuration changes. Cold storage migration (S3/GCS) can be implemented for events older than a configurable threshold to manage costs.
