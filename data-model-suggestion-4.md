# Data Model Suggestion 4: Graph-Relational (Knowledge Graph + ClickHouse + PostgreSQL)

> Project: Log Aggregation & Anomaly Detection · Created: 2026-05-11

## Philosophy

This approach adds a property graph layer to the observability platform, modeling the relationships between services, infrastructure, anomalies, deployments, and incidents as a traversable knowledge graph. The graph captures the "topology of the system" — which services depend on which other services, which infrastructure hosts which services, which deployments affected which services, and which anomalies are correlated with which upstream changes. Root cause analysis becomes a graph traversal problem: start at the anomaly node and walk upstream through dependency edges to find the probable cause.

This is the architecture pioneered by Grafana Cloud's Knowledge Graph (announced at ObservabilityCON 2025), which connects metrics, logs, traces, and profiles into a single intelligent map of systems. The InsightFinder Dependency Graph product follows a similar pattern for automated root cause analysis. Academic research (Groot, 2021 — "An Event-graph-based Approach for Root Cause Analysis") demonstrates that graph-based approaches outperform statistical correlation for root cause diagnosis in distributed systems because they model the causal structure of the system, not just statistical co-occurrence.

ClickHouse continues to handle high-volume telemetry storage (logs, traces, metrics). PostgreSQL handles transactional operational data (users, tenants, alert configuration). The graph layer — implemented as PostgreSQL tables with the Apache AGE extension (or as relational adjacency tables for simpler deployments) — stores the knowledge graph that the AI root-cause engine traverses. This three-layer architecture separates concerns cleanly: ClickHouse for data at rest, PostgreSQL for data in use, and the graph for data in context.

**Best for:** Platforms where automated root cause analysis across complex microservice architectures is the primary differentiator. The graph layer enables AI-powered "blast radius" analysis, dependency-aware alerting, and causal reasoning that is impossible with flat relational queries.

**Trade-offs:**
- (+) Root cause analysis becomes graph traversal — natural and efficient for dependency chains
- (+) "Blast radius" queries: given a failing service, instantly find all downstream dependents
- (+) Dependency-aware alerting: suppress duplicate alerts for services affected by a common upstream failure
- (+) Temporal graph: edges carry timestamps, enabling "what did the topology look like at time X?"
- (+) AI root cause engine can walk the graph with LLM reasoning for narrative explanations
- (+) Service map visualization is a direct rendering of the graph — no separate computation needed
- (-) Three database engines (or PostgreSQL with AGE extension) adds operational complexity
- (-) Graph must be kept in sync with telemetry data — stale edges degrade root cause quality
- (-) Graph query languages (Cypher, openCypher) are less familiar to most developers than SQL
- (-) Requires continuous graph maintenance: pruning dead edges, merging duplicate nodes
- (-) Small graphs (< 100 services) may not justify the added complexity over simple relational JOINs

---

## Standards Alignment

| Standard | How It's Used |
|----------|---------------|
| OpenTelemetry Logs Data Model | ClickHouse log tables follow OTLP field structure |
| OpenTelemetry Traces Data Model | Trace data is used to automatically discover and maintain service dependency edges in the knowledge graph |
| W3C Trace Context | `trace_id` links log nodes to trace nodes to service nodes in the graph |
| OCSF | Security events carry OCSF class/category/activity IDs; security-relevant graph edges (e.g., unauthorized access attempts) reference OCSF event types |
| ISO 27001:2022 | Graph-based audit: every configuration change is a node connected to its actor, target resource, and related incident |
| NIST SP 800-92 | Graph topology enables compliance queries: "show all services that handle PII and their logging configurations" |
| Prometheus Data Model | Metric nodes in the graph link to Prometheus-compatible time-series data in ClickHouse |

---

## Knowledge Graph Schema (PostgreSQL + Apache AGE or Relational)

The graph is implemented using PostgreSQL tables that model nodes and edges explicitly. This approach works with or without the Apache AGE extension. With AGE, you get openCypher query support; without it, you use recursive CTEs for graph traversal.

### Graph Nodes

