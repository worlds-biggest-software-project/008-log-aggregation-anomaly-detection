# API Contract: Log Aggregation & Anomaly Detection Platform

**Branch**: `001-log-anomaly-platform` | **Date**: 2026-05-11 | **Spec**: [../spec.md](../spec.md)

## Overview

RESTful API served by Fastify (Node.js). All endpoints require authentication (JWT or API key) and are tenant-scoped. The API accepts and returns JSON (`application/json`) unless otherwise noted.

**Base URL**: `https://{host}/api/v1`

## Authentication

All requests must include one of:
- `Authorization: Bearer <jwt_token>` — OAuth 2.0 / OIDC JWT with `tenant_id` and `role` claims
- `X-API-Key: <api_key>` — Scoped API key (hashed, compared server-side)

Unauthorized requests receive `401 Unauthorized`. Insufficient permissions receive `403 Forbidden`.

## Common Response Patterns

**Pagination** (list endpoints):
```json
{
  "data": [...],
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 0,
    "has_more": true
  }
}
```

**Error**:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [...]
  }
}
```

**Standard HTTP status codes**: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 429 Too Many Requests, 503 Service Unavailable.

---

## 1. Ingestion

### POST /v1/ingest/otlp/logs

Accept OTLP log records (HTTP/JSON or HTTP/protobuf). Compatible with OpenTelemetry Collector's OTLP/HTTP exporter.

- **Content-Type**: `application/json` or `application/x-protobuf`
- **Auth**: API key with `ingest` scope
- **Request**: OTLP ExportLogsServiceRequest
- **Response**: `200 OK` with partial success details, or `429`/`503` under backpressure
- **Spec**: FR-001, FR-041

### POST /v1/ingest/otlp/traces

Accept OTLP trace spans.

- **Content-Type**: `application/json` or `application/x-protobuf`
- **Auth**: API key with `ingest` scope
- **Request**: OTLP ExportTraceServiceRequest
- **Response**: `200 OK` with partial success details, or `429`/`503` under backpressure
- **Spec**: FR-010

### POST /v1/ingest/syslog

Accept syslog messages (RFC 5424 and RFC 3164). Normalized to the unified log data model.

- **Content-Type**: `application/octet-stream` (raw syslog) or `application/json` (structured)
- **Auth**: API key with `ingest` scope
- **Response**: `202 Accepted` or `429`/`503`
- **Spec**: FR-002, FR-044

### POST /v1/ingest/json

Accept plain JSON log records for direct application integration.

- **Content-Type**: `application/json`
- **Auth**: API key with `ingest` scope
- **Request**:
  ```json
  {
    "logs": [
      {
        "timestamp": "2026-05-11T14:30:00.000Z",
        "severity": "ERROR",
        "body": "Connection timeout after 30s",
        "service": "payment-service",
        "attributes": {"http.status_code": "504"}
      }
    ]
  }
  ```
- **Response**: `202 Accepted` with ingestion receipt
- **Spec**: FR-003, FR-004, FR-044

---

## 2. Log Search & Exploration

### GET /v1/logs

Search and filter log records.

- **Auth**: JWT or API key with `query` scope
- **Query Parameters**:
  | Parameter | Type | Description |
  |-----------|------|-------------|
  | `q` | string | Full-text search query |
  | `service` | string | Filter by service name |
  | `severity` | string | Filter by severity (TRACE, DEBUG, INFO, WARN, ERROR, FATAL) |
  | `from` | ISO 8601 | Start time (required) |
  | `to` | ISO 8601 | End time (defaults to now) |
  | `trace_id` | string | Filter by trace ID |
  | `attributes` | string | Key-value filter (e.g., `http.status_code:504`) |
  | `limit` | integer | Max results (default 50, max 1000) |
  | `offset` | integer | Pagination offset |
  | `sort` | string | `timestamp_asc` or `timestamp_desc` (default) |
- **Response**: Paginated list of log records
- **Spec**: FR-007, FR-008, SC-007

### GET /v1/logs/live

Server-Sent Events (SSE) stream for live tail.

- **Auth**: JWT
- **Query Parameters**: `service`, `severity`, `q` (same filters as log search)
- **Response**: `text/event-stream` — each event is a JSON log record
- **Connection**: Long-lived SSE. Client reconnects on disconnect.
- **Spec**: FR-009

---

## 3. Distributed Tracing

### GET /v1/traces/:traceId

Retrieve all spans for a trace.

- **Auth**: JWT or API key with `query` scope
- **Response**: Full trace with spans ordered by start time, including timeline metadata
  ```json
  {
    "trace_id": "abc123...",
    "span_count": 12,
    "duration_ms": 342,
    "services": ["api-gateway", "payment-service", "redis-cache"],
    "spans": [
      {
        "span_id": "...",
        "parent_span_id": "...",
        "service_name": "api-gateway",
        "operation_name": "POST /checkout",
        "start_time": "2026-05-11T14:30:00.123Z",
        "duration_ms": 342,
        "status": "ERROR",
        "attributes": {...},
        "events": [...],
        "logs": [...]
      }
    ]
  }
  ```
- **Spec**: FR-011, FR-012

### GET /v1/traces

List traces with filters.

- **Auth**: JWT or API key with `query` scope
- **Query Parameters**: `service`, `operation`, `status`, `min_duration_ms`, `max_duration_ms`, `from`, `to`, `limit`, `offset`
- **Response**: Paginated list of trace summaries
- **Spec**: FR-012

---

## 4. Anomaly Detection

### GET /v1/anomalies

List detected anomalies.

- **Auth**: JWT or API key with `query` scope
- **Query Parameters**: `service`, `severity`, `status` (open, acknowledged, resolved, false_positive), `from`, `to`, `limit`, `offset`
- **Response**: Paginated list of anomalies with title, severity, score, time window, and sample log IDs
- **Spec**: FR-016

### GET /v1/anomalies/:id

Get anomaly detail with sample logs and correlated traces.

- **Auth**: JWT or API key with `query` scope
- **Response**: Full anomaly detail including description, sample log records (fetched from ClickHouse), related trace IDs, and any associated RCA report
- **Spec**: FR-016

### PATCH /v1/anomalies/:id

Update anomaly status or provide feedback.

- **Auth**: JWT (editor or admin role)
- **Request**:
  ```json
  {
    "status": "resolved",
    "user_feedback": "false_positive"
  }
  ```
- **Response**: Updated anomaly
- **Spec**: FR-017

### GET /v1/anomalies/:id/baselines

Get the baseline data for the service associated with an anomaly.

- **Auth**: JWT or API key with `query` scope
- **Response**: Baseline statistics (mean, stddev, percentiles, hourly/weekly patterns)
- **Spec**: FR-013, FR-045

---

## 5. Alert Rules & Notification Channels

### GET /v1/alerts/rules

List alert rules.

### POST /v1/alerts/rules

Create an alert rule.

- **Auth**: JWT (editor or admin role)
- **Request**:
  ```json
  {
    "name": "High error rate",
    "rule_type": "anomaly",
    "condition": {
      "anomaly_type": "error_rate",
      "severity_gte": "warning"
    },
    "notification_channel_ids": ["uuid-1"],
    "severity": "critical",
    "cooldown_minutes": 15,
    "evaluation_interval_seconds": 60
  }
  ```
- **Spec**: FR-018, FR-021

### PUT /v1/alerts/rules/:id

Update an alert rule.

### DELETE /v1/alerts/rules/:id

Delete an alert rule.

### POST /v1/alerts/rules/:id/mute

Mute an alert rule until a specified time.

- **Request**: `{"mute_until": "2026-05-12T06:00:00Z"}`
- **Spec**: FR-022

### GET /v1/alerts/events

List alert firing events.

### GET /v1/notifications/channels

List notification channels.

### POST /v1/notifications/channels

Create a notification channel.

- **Auth**: JWT (editor or admin role)
- **Request**:
  ```json
  {
    "name": "Oncall PagerDuty",
    "channel_type": "pagerduty",
    "config": {"integration_key": "..."}
  }
  ```
- **Spec**: FR-019, FR-020

### POST /v1/notifications/channels/:id/test

Send a test notification to verify channel configuration.

### PUT /v1/notifications/channels/:id

Update a notification channel.

### DELETE /v1/notifications/channels/:id

Delete a notification channel.

---

## 6. Natural-Language Querying

### POST /v1/ai/query

Translate a natural-language question into a structured query and execute it.

- **Auth**: JWT
- **Request**:
  ```json
  {
    "question": "What caused the spike in 5xx errors between 2pm and 3pm UTC yesterday?"
  }
  ```
- **Response**:
  ```json
  {
    "question": "What caused the spike in 5xx errors...",
    "generated_query": "SELECT ... FROM otel_logs WHERE ...",
    "results": [...],
    "summary": "Found 47 TimeoutError entries from payment-service...",
    "result_count": 47,
    "execution_time_ms": 234
  }
  ```
- **Spec**: FR-023, FR-024, FR-025

---

## 7. Root-Cause Analysis

### GET /v1/anomalies/:id/rca

Get the root-cause analysis report for an anomaly. Generates on demand if not yet created.

- **Auth**: JWT
- **Response**:
  ```json
  {
    "anomaly_id": "...",
    "summary": "The TimeoutError spike in payment-service started 3 minutes after deployment v2.3.1...",
    "probable_cause": "Redis client connection pool size change in v2.3.1",
    "confidence": 0.85,
    "evidence": [
      {"type": "deployment", "description": "v2.3.1 deployed 3 min before anomaly", "reference_id": "..."},
      {"type": "trace", "description": "p99 latency for redis.get increased from 5ms to 2400ms", "reference_id": "..."}
    ],
    "related_services": ["payment-service", "redis-cache"]
  }
  ```
- **Spec**: FR-026, FR-027

### POST /v1/anomalies/:id/rca/feedback

Submit feedback on a root-cause report.

- **Auth**: JWT
- **Request**: `{"helpful": true, "notes": "..."}`
- **Spec**: FR-028

---

## 8. Service Registry

### GET /v1/services

List registered services.

- **Auth**: JWT or API key with `query` scope
- **Query Parameters**: `environment`, `namespace`, `owner_team`, `limit`, `offset`
- **Spec**: FR-036

### GET /v1/services/:id

Get service detail with metadata and last-seen timestamp.

### PUT /v1/services/:id

Update service metadata (owner_team, tags, repository_url).

- **Auth**: JWT (editor or admin role)

### GET /v1/services/:id/dependencies

Get the dependency graph for a service (upstream and downstream).

- **Response**: List of service dependencies with call counts, latency, and error rates
- **Spec**: FR-037

### GET /v1/services/graph

Get the full service dependency graph for the tenant.

- **Spec**: FR-037

---

## 9. Deployment Tracking

### POST /v1/deployments

Record a deployment event.

- **Auth**: API key with `ingest` scope or JWT (editor/admin)
- **Request**:
  ```json
  {
    "service": "payment-service",
    "version": "v2.3.1",
    "commit_sha": "abc123def456...",
    "deployer": "ci/github-actions",
    "changelog": "Changed Redis connection pool size",
    "deployed_at": "2026-05-11T14:27:00Z"
  }
  ```
- **Response**: `201 Created` with deployment record
- **Spec**: FR-039, FR-040

### GET /v1/deployments

List deployments for a service.

- **Query Parameters**: `service`, `from`, `to`, `limit`, `offset`

---

## 10. Cost Management

### GET /v1/cost/usage

Get per-service ingestion volume and estimated cost.

- **Auth**: JWT
- **Query Parameters**: `from`, `to`, `service`, `signal_type`
- **Response**: Daily usage breakdown by service
- **Spec**: FR-029

### GET /v1/cost/recommendations

Get AI-generated sampling recommendations.

- **Auth**: JWT
- **Response**: List of recommendations with pattern, volume, sample rate, estimated savings, and explanation
- **Spec**: FR-030

### POST /v1/cost/recommendations/:id/apply

Apply a sampling recommendation.

- **Auth**: JWT (editor or admin role)
- **Response**: Updated recommendation with `status: applied`
- **Spec**: FR-031

### POST /v1/cost/recommendations/:id/dismiss

Dismiss a recommendation.

- **Auth**: JWT (editor or admin role)

---

## 11. Redaction Rules

### GET /v1/redaction/rules

List redaction rules (custom and built-in).

- **Auth**: JWT (editor or admin role)
- **Spec**: FR-042, FR-043

### POST /v1/redaction/rules

Create a custom redaction rule.

- **Auth**: JWT (editor or admin role)
- **Request**:
  ```json
  {
    "name": "Credit card numbers",
    "pattern": "\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b",
    "replacement": "***REDACTED-CC***",
    "applies_to": "all"
  }
  ```
- **Spec**: FR-042

### PUT /v1/redaction/rules/:id

Update a redaction rule.

### DELETE /v1/redaction/rules/:id

Delete a custom redaction rule. Built-in rules can be disabled but not deleted.

### PATCH /v1/redaction/rules/:id/toggle

Enable or disable a redaction rule.

- **Request**: `{"enabled": false}`
- **Spec**: FR-043

---

## 12. Administration

### GET /v1/admin/tenant

Get current tenant settings.

- **Auth**: JWT (admin role)

### PUT /v1/admin/tenant

Update tenant settings (retention, ingestion limits).

- **Auth**: JWT (admin role)
- **Spec**: FR-006

### GET /v1/admin/users

List tenant users.

- **Auth**: JWT (admin role)
- **Spec**: FR-033

### POST /v1/admin/users

Invite a user.

- **Auth**: JWT (admin role)
- **Request**: `{"email": "...", "role": "editor"}`

### PUT /v1/admin/users/:id

Update user role.

- **Auth**: JWT (admin role)
- **Spec**: FR-033

### DELETE /v1/admin/users/:id

Remove a user.

- **Auth**: JWT (admin role)

### GET /v1/admin/api-keys

List API keys (shows prefix, name, scopes; never the key itself).

- **Auth**: JWT (admin role)
- **Spec**: FR-035

### POST /v1/admin/api-keys

Create an API key. Returns the full key exactly once.

- **Auth**: JWT (admin role)
- **Request**: `{"name": "CI Pipeline", "scopes": ["ingest"], "expires_at": "2027-01-01T00:00:00Z"}`
- **Response**: `{"id": "...", "key": "lw_abc123...", "key_prefix": "lw_abc12"}`
- **Spec**: FR-035

### DELETE /v1/admin/api-keys/:id

Revoke an API key.

- **Auth**: JWT (admin role)

### GET /v1/admin/audit-log

Query audit log.

- **Auth**: JWT (admin role)
- **Query Parameters**: `action`, `resource_type`, `actor_id`, `from`, `to`, `limit`, `offset`
- **Spec**: FR-038

---

## Rate Limiting & Backpressure

- Ingestion endpoints: Rate-limited per API key. Returns `429 Too Many Requests` with `Retry-After` header when exceeded.
- Query endpoints: Rate-limited per user/API key. Returns `429` when exceeded.
- Under system overload (buffer full, storage unavailable): Returns `503 Service Unavailable` per FR-041.

## OTLP gRPC Endpoints

In addition to the HTTP REST API, the platform exposes gRPC endpoints for OTLP ingestion:

- `otel.collector.logs.v1.LogsService/Export` — OTLP log ingestion (FR-001)
- `otel.collector.trace.v1.TraceService/Export` — OTLP trace ingestion (FR-010)

gRPC endpoints use the same API key authentication via metadata headers.
