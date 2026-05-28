# LogWatch Technical Reference Guide

**Version**: 0.1.0 | **Last Updated**: May 2026

This document covers the technical details of LogWatch: architecture, data model, API reference, configuration, performance tuning, and operational concerns. For a conceptual overview, see [user-guide-overview.md](user-guide-overview.md).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Data Model](#data-model)
4. [API Reference](#api-reference)
5. [Ingestion Pipeline](#ingestion-pipeline)
6. [Anomaly Detection Engine](#anomaly-detection-engine)
7. [Natural-Language Query System](#natural-language-query-system)
8. [Root-Cause Analysis Pipeline](#root-cause-analysis-pipeline)
9. [Alert Evaluation Engine](#alert-evaluation-engine)
10. [Multi-Tenancy and Security](#multi-tenancy-and-security)
11. [Configuration Reference](#configuration-reference)
12. [Performance Tuning](#performance-tuning)
13. [Monitoring LogWatch Itself](#monitoring-logwatch-itself)
14. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

LogWatch uses a hybrid storage architecture with four application components:

```
                        ┌───────────────────────────────────────┐
                        │           LogWatch Platform            │
  Ingestion Sources     │                                       │
  ─────────────────     │  ┌──────────┐    ┌────────────────┐   │
  OTel Collector ───────┤  │ Fastify  │───>│   ClickHouse   │   │
  Fluent Bit    ───────┤  │   API    │    │  (telemetry)   │   │
  Syslog        ───────┤  │ Server   │    └────────────────┘   │
  HTTP JSON     ───────┤  └────┬─────┘                         │
  CI/CD Webhooks ──────┤       │          ┌────────────────┐   │
                        │  ┌───▼────┐     │  Anomaly Engine│   │
                        │  │ Redis  │────>│   (Python/     │   │
                        │  │(buffer)│     │    FastAPI)     │   │
                        │  └────────┘     └───────┬────────┘   │
                        │                         │             │
                        │  ┌──────────┐   ┌──────▼─────────┐   │
                        │  │ Next.js  │   │  PostgreSQL    │   │
                        │  │  Web UI  │   │ (operational)  │   │
                        │  └──────────┘   └────────────────┘   │
                        └───────────────────────────────────────┘
```

### Component Responsibilities

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **API Server** | Fastify (TypeScript, Node.js 20+) | HTTP/gRPC ingestion, REST API, WebSocket live tail, auth |
| **Anomaly Engine** | FastAPI (Python 3.11+) | ML model inference (LogBERT, statistical), baseline management |
| **Web UI** | Next.js 15 (TypeScript) | Dashboard, log explorer, trace viewer, configuration UI |
| **CLI** | TypeScript | Log shipping, admin commands, tenant management |

### Storage Engines

| Engine | Purpose | Why This Engine |
|--------|---------|----------------|
| **ClickHouse 24.8+** | Logs, traces, derived metrics | Columnar compression (10-20x), bloom filter indexing, sub-second analytical queries. Handles 100K+ inserts/sec with low CPU. |
| **PostgreSQL 16+** | Users, tenants, alerts, anomalies, configuration | ACID transactions, referential integrity, row-level security for tenant isolation. |
| **Redis 7+** | Ingestion buffer, job queue | In-memory throughput for burst ingestion, pub/sub for live tail, BullMQ job scheduling. |

---

## Technology Stack

### API Server (apps/api)

```
Runtime:       Node.js 20+ (LTS)
Framework:     Fastify 4.x
Auth:          NextAuth.js (OAuth 2.0 / OIDC), JWT, API key auth
DB Clients:    @clickhouse/client, pg (node-postgres), ioredis
WebSocket:     @fastify/websocket (live tail)
Validation:    Zod (request/response schemas)
HTTP:          OTLP/HTTP, REST/JSON, Syslog/TCP
```

### Anomaly Engine (apps/anomaly-engine)

```
Runtime:       Python 3.11+
Framework:     FastAPI + Uvicorn
ML:            PyTorch, HuggingFace Transformers (LogBERT)
Statistics:    NumPy, SciPy (isolation forest, z-score)
Queue:         Redis consumer (BullMQ-compatible)
DB:            asyncpg (PostgreSQL), clickhouse-connect (ClickHouse)
```

### Web UI (apps/web)

```
Framework:     Next.js 15 (App Router)
Language:      TypeScript
Styling:       Tailwind CSS
Charts:        Recharts
State:         React Query (TanStack Query)
Auth:          NextAuth.js
```

### Shared Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@logwatch/shared` | `packages/shared/` | TypeScript types, constants, utility functions |
| `@logwatch/db` | `packages/db/` | Database migration runner, client wrappers |
| `@logwatch/test-utils` | `packages/test-utils/` | Test fixtures, factories, seed data |

---

## Data Model

### Storage Split

- **ClickHouse** stores high-volume, append-only telemetry (6 tables)
- **PostgreSQL** stores operational data requiring transactions (17 tables)
- Cross-engine references use value-based lookups (UUIDs stored as TEXT)

### ClickHouse Tables

#### otel_logs

Primary log storage. Partitioned by `(tenant_id, toDate(timestamp))`.

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | DateTime64(9) | Log record timestamp (nanosecond precision) |
| `observed_timestamp` | DateTime64(9) | Server receipt time |
| `id` | UUID | Unique record identifier |
| `tenant_id` | LowCardinality(String) | Owning tenant |
| `trace_id` | String | W3C trace correlation |
| `span_id` | String | W3C span correlation |
| `severity_text` | LowCardinality(String) | DEBUG, INFO, WARN, ERROR, FATAL |
| `severity_number` | UInt8 | OTel severity (1-24) |
| `body` | String | Log message text |
| `resource_string` | Map(String, String) | Resource attributes (service.name, host.name, etc.) |
| `attributes_string` | Map(String, String) | Log attributes |
| `source_type` | LowCardinality(String) | otlp, syslog, http_json |
| `anomaly_score` | Float32 | ML-assigned anomaly score (0.0-1.0) |
| `anomaly_detected` | Bool | Whether anomaly engine flagged this record |

**Key indexes**: Bloom filter on `trace_id` and `span_id`; token BF on `body` for full-text search; set index on `severity_text`.

**Sort order**: `(tenant_id, resource_fingerprint, severity_number, timestamp)` — optimized for service + severity + time range queries.

**TTL**: `30 DAY DELETE` (configurable per tenant).

#### otel_traces

Distributed trace span storage. Partitioned by `(tenant_id, toDate(start_time))`.

| Column | Type | Description |
|--------|------|-------------|
| `start_time` / `end_time` | DateTime64(9) | Span start and end time |
| `duration_ns` | UInt64 | Duration in nanoseconds |
| `trace_id` | String | 32-char hex (W3C) |
| `span_id` | String | 16-char hex |
| `parent_span_id` | String | Parent span (empty for root) |
| `operation_name` | LowCardinality(String) | e.g., `HTTP GET /api/users` |
| `service_name` | LowCardinality(String) | Producing service |
| `status_code` | LowCardinality(String) | OK, ERROR, UNSET |

**TTL**: `14 DAY DELETE`.

#### metrics_time_series, metrics_samples, metrics_samples_1h

Derived metrics from logs and traces. `metrics_samples_1h` is populated by a materialized view that rolls up raw samples into hourly aggregations (min, max, avg, count, sum).

### PostgreSQL Tables (Key Entities)

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `tenants` | id, name, slug, plan, retention_config | Parent of all tenant-scoped data |
| `users` | id, tenant_id, email, role | RLS-enforced. Roles: viewer, editor, admin |
| `api_keys` | id, tenant_id, key_hash, scopes | Argon2/bcrypt hash. Scopes: ingest, query, alerts, admin |
| `services` | id, tenant_id, name, namespace, environment | Auto-discovered from telemetry |
| `service_dependencies` | source_service_id, target_service_id | Derived from trace span relationships |
| `deployments` | service_id, version, commit_sha, deployer | Submitted via CI/CD webhook |
| `anomaly_models` | model_type, status, precision/recall/f1 | Types: logbert, statistical_rcf, llm_semantic |
| `anomalies` | type, severity, score, sample_log_ids | States: open, acknowledged, resolved, false_positive |
| `anomaly_baselines` | service_id, metric_name, mean, stddev, hourly/dow patterns | Updated continuously |
| `alert_rules` | rule_type, condition, cooldown_minutes | Types: anomaly, log_pattern, metric_threshold, log_absence |
| `notification_channels` | channel_type, config | Types: slack, pagerduty, email, webhook |
| `alert_events` | alert_rule_id, anomaly_id, status | States: firing, resolved |
| `redaction_rules` | pattern, replacement, applies_to | Types: custom (regex), builtin |
| `rca_reports` | anomaly_id, summary, probable_cause, confidence, evidence | AI-generated |
| `nl_queries` | natural_language, generated_query, results_summary | Query translation history |
| `ingest_usage` | service_name, date, record_count, bytes_raw | Daily aggregation |
| `sampling_recommendations` | log_pattern, recommended_sample_rate, estimated_savings | States: pending, applied, dismissed |
| `audit_log` | actor_id, action, resource_type, changes | Partitioned by created_at |

### Tenant Isolation

- **PostgreSQL**: Row-Level Security (RLS) policies on all tenant-scoped tables. The API sets `app.current_tenant` per request via `SET LOCAL`.
- **ClickHouse**: Partition-by-tenant + application-layer `WHERE tenant_id = ?` on every query. No native RLS in ClickHouse; the API enforces isolation.

---

## API Reference

Base URL: `http://localhost:4000/api/v1`

### Authentication

All API requests require authentication via one of:

- **API Key**: `X-API-Key: lw_abcdef...` header
- **JWT Bearer Token**: `Authorization: Bearer <token>` header (obtained via OAuth flow)

### Ingestion Endpoints

#### POST /api/v1/ingest/otlp

Accept OTLP log and trace data (protobuf or JSON encoding).

```
Content-Type: application/x-protobuf  OR  application/json
X-API-Key: lw_...
```

Returns `200 OK` on success, `429 Too Many Requests` under backpressure, `503 Service Unavailable` if storage is down.

#### POST /api/v1/ingest/json

Accept logs in a simplified JSON format.

```json
{
  "logs": [
    {
      "timestamp": "2026-05-11T14:30:00.000Z",
      "severity": "ERROR",
      "body": "Connection refused: redis-primary:6379",
      "service": "payment-service",
      "attributes": {
        "request_id": "req-abc-123",
        "user_id": "user-456"
      }
    }
  ]
}
```

#### POST /api/v1/ingest/syslog

Accept syslog messages (RFC 5424 and RFC 3164). TCP connection, newline-delimited.

#### POST /api/v1/deployments

Register a deployment event from CI/CD.

```json
{
  "service": "payment-service",
  "version": "v2.3.1",
  "commit_sha": "a1b2c3d4e5f6...",
  "deployer": "ci-pipeline",
  "changelog": "Changed Redis connection pool size"
}
```

### Query Endpoints

#### GET /api/v1/logs

Search log records.

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Full-text search query |
| `from` | ISO 8601 | Start of time range |
| `to` | ISO 8601 | End of time range (default: now) |
| `severity` | string | Filter by severity (comma-separated) |
| `service` | string | Filter by service name |
| `limit` | integer | Max results (default: 100, max: 1000) |
| `cursor` | string | Pagination cursor from previous response |

Response:

```json
{
  "records": [...],
  "total": 1247,
  "cursor": "eyJ0...",
  "took_ms": 42
}
```

#### GET /api/v1/logs/tail

WebSocket endpoint for live tail streaming.

Connect: `ws://localhost:4000/api/v1/logs/tail?service=payment-service&severity=ERROR`

Each message is a JSON log record.

#### GET /api/v1/traces/:traceId

Retrieve all spans for a specific trace.

Response: Array of span objects with timeline data, sorted by start_time.

#### GET /api/v1/traces/:traceId/logs

Retrieve all log records correlated with a specific trace.

#### GET /api/v1/anomalies

List detected anomalies.

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter: open, acknowledged, resolved, false_positive |
| `severity` | string | Filter: critical, warning, info |
| `service` | string | Filter by service name |
| `from` / `to` | ISO 8601 | Time range |

#### GET /api/v1/anomalies/:id

Get anomaly detail including sample logs and correlated traces.

#### POST /api/v1/anomalies/:id/feedback

Submit feedback on an anomaly.

```json
{
  "feedback": "false_positive",
  "notes": "This is expected behaviour during the weekly batch run"
}
```

#### POST /api/v1/ai/query

Submit a natural-language log query.

```json
{
  "question": "What caused the spike in 5xx errors between 2pm and 3pm UTC yesterday?"
}
```

Response:

```json
{
  "question": "...",
  "generated_query": "SELECT ... FROM otel_logs ...",
  "results": [...],
  "summary": "Found 247 error entries...",
  "took_ms": 1230
}
```

#### GET /api/v1/anomalies/:id/rca

Get the root-cause analysis report for an anomaly.

### Management Endpoints

#### CRUD: /api/v1/alert-rules
#### CRUD: /api/v1/notification-channels
#### CRUD: /api/v1/redaction-rules
#### CRUD: /api/v1/sampling-rules

Standard REST (GET list, GET by ID, POST create, PUT update, DELETE).

#### GET /api/v1/services

List auto-discovered services with dependency data.

#### GET /api/v1/services/:id/dependencies

Get the dependency graph for a specific service.

#### GET /api/v1/cost/usage

Get per-service ingestion volume and cost data.

#### GET /api/v1/cost/recommendations

Get AI-generated sampling recommendations.

#### GET /api/v1/health

Health check for load balancer probes.

```json
{
  "status": "ok",
  "clickhouse": "ok",
  "postgres": "ok",
  "redis": "ok",
  "anomaly_engine": "ok"
}
```

---

## Ingestion Pipeline

### Flow

```
Client → API Server → Validation → Redaction → Redis Buffer → ClickHouse Batch Insert
                                                     ↓
                                              Anomaly Engine
                                              (async scoring)
```

1. **Receive**: API server accepts log records via OTLP, JSON, or syslog
2. **Validate**: Normalize to internal data model (fill defaults for missing fields per FR-044)
3. **Redact**: Apply tenant redaction rules to body and attributes
4. **Buffer**: Write to Redis stream for burst absorption
5. **Batch insert**: Worker drains Redis buffer and writes to ClickHouse in batches (configurable batch size, default 10,000 records or 1 second, whichever comes first)
6. **Async scoring**: Anomaly engine consumes from Redis to score records against baselines

### Backpressure

When Redis memory hits the configured limit (`maxmemory 256mb`, policy `noeviction`):

1. Redis returns `OOM` on write attempts
2. API server catches this and returns `429 Too Many Requests` with `Retry-After` header
3. OTLP-compatible clients automatically retry with exponential backoff
4. No log data is silently dropped

### Normalization Rules

| Field | Missing Value Default |
|-------|---------------------|
| `timestamp` | Server receipt time (`observed_timestamp`) |
| `severity_number` | 9 (INFO) |
| `severity_text` | Derived from `severity_number` |
| `body` | Truncated at 64 KB (configurable) |
| `source_type` | Set based on ingestion endpoint (otlp, syslog, http_json) |

---

## Anomaly Detection Engine

### Detection Pipeline

```
Redis Stream → Feature Extraction → Model Inference → Scoring → PostgreSQL (anomaly record)
                                                                        ↓
                                                                 Alert Evaluator
```

### Models

#### Statistical Baseline (always active)

- **Metrics tracked**: log volume per minute, error rate, p50/p95/p99 latency
- **Technique**: Z-score against rolling 7-day baseline with hourly and day-of-week decomposition
- **Threshold**: Z-score > 3.0 triggers anomaly candidate
- **Used during**: Learning period (first 7 days) and as a first-pass filter

#### LogBERT (after 7-day baseline)

- **Model**: BERT-base fine-tuned on log template patterns
- **Input**: Log body text, tokenized into log template components
- **Output**: Anomaly probability score (0.0 - 1.0)
- **Training**: Continuous fine-tuning on per-service data; retrained weekly
- **GPU**: Optional but recommended. CPU inference is supported but 10x slower.

#### LLM Semantic Analysis (for high-severity candidates)

- **Model**: Claude API (claude-sonnet-4-6 by default)
- **Input**: Anomaly candidate context: sample logs, baseline statistics, recent deployment history, service dependencies
- **Output**: Severity classification, human-readable explanation, false-positive probability
- **Rate limiting**: Max 100 Claude API calls per hour per tenant (configurable)

### Severity Classification

| Score Range | Classification | Typical Trigger |
|------------|---------------|----------------|
| 0.0 - 0.3 | info | Minor deviation, possibly transient |
| 0.3 - 0.7 | warning | Notable pattern change, warrants investigation |
| 0.7 - 1.0 | critical | Novel error pattern, significant impact detected |

### Feedback Loop

User feedback on anomalies (`helpful`, `not_helpful`, `false_positive`) is incorporated:

1. `false_positive` entries are added to the service's suppression list
2. LogBERT is retrained with corrected labels at next weekly cycle
3. Statistical baseline thresholds are adjusted for recurring false positives

---

## Natural-Language Query System

### Flow

```
User Question → Claude API (translation) → ClickHouse SQL → Execute → Claude API (summarization) → Response
```

1. User submits plain-English question via API or UI
2. System prompt provides the ClickHouse schema, available tables, and column types
3. Claude translates the question to a ClickHouse SQL query
4. Query is validated (read-only, tenant-scoped, time-bounded)
5. Query is executed against ClickHouse
6. Results are passed back to Claude for plain-English summarization
7. Response includes: original question, generated SQL, results, and summary

### Security Constraints

- Generated queries are restricted to `SELECT` only (no DDL/DML)
- `WHERE tenant_id = ?` is always injected (cannot be overridden by the LLM)
- Query execution timeout: 30 seconds
- Result set limit: 10,000 rows

---

## Root-Cause Analysis Pipeline

### Trigger

RCA reports are generated automatically when:
- An anomaly is classified as `critical` severity
- An anomaly is manually requested by a user ("Generate Report" button)

### Evidence Gathering

1. **Log patterns**: Anomalous log records and their diff from baseline patterns
2. **Correlated traces**: Traces containing spans from the affected service during the anomaly window
3. **Recent deployments**: Deployment events for the affected service and its dependencies within the preceding 24 hours
4. **Service dependencies**: Upstream and downstream services, their error rates and latency during the window
5. **Baseline comparison**: Current vs. historical metric values

### Report Generation

All evidence is assembled into a structured context and sent to Claude API with a system prompt instructing it to:
- Identify the most probable root cause
- Assign a confidence score
- Cite specific evidence for each claim
- Structure the output as a narrative suitable for an incident review

---

## Alert Evaluation Engine

### Evaluation Loop

The alert evaluator runs as a background worker in the API server:

1. Every `evaluation_interval_seconds` (default 60s), evaluate all enabled alert rules
2. For each rule, execute the rule condition against current data
3. If the condition matches:
   - Check cooldown: skip if last fired within `cooldown_minutes`
   - Check mute window: record but don't notify if `mute_until` is in the future
   - Create an `alert_event` record
   - Send notifications to all configured channels
4. Notification delivery is async with retry (3 attempts, exponential backoff)

### Rule Types

| Type | Condition | Data Source |
|------|-----------|-------------|
| `anomaly` | Anomaly detected matching severity/service criteria | `anomalies` table |
| `log_pattern` | Regex or keyword match appears in logs | ClickHouse `otel_logs` |
| `metric_threshold` | Derived metric crosses a threshold | ClickHouse `metrics_samples` |
| `log_absence` | Expected log pattern not seen for N minutes | ClickHouse `otel_logs` |

### Notification Payloads

**Slack**:
```json
{
  "text": "LogWatch Alert: Critical anomaly detected",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Novel NullPointerException in checkout-service*\nSeverity: critical (0.89)\nDetected: 2026-05-11 14:33 UTC\n<https://logwatch.example.com/anomalies/abc-123|View in LogWatch>"
      }
    }
  ]
}
```

**PagerDuty**: Events API v2 trigger event with severity mapping (critical → critical, warning → warning, info → info).

---

## Multi-Tenancy and Security

### Tenant Isolation Model

| Layer | Mechanism |
|-------|-----------|
| PostgreSQL | Row-Level Security (RLS) policies on all tables. `app.current_tenant` set per request. |
| ClickHouse | Partition by `tenant_id`. Application enforces `WHERE tenant_id = ?` on every query. |
| Redis | Key prefix: `tenant:{id}:*` for all tenant-scoped data. |
| API | Tenant extracted from JWT claims or API key lookup. Injected into every database query. |

### Authentication Methods

| Method | Use Case | Implementation |
|--------|---------|----------------|
| OAuth 2.0 / OIDC | Web UI login, enterprise SSO | NextAuth.js with Google, GitHub, or custom OIDC provider |
| API Key | Programmatic access, log ingestion | `X-API-Key` header, Argon2 hash stored in `api_keys` table |
| JWT | Session management after OAuth | Issued by NextAuth.js, validated by API server |

### RBAC Permissions Matrix

| Action | Viewer | Editor | Admin |
|--------|--------|--------|-------|
| Search/view logs, traces | Yes | Yes | Yes |
| View anomalies, alerts, cost data | Yes | Yes | Yes |
| Create/edit/delete alert rules | No | Yes | Yes |
| Manage notification channels | No | Yes | Yes |
| Create/edit sampling rules | No | Yes | Yes |
| Create/edit redaction rules | No | Yes | Yes |
| Manage users | No | No | Yes |
| Manage API keys | No | No | Yes |
| Change tenant settings | No | No | Yes |
| Modify retention policies | No | No | Yes |

### Data Redaction

Redaction runs at ingestion time (before data is written to ClickHouse). Once redacted, original values are not recoverable.

Built-in patterns:
- Credit card numbers (Luhn-valid 13-19 digit sequences)
- Email addresses
- Bearer tokens (`Bearer [A-Za-z0-9._-]+`)

Custom patterns: any valid regular expression, applied to `body`, `attributes`, or both.

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `CLICKHOUSE_URL` | Yes | - | ClickHouse HTTP endpoint |
| `CLICKHOUSE_DATABASE` | No | `observability` | ClickHouse database name |
| `CLICKHOUSE_USER` | No | `default` | ClickHouse user |
| `CLICKHOUSE_PASSWORD` | No | - | ClickHouse password |
| `REDIS_URL` | Yes | - | Redis connection string |
| `PORT` | No | `4000` | API server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `NEXTAUTH_SECRET` | Yes | - | NextAuth.js session secret (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | - | Canonical URL of the web UI |
| `ANTHROPIC_API_KEY` | No | - | Claude API key (required for NL queries and RCA) |
| `ANOMALY_ENGINE_URL` | No | `http://localhost:8001` | Anomaly engine base URL |
| `GOOGLE_CLIENT_ID` | No | - | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | - | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | No | - | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | No | - | GitHub OAuth client secret |

### Retention Configuration

Set per tenant in `tenants.retention_config` (JSON):

```json
{
  "logs_days": 30,
  "traces_days": 14,
  "metrics_days": 90
}
```

ClickHouse enforces TTL based on these values. Changing retention does not retroactively delete data — it takes effect for newly expired data.

### Ingestion Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Batch size | 10,000 records | Records buffered before ClickHouse write |
| Batch interval | 1 second | Max time before flushing buffer |
| Max body size | 64 KB | Log body truncation limit |
| Redis max memory | 256 MB | Ingestion buffer limit before backpressure |

---

## Performance Tuning

### ClickHouse

- **Memory**: Minimum 4 GB RAM for ClickHouse. For 100K logs/sec, recommend 16 GB+.
- **Disk**: SSD required. ClickHouse compression typically achieves 10:1 on log data.
- **Storage estimate**: 100K logs/sec * 1 KB avg * 86,400 sec/day = ~8.6 GB/day raw, ~0.86 GB/day compressed.
- **Index granularity**: Default 8192 is optimal for most workloads. Reduce to 1024 for very selective queries on small datasets.

### PostgreSQL

- **Connections**: Set `max_connections` to at least `(API replicas * 20) + 10`.
- **Shared buffers**: 25% of available RAM (standard PostgreSQL tuning).
- **RLS overhead**: Negligible for properly indexed tables. Ensure `tenant_id` is the leading column in all frequently queried indexes.

### Redis

- **Memory**: 256 MB handles ~500K buffered records. Increase for higher burst tolerance.
- **Policy**: `noeviction` for ingestion buffer (triggers backpressure rather than data loss).

### API Server

- **Node.js cluster**: Run one process per CPU core using `cluster` module or PM2.
- **Concurrency**: Fastify handles ~50K req/sec per process on modern hardware.
- **Kubernetes**: 2+ replicas for availability. HPA based on CPU utilization (target 70%).

### Anomaly Engine

- **GPU**: NVIDIA GPU with CUDA recommended for LogBERT inference. Falls back to CPU (10x slower).
- **Memory**: 4 GB minimum. LogBERT model requires ~1.5 GB.
- **Scaling**: Increase replicas for higher ingestion rates. Each replica processes independently from Redis.

---

## Monitoring LogWatch Itself

LogWatch exposes Prometheus-compatible metrics at `/metrics` on the API server:

| Metric | Type | Description |
|--------|------|-------------|
| `logwatch_ingest_records_total` | counter | Total records ingested |
| `logwatch_ingest_bytes_total` | counter | Total bytes ingested |
| `logwatch_ingest_errors_total` | counter | Ingestion errors |
| `logwatch_ingest_backpressure_total` | counter | 429/503 responses sent |
| `logwatch_search_duration_seconds` | histogram | Log search query latency |
| `logwatch_anomaly_detected_total` | counter | Anomalies detected |
| `logwatch_alert_sent_total` | counter | Alert notifications sent |
| `logwatch_redis_buffer_size` | gauge | Current Redis buffer size |
| `logwatch_clickhouse_insert_duration` | histogram | ClickHouse batch insert latency |

### Health Endpoint

`GET /health` returns status of all dependencies. Use as Kubernetes liveness/readiness probe.

---

## Troubleshooting

### Logs not appearing in search

1. Check API health: `curl http://localhost:4000/health`
2. Check Redis buffer: `redis-cli info memory` — if `used_memory` is near `maxmemory`, backpressure is active
3. Check ClickHouse: `clickhouse-client -q "SELECT count() FROM otel_logs WHERE timestamp > now() - INTERVAL 5 MINUTE"`
4. Check ingestion endpoint response: should be `200 OK`, not `429` or `503`

### High false-positive rate

1. Ensure the service has 7+ days of baseline data (check `anomaly_baselines` table)
2. Submit `false_positive` feedback on incorrect detections
3. Check `anomaly_models` for the service — status should be `ready`
4. Review `hourly_pattern` and `dow_pattern` in baselines for completeness

### Slow search queries

1. Check ClickHouse system.query_log for slow queries
2. Ensure queries include time range filters (partition pruning)
3. Verify bloom filter indexes are present: `SHOW CREATE TABLE otel_logs`
4. For large result sets, use pagination (`cursor` parameter)

### Alert notifications not arriving

1. Verify notification channel is configured and verified
2. Check `alert_events` table for the rule — status should be `firing`
3. Check cooldown: `last_fired_at` + `cooldown_minutes` may not have elapsed
4. Check mute window: `mute_until` may be in the future
5. Check notification_results in `alert_events` for delivery errors

### Anomaly engine not processing

1. Check engine health: `curl http://localhost:8001/health`
2. Check Redis connection from the engine
3. Check Python logs: `docker compose logs anomaly-engine`
4. Verify `ANOMALY_ENGINE_URL` in API server config points to the correct address