```sql
-- ============================================================
-- KNOWLEDGE GRAPH: NODES
-- ============================================================
-- Every entity in the system that participates in relationships
-- is a node in the knowledge graph.

CREATE TABLE graph_nodes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    node_type       TEXT NOT NULL,                       -- see Node Type enum below
    external_id     TEXT,                                -- FK to the source table (service.id, host.id, etc.)
    label           TEXT NOT NULL,                       -- human-readable name
    properties      JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Node Type enum values:
-- 'service'        — a microservice (maps to services table)
-- 'host'           — a physical or virtual machine
-- 'container'      — a container instance
-- 'k8s_pod'        — a Kubernetes pod
-- 'k8s_node'       — a Kubernetes node
-- 'k8s_namespace'  — a Kubernetes namespace
-- 'database'       — a database instance
-- 'queue'          — a message queue (Kafka topic, RabbitMQ queue)
-- 'cache'          — a cache instance (Redis, Memcached)
-- 'load_balancer'  — an L4/L7 load balancer
-- 'deployment'     — a specific deployment event
-- 'anomaly'        — a detected anomaly
-- 'incident'       — a grouped set of related anomalies
-- 'alert_rule'     — an alert rule configuration
-- 'team'           — a team that owns services

/*  Example properties by node_type:

    service:
    {
        "service.name": "payment-service",
        "service.namespace": "production",
        "language": "go",
        "repository": "https://github.com/org/payment-service",
        "owner_team": "payments"
    }

    deployment:
    {
        "version": "v2.3.1",
        "commit_sha": "abc123def",
        "deployed_by": "ci/cd",
        "deployed_at": "2026-05-11T14:30:00Z",
        "changelog": "Fix timeout handling in Redis client"
    }

    anomaly:
    {
        "anomaly_type": "novel_pattern",
        "severity": "critical",
        "score": 0.94,
        "title": "New TimeoutError pattern in payment-service",
        "window_start": "2026-05-11T14:30:00Z",
        "window_end": "2026-05-11T14:45:00Z"
    }
*/

CREATE INDEX idx_graph_nodes_tenant_type ON graph_nodes(tenant_id, node_type);
CREATE INDEX idx_graph_nodes_external ON graph_nodes(tenant_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_graph_nodes_active ON graph_nodes(tenant_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_graph_nodes_properties ON graph_nodes USING GIN (properties);
```

### Graph Edges

```sql
-- ============================================================
-- KNOWLEDGE GRAPH: EDGES
-- ============================================================
-- Directed edges between nodes, carrying relationship semantics,
-- temporal validity, and quantitative metrics.

CREATE TABLE graph_edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    source_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id  UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    edge_type       TEXT NOT NULL,                       -- see Edge Type enum below
    properties      JSONB NOT NULL DEFAULT '{}',
    -- Temporal validity
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_to        TIMESTAMPTZ,                         -- NULL = still active
    -- Quantitative metrics (refreshed periodically from telemetry)
    weight          REAL DEFAULT 1.0,                    -- edge strength (e.g., call frequency)
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Edge Type enum values:
-- 'calls'              — service A calls service B (discovered from traces)
-- 'publishes_to'       — service A publishes to queue Q
-- 'consumes_from'      — service A consumes from queue Q
-- 'reads_from'         — service A reads from database D
-- 'writes_to'          — service A writes to database D
-- 'runs_on'            — service A runs on host/container/pod H
-- 'deployed_to'        — deployment D was deployed to service S
-- 'detected_in'        — anomaly A was detected in service S
-- 'caused_by'          — anomaly A was likely caused by deployment D (AI-inferred)
-- 'correlated_with'    — anomaly A is correlated with anomaly B
-- 'grouped_into'       — anomaly A is grouped into incident I
-- 'owned_by'           — service S is owned by team T
-- 'monitors'           — alert rule R monitors service S
-- 'triggered_by'       — alert event triggered by anomaly A
-- 'depends_on'         — k8s_namespace depends on database D

/*  Example properties by edge_type:

    calls:
    {
        "protocol": "grpc",
        "avg_duration_ms": 12.5,
        "p99_duration_ms": 45.2,
        "call_count_24h": 1450000,
        "error_rate_24h": 0.002
    }

    caused_by (AI-inferred):
    {
        "confidence": 0.87,
        "reasoning": "TimeoutError pattern started 3 minutes after deployment v2.3.1 which changed Redis client configuration",
        "evidence_count": 5
    }
*/

CREATE INDEX idx_graph_edges_source ON graph_edges(source_node_id, edge_type);
CREATE INDEX idx_graph_edges_target ON graph_edges(target_node_id, edge_type);
CREATE INDEX idx_graph_edges_tenant_type ON graph_edges(tenant_id, edge_type);
CREATE INDEX idx_graph_edges_active ON graph_edges(tenant_id)
    WHERE valid_to IS NULL;  -- active edges only
CREATE INDEX idx_graph_edges_properties ON graph_edges USING GIN (properties);
```

### Graph Traversal Queries

```sql
-- ============================================================
-- GRAPH QUERIES: Recursive CTEs for traversal
-- ============================================================

-- BLAST RADIUS: Given a failing service, find all downstream dependents
-- "If payment-service is down, which services are affected?"
WITH RECURSIVE blast_radius AS (
    -- Start: the failing service
    SELECT gn.id, gn.label, gn.node_type, 0 AS depth,
           ARRAY[gn.id] AS path
    FROM graph_nodes gn
    WHERE gn.tenant_id = 'tenant-abc'
      AND gn.node_type = 'service'
      AND gn.label = 'payment-service'
      AND gn.is_active = TRUE
    
    UNION ALL
    
    -- Recurse: find all services that call the current service
    SELECT gn.id, gn.label, gn.node_type, br.depth + 1,
           br.path || gn.id
    FROM blast_radius br
    JOIN graph_edges ge ON ge.target_node_id = br.id
        AND ge.edge_type = 'calls'
        AND ge.valid_to IS NULL  -- active edges only
    JOIN graph_nodes gn ON gn.id = ge.source_node_id
        AND gn.is_active = TRUE
    WHERE NOT gn.id = ANY(br.path)  -- prevent cycles
      AND br.depth < 10             -- max traversal depth
)
SELECT label AS affected_service, depth AS hops_away
FROM blast_radius
WHERE depth > 0
ORDER BY depth, label;


-- ROOT CAUSE TRAVERSAL: Walk upstream from an anomaly to find probable cause
-- "What upstream changes might have caused this anomaly?"
WITH RECURSIVE root_cause_chain AS (
    -- Start: the detected anomaly
    SELECT gn.id, gn.label, gn.node_type, gn.properties,
           0 AS depth, ARRAY[gn.id] AS path
    FROM graph_nodes gn
    WHERE gn.id = 'anomaly-uuid'
    
    UNION ALL
    
    -- Walk upstream: detected_in → service → calls → service → deployed_to → deployment
    SELECT gn.id, gn.label, gn.node_type, gn.properties,
           rcc.depth + 1, rcc.path || gn.id
    FROM root_cause_chain rcc
    JOIN graph_edges ge ON ge.source_node_id = rcc.id
        AND ge.edge_type IN ('detected_in', 'calls', 'caused_by', 'deployed_to', 'reads_from')
        AND ge.valid_to IS NULL
    JOIN graph_nodes gn ON gn.id = ge.target_node_id
    WHERE NOT gn.id = ANY(rcc.path)
      AND rcc.depth < 5
)
SELECT node_type, label, properties, depth
FROM root_cause_chain
ORDER BY depth;


-- TOPOLOGY SNAPSHOT: Service map at a specific point in time
SELECT
    src.label AS source_service,
    tgt.label AS target_service,
    ge.edge_type,
    ge.properties->>'protocol' AS protocol,
    (ge.properties->>'call_count_24h')::bigint AS calls_24h,
    (ge.properties->>'error_rate_24h')::real AS error_rate
FROM graph_edges ge
JOIN graph_nodes src ON src.id = ge.source_node_id
JOIN graph_nodes tgt ON tgt.id = ge.target_node_id
WHERE ge.tenant_id = 'tenant-abc'
  AND ge.edge_type = 'calls'
  AND ge.valid_from <= '2026-05-11T14:00:00Z'
  AND (ge.valid_to IS NULL OR ge.valid_to > '2026-05-11T14:00:00Z')
ORDER BY calls_24h DESC;
```

## ClickHouse: Telemetry Storage

```sql
-- ============================================================
-- CLICKHOUSE: LOG RECORDS (same optimized schema as Model 2)
-- ============================================================

CREATE TABLE otel_logs
(
    timestamp           DateTime64(9) CODEC(DoubleDelta, LZ4),
    observed_timestamp  DateTime64(9) CODEC(DoubleDelta, LZ4),
    id                  UUID DEFAULT generateUUIDv4(),
    tenant_id           LowCardinality(String),
    
    severity_number     UInt8,
    severity_text       LowCardinality(String),
    body                String CODEC(ZSTD(3)),
    
    trace_id            String CODEC(ZSTD(1)),
    span_id             String CODEC(ZSTD(1)),
    trace_flags         UInt8,
    
    resource_fingerprint String CODEC(ZSTD(1)),
    resource_attrs      Map(LowCardinality(String), String),
    log_attrs           Map(LowCardinality(String), String),
    log_attrs_number    Map(LowCardinality(String), Float64),
    
    source_type         LowCardinality(String),
    anomaly_score       Float32 DEFAULT 0.0,
    anomaly_detected    Bool DEFAULT false,
    
    service_name        String MATERIALIZED resource_attrs['service.name'],

    INDEX idx_trace trace_id TYPE bloom_filter(0.01) GRANULARITY 1,
    INDEX idx_body body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_anomaly anomaly_detected TYPE set(2) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, resource_fingerprint, severity_number, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192;


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
    resource_attrs      Map(LowCardinality(String), String),
    span_attrs          Map(LowCardinality(String), String),
    span_attrs_number   Map(LowCardinality(String), Float64),
    has_error           Bool MATERIALIZED status_code = 'ERROR',

    INDEX idx_trace trace_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_status status_code TYPE set(0) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(start_time))
ORDER BY (tenant_id, service_name, operation_name, start_time)
TTL toDateTime(start_time) + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192;


CREATE TABLE metric_samples
(
    tenant_id           LowCardinality(String),
    fingerprint         UInt64,
    metric_name         LowCardinality(String),
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

## PostgreSQL: Operational Data

```sql
-- ============================================================
-- POSTGRESQL: MULTI-TENANCY (same as Model 2, abbreviated)
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    display_name    TEXT,
    role            TEXT NOT NULL DEFAULT 'viewer',
    identity_provider TEXT,
    external_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, email)
);

CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- POSTGRESQL: SERVICES (the graph provides richer topology)
-- ============================================================

CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    graph_node_id   UUID REFERENCES graph_nodes(id),     -- link to knowledge graph
    name            TEXT NOT NULL,
    namespace       TEXT DEFAULT 'default',
    environment     TEXT NOT NULL DEFAULT 'production',
    owner_team      TEXT,
    tags            JSONB NOT NULL DEFAULT '{}',
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name, namespace, environment)
);

-- ============================================================
-- POSTGRESQL: ANOMALY DETECTION
-- ============================================================

CREATE TABLE anomaly_models (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    model_type      TEXT NOT NULL,
    model_version   TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'training',
    config          JSONB NOT NULL DEFAULT '{}',
    precision_score REAL,
    recall_score    REAL,
    f1_score        REAL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE anomalies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID REFERENCES services(id),
    graph_node_id   UUID REFERENCES graph_nodes(id),     -- anomaly node in knowledge graph
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
    user_feedback   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- POSTGRESQL: INCIDENTS (graph-powered grouping)
-- ============================================================

CREATE TABLE incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    graph_node_id   UUID REFERENCES graph_nodes(id),     -- incident node in knowledge graph
    title           TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'warning',
    status          TEXT NOT NULL DEFAULT 'open',
    -- AI-generated root cause from graph traversal
    root_cause_summary TEXT,
    root_cause_confidence REAL,
    probable_cause_node_id UUID REFERENCES graph_nodes(id),  -- the node the AI thinks caused it
    blast_radius_count INT,                                   -- number of affected services
    -- Timeline
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Link anomalies to incidents (many-to-many)
CREATE TABLE incident_anomalies (
    incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    anomaly_id      UUID NOT NULL REFERENCES anomalies(id) ON DELETE CASCADE,
    PRIMARY KEY (incident_id, anomaly_id)
);

CREATE INDEX idx_incidents_open ON incidents(tenant_id, status) WHERE status = 'open';
CREATE INDEX idx_anomalies_open ON anomalies(tenant_id, status) WHERE status = 'open';

-- ============================================================
-- POSTGRESQL: DEPLOYMENTS (tracked as graph nodes)
-- ============================================================

CREATE TABLE deployments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id),
    graph_node_id   UUID REFERENCES graph_nodes(id),     -- deployment node in knowledge graph
    version         TEXT NOT NULL,
    commit_sha      TEXT,
    deployed_by     TEXT,                                 -- 'ci/cd', user email, etc.
    changelog       TEXT,
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_service ON deployments(service_id, deployed_at DESC);

-- ============================================================
-- POSTGRESQL: ALERTING (same as Model 2, abbreviated)
-- ============================================================

CREATE TABLE notification_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    channel_type    TEXT NOT NULL,
    config          JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    graph_node_id   UUID REFERENCES graph_nodes(id),     -- alert_rule node in knowledge graph
    name            TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    rule_type       TEXT NOT NULL,
    condition       JSONB NOT NULL,
    notification_channel_ids UUID[] NOT NULL DEFAULT '{}',
    severity        TEXT NOT NULL DEFAULT 'warning',
    -- Graph-aware: suppress alerts for downstream services when upstream is already alerting
    suppress_downstream BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id   UUID NOT NULL REFERENCES alert_rules(id),
    anomaly_id      UUID REFERENCES anomalies(id),
    incident_id     UUID REFERENCES incidents(id),
    status          TEXT NOT NULL DEFAULT 'firing',
    suppressed      BOOLEAN NOT NULL DEFAULT FALSE,       -- TRUE if suppressed due to upstream alert
    suppressed_by   UUID REFERENCES alert_events(id),     -- the upstream alert that suppressed this
    fired_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ,
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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
```

## Graph Maintenance Pipeline

```sql
-- ============================================================
-- GRAPH MAINTENANCE: Automated edge discovery from trace data
-- ============================================================

-- This query runs periodically to discover new service dependencies
-- from trace data in ClickHouse and create/update graph edges.

-- Step 1: Query ClickHouse for service-to-service calls (last 24h)
-- SELECT
--     parent.service_name AS source_service,
--     child.service_name AS target_service,
--     count() AS call_count,
--     avg(child.duration_ns) / 1e6 AS avg_duration_ms,
--     countIf(child.status_code = 'ERROR') / count() AS error_rate
-- FROM otel_traces child
-- JOIN otel_traces parent ON parent.trace_id = child.trace_id
--     AND parent.span_id = child.parent_span_id
-- WHERE child.tenant_id = 'tenant-abc'
--   AND child.start_time >= now() - INTERVAL 24 HOUR
--   AND parent.service_name != child.service_name
-- GROUP BY source_service, target_service
-- HAVING call_count > 10;

-- Step 2: Upsert graph edges (PostgreSQL)
-- For each (source_service, target_service) pair from Step 1:
INSERT INTO graph_edges (tenant_id, source_node_id, target_node_id, edge_type, properties, weight, last_seen_at)
VALUES (
    'tenant-abc',
    (SELECT id FROM graph_nodes WHERE tenant_id = 'tenant-abc' AND node_type = 'service' AND label = 'api-gateway'),
    (SELECT id FROM graph_nodes WHERE tenant_id = 'tenant-abc' AND node_type = 'service' AND label = 'payment-service'),
    'calls',
    '{"protocol": "grpc", "call_count_24h": 1450000, "avg_duration_ms": 12.5, "error_rate_24h": 0.002}',
    1450000.0,
    now()
)
ON CONFLICT (id) DO UPDATE SET
    properties = EXCLUDED.properties,
    weight = EXCLUDED.weight,
    last_seen_at = EXCLUDED.last_seen_at;

-- Step 3: Deactivate stale edges (not seen in 7 days)
UPDATE graph_edges
SET valid_to = now()
WHERE tenant_id = 'tenant-abc'
  AND valid_to IS NULL
  AND last_seen_at < now() - INTERVAL '7 days';


-- ============================================================
-- GRAPH QUERY: Dependency-aware alert suppression
-- ============================================================

-- When an alert fires for service X, check if any upstream service
-- already has an active alert. If so, suppress the downstream alert.
WITH upstream_alerts AS (
    SELECT DISTINCT ae.id AS upstream_alert_id
    FROM graph_edges ge
    JOIN graph_nodes src ON src.id = ge.source_node_id AND src.node_type = 'service'
    JOIN graph_nodes tgt ON tgt.id = ge.target_node_id AND tgt.node_type = 'service'
    JOIN services s ON s.graph_node_id = tgt.id
    JOIN alert_events ae ON ae.alert_rule_id IN (
        SELECT ar.id FROM alert_rules ar WHERE ar.tenant_id = 'tenant-abc'
    )
    WHERE ge.edge_type = 'calls'
      AND ge.valid_to IS NULL
      AND src.label = 'payment-service'  -- the service with the new alert
      AND ae.status = 'firing'
      AND ae.suppressed = FALSE
)
SELECT upstream_alert_id FROM upstream_alerts LIMIT 1;
-- If a result is returned, suppress the new alert and link it to the upstream alert.
```

---

## Table Count Summary

| Category | Engine | Tables | Notes |
|----------|--------|--------|-------|
| Knowledge Graph | PostgreSQL | 2 | graph_nodes, graph_edges |
| Log Storage | ClickHouse | 1 | otel_logs (partitioned, TTL 30d) |
| Trace Storage | ClickHouse | 1 | otel_traces (partitioned, TTL 14d) |
| Metric Storage | ClickHouse | 1 | metric_samples (partitioned, TTL 90d) |
| Multi-Tenancy & Auth | PostgreSQL | 3 | tenants, users, api_keys |
| Service Registry | PostgreSQL | 1 | services (linked to graph) |
| Deployments | PostgreSQL | 1 | deployments (linked to graph) |
| Anomaly Detection | PostgreSQL | 2 | anomaly_models, anomalies |
| Incidents | PostgreSQL | 2 | incidents, incident_anomalies |
| Alerting | PostgreSQL | 3 | notification_channels, alert_rules, alert_events |
| Audit | PostgreSQL | 1 | audit_log (partitioned) |
| **Total** | **Both** | **18** | **3 ClickHouse + 15 PostgreSQL (incl. 2 graph)** |

---

## Key Design Decisions

1. **Knowledge graph as the platform's "brain."** The graph captures the causal structure of the monitored system — not just "what happened" (telemetry) but "how things are connected" (topology). This is the key enabler for AI-powered root cause analysis: the LLM can walk the graph to reason about causality rather than just correlating timestamps.

2. **Relational graph tables, not a separate graph database.** Using PostgreSQL tables (`graph_nodes`, `graph_edges`) rather than a dedicated graph database (Neo4j, JanusGraph) keeps the operational footprint manageable. PostgreSQL's recursive CTEs handle most graph traversal patterns efficiently for service topologies (typically 50-500 nodes). The Apache AGE extension can be added later for openCypher support if needed.

3. **Temporal edges with `valid_from`/`valid_to`.** Every edge has a time validity range. This enables "topology at time X" queries — critical for answering "what did the service map look like when this incident started?" Edges are never deleted; they are deactivated by setting `valid_to`. This provides a complete history of topology changes.

4. **Dual-linked entities: PostgreSQL + graph.** Key entities (services, anomalies, deployments, alert rules) exist in both PostgreSQL (for ACID operations) and the knowledge graph (for relationship traversal). The `graph_node_id` foreign key on PostgreSQL tables links them to their graph representation. This avoids duplicating business logic in graph queries while enabling graph traversal for relationship-heavy operations.

5. **Incidents as graph-powered anomaly grouping.** The `incidents` table groups related anomalies (via `incident_anomalies` junction table). The incident's `probable_cause_node_id` points to the graph node the AI identified as the root cause. The `blast_radius_count` is computed by graph traversal (counting downstream service nodes reachable from the affected service).

6. **Dependency-aware alert suppression.** The `alert_events.suppress_downstream` flag and `suppressed_by` reference enable graph-powered alert deduplication. When service A fails and causes downstream services B, C, D to also fail, only the alert for A fires — B, C, D alerts are suppressed with a reference to A's alert. This directly addresses the "alert fatigue" problem identified in the market research.

7. **Automated graph maintenance from trace data.** The graph is not manually curated — it is automatically built and maintained from distributed trace data in ClickHouse. A periodic pipeline queries ClickHouse for service-to-service call patterns and upserts graph edges with updated metrics (call count, latency, error rate). Stale edges are deactivated after 7 days of inactivity.

8. **Deployments as first-class graph nodes.** Every deployment creates a node in the graph with an edge to the service it was deployed to. When an anomaly is detected shortly after a deployment, the AI can traverse the graph to find the deployment and its changelog, providing a probable root cause with specific evidence ("TimeoutError pattern started 3 minutes after deployment v2.3.1 which changed Redis client configuration").

9. **Graph-native service map visualization.** The service map UI is a direct rendering of the active graph edges. No separate computation or denormalization is needed — the graph IS the service map. Edge properties (call count, latency, error rate) provide the data for edge thickness, color coding, and tooltips.

10. **Scalable to complex topologies.** For organizations with hundreds of microservices, the graph approach scales better than flat relational JOINs for multi-hop queries. "Find all services within 3 hops of the failing service that were deployed in the last hour" is a natural graph traversal that would require nested self-JOINs in a pure relational model.
