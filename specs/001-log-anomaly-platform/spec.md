# Feature Specification: Log Aggregation & Anomaly Detection Platform

**Feature Branch**: `001-log-anomaly-platform`
**Created**: 2026-05-11
**Status**: Draft
**Input**: User description: "AI-native observability platform that transforms raw logs into contextual insights, reducing alert fatigue and accelerating root-cause analysis without requiring threshold configuration."

## Clarifications

### Session 2026-05-11

- Q: How should the platform receive deployment event data? → A: Accept deployment events via a dedicated webhook/API endpoint called by CI/CD pipelines.
- Q: Are Prometheus-compatible metrics in scope for the initial release? → A: No. Metrics are derived from logs and traces only — no separate metrics ingestion for the initial release.
- Q: When the ingestion buffer is full and storage is unavailable, what should the platform do? → A: Apply backpressure (HTTP 429/503) — senders retry; no silent data loss.
- Q: Should the platform provide log field redaction or masking for sensitive data? → A: Yes. Configurable redaction rules per tenant that mask sensitive patterns at ingestion time.
- Q: What should each RBAC role be able to do? → A: Viewer: read-only. Editor: read + manage alerts/channels/sampling. Admin: full access including users/keys/retention.
- Q: How should the platform handle malformed log records? → A: Accept with best-effort normalization — fill defaults for missing fields, truncate oversized bodies.
- Q: How should anomaly detection behave for services with less than 7 days of baseline data? → A: Basic statistical detection during learning period, then transition to full AI detection after 7 days.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ingest and Search Logs (Priority: P1)

An SRE receives alerts about production issues and needs to quickly find relevant log entries. They configure their services to send logs to the platform via OpenTelemetry Collector, Fluent Bit, or direct HTTP. Once logs are flowing, they search for specific error patterns, filter by service, severity, and time range, and view results in sub-second response times. They can also open a live tail view to watch logs stream in real time as they investigate an ongoing incident.

**Why this priority**: Log ingestion and search is the foundational capability. Without logs in the system and the ability to search them, no other feature can function. This is the table-stakes entry point for any observability platform.

**Independent Test**: Can be fully tested by configuring a service to send logs via OTLP/HTTP, then searching for those logs by keyword, severity, and time range. Delivers immediate value as a centralized log search tool.

**Acceptance Scenarios**:

1. **Given** a service instrumented with an OpenTelemetry SDK, **When** the service emits log records via OTLP/HTTP, **Then** those log records appear in the platform's search results within 5 seconds of emission.
2. **Given** 10 million log records stored over the past 7 days, **When** the user searches for a specific keyword (e.g., "TimeoutError"), **Then** matching results are returned in under 1 second.
3. **Given** the user opens the live tail view for a specific service, **When** new log records arrive from that service, **Then** they appear in the live tail within 2 seconds of ingestion.
4. **Given** a legacy system emitting syslog (RFC 5424), **When** logs are forwarded to the platform's syslog endpoint, **Then** the logs are normalized to the standard data model and searchable alongside OTLP logs.
5. **Given** a user searches for logs, **When** they apply filters for severity level "ERROR" and a specific service name, **Then** only matching records are returned, with correct result counts.

---

### User Story 2 - Log-to-Trace Correlation (Priority: P1)

A developer investigating a failed API request wants to understand the full request lifecycle. They find an error log entry in the log explorer, click through to the associated distributed trace, and see the complete call chain across all services involved in that request. They can identify which upstream or downstream service introduced the error and how long each service took.

**Why this priority**: Log-to-trace correlation transforms the platform from a log search tool into a diagnostic tool. It is the connection that lets users move from "what happened" to "why it happened." W3C Trace Context support makes this zero-configuration for services already instrumented with OpenTelemetry.

**Independent Test**: Can be tested by sending a traced request through a multi-service application, then navigating from the resulting error log to the full trace view. Delivers value as a request-level debugging tool.

**Acceptance Scenarios**:

1. **Given** a log record with a W3C `trace_id` and `span_id`, **When** the user clicks the trace correlation link on that log record, **Then** the full distributed trace is displayed showing all spans for that trace.
2. **Given** a distributed trace spanning 5 services, **When** the user views the trace, **Then** they see a timeline of all spans with service names, operation names, durations, and error indicators.
3. **Given** a trace with associated log records from multiple services, **When** the user views the trace detail, **Then** they can expand any span to see the log records emitted during that span's execution.

---

### User Story 3 - AI-Powered Anomaly Detection (Priority: P1)

An SRE team is tired of configuring thresholds for every service and constantly tuning them as traffic patterns change. They enable anomaly detection for their services. The platform automatically learns each service's baseline behavior — including expected patterns like Monday morning batch job spikes — and detects genuinely novel error patterns without requiring any threshold configuration. When a new error pattern emerges that the platform has never seen before, it surfaces an alert. When a known-noisy dependency causes elevated error counts, the platform recognizes it as noise and does not alert.

**Why this priority**: AI-powered anomaly detection is the primary differentiator of this platform. It addresses the #1 complaint in the observability market (alert fatigue from false positives) and is the capability that no open-source tool provides today. Without it, the platform is just another log search tool.

**Independent Test**: Can be tested by sending a mix of normal and anomalous log patterns to the platform and verifying that the anomaly detection correctly distinguishes novel errors from known-noisy patterns. Delivers value as an intelligent alerting system that reduces false positives.

**Acceptance Scenarios**:

1. **Given** a service with 7 days of ingested logs establishing a baseline, **When** a new error pattern appears that has never been seen before in that service, **Then** the platform detects it as an anomaly and surfaces it in the anomaly feed within 5 minutes.
2. **Given** a service with an established baseline that includes Monday morning batch job spikes, **When** the expected Monday spike occurs, **Then** the platform does NOT flag it as an anomaly.
3. **Given** a known-flaky dependency that causes periodic elevated error counts across multiple downstream services, **When** the flaky dependency produces its typical error pattern, **Then** the platform classifies the errors as known-noise and does not generate alerts.
4. **Given** a detected anomaly, **When** the user views the anomaly detail, **Then** they see a severity score, a human-readable title, an explanation of what makes this pattern unusual, sample log records, and correlated trace IDs.
5. **Given** a detected anomaly that was a false positive, **When** the user marks it as a false positive and provides feedback, **Then** the platform incorporates that feedback to improve future detection accuracy.

---

### User Story 4 - Alert Routing (Priority: P2)

An on-call engineer configures alert rules to route notifications to the right channels. Critical anomalies go to PagerDuty to page the on-call responder. Warning-level anomalies go to a Slack channel for the team's awareness. They set cooldown periods to prevent notification storms and can mute alerts during planned maintenance windows.

**Why this priority**: Alert routing is the action layer that makes anomaly detection operationally useful. Detection without notification leaves anomalies unseen. However, basic alerting can be checked manually through the UI in early stages.

**Independent Test**: Can be tested by creating alert rules with different severity levels and notification channels, then triggering anomalies that match each rule. Verify correct routing to Slack and PagerDuty.

**Acceptance Scenarios**:

1. **Given** an alert rule configured to send critical anomalies to PagerDuty, **When** a critical anomaly is detected, **Then** a PagerDuty incident is created within 60 seconds.
2. **Given** an alert rule with a 15-minute cooldown, **When** the same alert condition fires again within the cooldown window, **Then** no duplicate notification is sent.
3. **Given** an alert rule muted until a specific time, **When** a matching anomaly occurs during the mute window, **Then** the anomaly is recorded but no notification is sent.
4. **Given** a Slack notification channel, **When** a warning-level anomaly triggers an alert, **Then** a formatted message is posted to the configured Slack channel with anomaly details and a link to the platform.

---

### User Story 5 - Natural-Language Log Querying (Priority: P2)

A developer who is not an observability specialist needs to investigate a production issue. Instead of learning a complex query language, they type a plain-English question: "What caused the spike in 5xx errors between 2pm and 3pm UTC yesterday?" The platform translates this into an optimized query, runs it, and returns the results along with a plain-English explanation of the findings.

**Why this priority**: Natural-language querying removes the query language barrier that excludes non-specialist developers from log analysis. It dramatically expands the user base that can self-serve production investigations. However, log search with filters remains available for power users, making this an enhancement rather than a prerequisite.

**Independent Test**: Can be tested by asking natural-language questions about known log data and verifying that the translated query returns correct results with an accurate plain-English summary.

**Acceptance Scenarios**:

1. **Given** log data spanning the past 24 hours, **When** the user asks "show me all errors from the payment service in the last hour," **Then** the platform returns the same results as an equivalent manual filter query.
2. **Given** a natural-language question with a time range, **When** the platform translates it to a structured query, **Then** the translated query is displayed to the user alongside the results for transparency and learning.
3. **Given** the query results, **When** the platform generates a plain-English explanation, **Then** the explanation accurately summarizes the key findings (e.g., "Found 47 TimeoutError entries from payment-service, clustered around 14:32-14:38 UTC, all pointing to redis-cache as the upstream dependency").

---

### User Story 6 - Automated Root-Cause Narrative (Priority: P2)

When a critical anomaly is detected, the platform automatically generates a root-cause analysis report. It examines the anomalous log patterns, follows correlated distributed traces upstream, checks for recent deployments to affected services, and reviews metric changes. It produces a plain-language narrative explaining the probable cause with evidence citations: "The TimeoutError spike in payment-service started 3 minutes after deployment v2.3.1, which changed the Redis client connection pool size. Supporting evidence: p99 latency for redis.get spans increased from 5ms to 2400ms at 14:33 UTC."

**Why this priority**: Automated root-cause analysis is the most ambitious AI capability and the one that delivers the highest time savings. It transforms hours of manual investigation into seconds of automated reasoning. However, it depends on log ingestion, trace correlation, and anomaly detection all functioning, making it a later priority.

**Independent Test**: Can be tested by creating a scenario with a known root cause (e.g., deploy a config change that causes downstream errors), triggering anomaly detection, and verifying that the generated narrative correctly identifies the deployment as the probable cause.

**Acceptance Scenarios**:

1. **Given** a detected anomaly in a service with recent deployment history, **When** the platform generates a root-cause report, **Then** the report includes a plain-language summary, a probable cause hypothesis, a confidence score, and an evidence chain linking logs, traces, and deployments.
2. **Given** a root-cause report, **When** the user rates it as helpful or not helpful, **Then** the feedback is recorded and incorporated into future report generation quality.
3. **Given** an anomaly with correlated traces spanning multiple services, **When** the root-cause report is generated, **Then** it identifies the earliest point of failure in the call chain and traces the impact downstream.

---

### User Story 7 - Cost Management Dashboard (Priority: P3)

An engineering manager wants to understand and control their team's log storage costs. The cost management dashboard shows per-service, per-day ingestion volumes and estimated storage costs. The platform analyzes log streams and recommends sampling rules for high-volume, low-signal log lines (e.g., "Health check response 200" appearing 2 million times/day). The manager can apply recommended sampling rules with estimated cost savings.

**Why this priority**: Cost management addresses the persistent pain point of log volume cost explosion. While important for long-term platform viability, it does not block the core detection and investigation workflows.

**Independent Test**: Can be tested by ingesting logs from multiple services over several days, then viewing the cost dashboard to verify accurate volume tracking and reviewing AI-generated sampling recommendations.

**Acceptance Scenarios**:

1. **Given** log ingestion from multiple services over a 7-day period, **When** the user views the cost dashboard, **Then** they see per-service daily ingestion volume (in GB), estimated storage cost, and trend charts.
2. **Given** a high-volume, repetitive log pattern (e.g., health check responses), **When** the platform generates sampling recommendations, **Then** each recommendation includes the log pattern, current volume, recommended sample rate, estimated GB savings, and a plain-English explanation.
3. **Given** a user applies a sampling recommendation, **When** subsequent logs matching the pattern are ingested, **Then** only the specified percentage is retained, and the cost dashboard reflects the reduced volume.

---

### User Story 8 - Adaptive Alert Threshold Calibration (Priority: P3)

An SRE team has services with varying traffic patterns — some spike on Monday mornings due to batch jobs, others have predictable daily cycles. Instead of manually configuring and maintaining thresholds for each service, they rely on the platform to continuously learn service-specific baselines and automatically adjust alert thresholds. The platform explains its reasoning: "This service's error rate naturally spikes 3x on Monday mornings due to batch jobs — threshold adjusted from 2% to 6% for the Monday 6-9 AM window."

**Why this priority**: Adaptive thresholds eliminate the manual tuning burden that consumes significant SRE time. However, the core anomaly detection (P1) provides intelligent detection without thresholds; this feature adds explainability and fine-grained control on top of that foundation.

**Independent Test**: Can be tested by observing threshold adjustments over a simulated two-week period with known weekly patterns, verifying that the platform correctly identifies and adapts to recurring cycles.

**Acceptance Scenarios**:

1. **Given** a service with 14 days of baseline data showing a Monday morning spike pattern, **When** the platform calibrates thresholds, **Then** the Monday morning threshold for that service is automatically widened with an explanation of the weekly pattern.
2. **Given** an automatically adjusted threshold, **When** the user views the threshold detail, **Then** they see the current baseline values (mean, standard deviation, percentiles), time-of-week patterns, and a plain-language explanation of why the threshold was set to its current value.

---

### Edge Cases

- What happens when a service sends malformed log records (missing required fields, invalid severity levels, oversized bodies)? The platform accepts them with best-effort normalization: missing timestamps are filled with the server's observed timestamp, invalid severity values default to INFO (severity number 9), and oversized bodies are truncated at the configured maximum size. No records are rejected due to malformation.
- How does the system handle a sudden 10x spike in ingestion volume that exceeds the configured rate? The platform applies backpressure by returning HTTP 429 (Too Many Requests) or 503 (Service Unavailable). OTLP-compatible senders retry with exponential backoff.
- What happens when persistent storage is temporarily unavailable during ingestion? The platform buffers logs in-memory up to the configured buffer limit, then applies backpressure (HTTP 429/503) to senders. No logs are silently dropped.
- How does anomaly detection behave for a brand-new service with no baseline data? During the first 7 days (baseline learning period), the platform applies basic statistical detection (volume spikes, sudden error rate changes) and labels results as "learning mode." After the 7-day baseline is established, detection transitions to full AI-powered contextual analysis.
- What happens when a user's natural-language query is ambiguous or refers to services that don't exist?
- How does the system handle clock skew between services sending logs with different timestamp accuracy?
- What happens when a notification channel (Slack webhook, PagerDuty) is unreachable during alert routing?
- How does the cost management system handle services that are decommissioned mid-retention-period?

## Requirements *(mandatory)*

### Functional Requirements

**Log Ingestion & Storage**

- **FR-001**: System MUST accept log records via OpenTelemetry Protocol (OTLP) over both gRPC and HTTP.
- **FR-002**: System MUST accept log records via Syslog protocol (RFC 5424 and RFC 3164).
- **FR-003**: System MUST accept log records via a plain HTTP JSON endpoint for direct application integration.
- **FR-004**: System MUST normalize all ingested logs to a unified data model aligned with the OpenTelemetry Logs Data Model (timestamp, observed timestamp, severity number/text, body, trace ID, span ID, resource attributes, log attributes).
- **FR-005**: System MUST buffer ingested logs before writing to persistent storage to handle ingestion burst traffic.
- **FR-006**: System MUST retain log records for a configurable period per tenant, with a default of 30 days.
- **FR-041**: System MUST apply backpressure (HTTP 429 or 503 responses) when the ingestion buffer is full or persistent storage is unavailable, rather than silently dropping log records. No log data is lost under normal backpressure conditions.
- **FR-042**: System MUST support configurable redaction rules per tenant that mask sensitive patterns (e.g., credit card numbers, email addresses, API keys, bearer tokens) in log bodies and attributes at ingestion time, before data is written to persistent storage.
- **FR-043**: System MUST provide a set of built-in redaction patterns for common sensitive data types (credit card numbers, email addresses, bearer tokens) that tenants can enable without writing custom rules.
- **FR-044**: System MUST apply best-effort normalization to malformed log records: missing timestamps default to the server's observed timestamp, invalid severity values default to INFO (severity number 9), and oversized log bodies are truncated at a configurable maximum size. No log records are rejected due to malformation.

**Log Search & Exploration**

- **FR-007**: System MUST provide full-text search over log bodies with sub-second response for queries within the retention window.
- **FR-008**: System MUST support filtering logs by severity level, service name, time range, and custom attribute key-value pairs.
- **FR-009**: System MUST provide a real-time live tail view that streams new log records as they are ingested, with client-side filter-as-you-type capability.

**Distributed Tracing & Correlation**

- **FR-010**: System MUST accept distributed trace spans via OTLP (gRPC and HTTP).
- **FR-011**: System MUST correlate log records with distributed trace spans using W3C Trace Context headers (trace_id, span_id).
- **FR-012**: System MUST provide a trace viewer that displays all spans for a given trace in a timeline visualization with service names, operation names, durations, and error status.

**Anomaly Detection**

- **FR-013**: System MUST automatically learn per-service baseline behavior from ingested log and trace data (e.g., error rates from log severity counts, latency percentiles from trace span durations) without requiring manual threshold configuration or a separate metrics ingestion pipeline.
- **FR-014**: System MUST detect novel log error patterns that have not been seen before in a given service and distinguish them from known-noisy patterns.
- **FR-045**: System MUST provide basic statistical anomaly detection (volume spikes, error rate changes) for services with less than 7 days of baseline data, labeling results as "learning mode." After the 7-day baseline is established, the system transitions to full AI-powered contextual detection.
- **FR-015**: System MUST assign an anomaly severity score (0.0-1.0) and a human-readable classification (critical, warning, info) to each detected anomaly.
- **FR-016**: System MUST provide an anomaly feed showing all detected anomalies with title, severity, affected service, time window, and sample log records.
- **FR-017**: System MUST accept user feedback on detected anomalies (helpful, not helpful, false positive) and use that feedback to improve future detection accuracy.

**Alerting & Notification**

- **FR-018**: System MUST support configurable alert rules that trigger on anomaly detection events, log pattern matches, metric thresholds, and log absence conditions.
- **FR-019**: System MUST route alert notifications to Slack (via webhook) and PagerDuty (via integration key).
- **FR-020**: System MUST support email and generic webhook notification channels.
- **FR-021**: System MUST enforce configurable cooldown periods per alert rule to prevent notification storms.
- **FR-022**: System MUST allow alert rules to be muted for a specified time window (e.g., during planned maintenance).

**Natural-Language Querying**

- **FR-023**: System MUST accept plain-English questions about log data and translate them into structured queries.
- **FR-024**: System MUST display the translated structured query alongside results for transparency.
- **FR-025**: System MUST generate a plain-English summary of query results.

**Root-Cause Analysis**

- **FR-026**: System MUST automatically generate a root-cause analysis report for detected anomalies that includes a plain-language summary, probable cause, confidence score, and evidence chain.
- **FR-027**: The evidence chain MUST link related log patterns, correlated trace data, and recent deployments to affected services.
- **FR-028**: System MUST accept user feedback on root-cause report accuracy (helpful / not helpful) to improve future report quality.

**Cost Management**

- **FR-029**: System MUST track per-service, per-day ingestion volume (record count and bytes) and estimated storage cost.
- **FR-030**: System MUST generate AI-powered sampling recommendations for high-volume, low-signal log patterns, including estimated cost savings.
- **FR-031**: System MUST allow users to apply sampling recommendations that reduce the ingestion rate for specified log patterns.

**Multi-Tenancy & Access Control**

- **FR-032**: System MUST support multiple tenants with complete data isolation — no tenant can access another tenant's logs, traces, anomalies, or configuration.
- **FR-033**: System MUST support role-based access control with three roles: **Viewer** (read-only access to logs, traces, anomalies, alerts, dashboards, and cost data), **Editor** (viewer permissions plus create/modify/delete alert rules, notification channels, sampling rules, and redaction rules), and **Admin** (editor permissions plus manage tenant settings, users, API keys, and retention policies).
- **FR-034**: System MUST support authentication via OAuth 2.0 and OpenID Connect for enterprise SSO integration.
- **FR-035**: System MUST support API key-based authentication with configurable scopes for programmatic access.

**Service Registry**

- **FR-036**: System MUST automatically discover and register services from ingested telemetry data (log and trace resource attributes).
- **FR-037**: System MUST maintain a service dependency graph derived from distributed trace data, showing which services call which other services.

**Deployment Tracking**

- **FR-039**: System MUST accept deployment events via a dedicated webhook/API endpoint, recording: service name, version, commit SHA, deployer identity, timestamp, and optional changelog.
- **FR-040**: System MUST associate deployment events with the affected service in the service registry for use in root-cause correlation (FR-027).

**Audit & Compliance**

- **FR-038**: System MUST maintain an audit log of all configuration changes (alert rules, retention policies, user management) with actor, action, timestamp, and before/after values.

### Key Entities

- **Tenant**: An organizational unit that owns all data and configuration. Tenants are completely isolated from each other. Key attributes: name, plan tier, retention settings, ingestion limits.
- **Service**: A software component that emits telemetry. Automatically discovered from ingested data. Key attributes: name, namespace, environment, owner team, language.
- **Log Record**: A single log entry from a service. Key attributes: timestamp, severity, body (message text), trace/span correlation, source type, resource and log attributes.
- **Trace Span**: A single unit of work in a distributed trace. Key attributes: trace ID, span ID, parent span, operation name, service, duration, status, events.
- **Anomaly**: A detected deviation from normal behavior. Key attributes: type (volume spike, novel pattern, error rate, latency), severity score, affected service, time window, sample evidence, resolution status, user feedback.
- **Alert Rule**: A configuration that defines when and how to notify users. Key attributes: rule type, condition, notification channels, severity, cooldown, mute window.
- **Notification Channel**: A delivery endpoint for alert notifications. Key attributes: channel type (Slack, PagerDuty, email, webhook), configuration, verification status.
- **Redaction Rule**: A tenant-scoped pattern matching rule that masks sensitive data in log content at ingestion time. Key attributes: pattern (regex or built-in type), replacement text, applies-to (body, specific attributes, or all), enabled status.
- **Anomaly Baseline**: Learned normal behavior for a service metric. Key attributes: mean, standard deviation, percentiles, hourly patterns, day-of-week patterns.
- **Root-Cause Report**: An AI-generated analysis of an anomaly. Key attributes: summary narrative, probable cause, confidence, evidence chain, user feedback.
- **Deployment**: A recorded deployment event for a service, submitted by CI/CD pipelines via the deployment webhook. Key attributes: service, version, commit SHA, deployer, timestamp, changelog.
- **Service Dependency**: A directed relationship between two services (A calls B). Key attributes: dependency type, call count, average latency, error rate, discovery method.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can find relevant logs for an ongoing incident in under 30 seconds from opening the platform (search, filter, navigate).
- **SC-002**: The platform achieves a false-positive rate below 15% for anomaly detection after 14 days of baseline learning — measured by user feedback on detected anomalies.
- **SC-003**: 90% of detected anomalies surface within 5 minutes of the anomalous pattern first appearing in ingested logs.
- **SC-004**: Users without observability expertise can successfully investigate a production issue using natural-language queries, completing the investigation in under 10 minutes (compared to 30+ minutes using traditional query languages).
- **SC-005**: Root-cause analysis reports correctly identify the probable root cause (as confirmed by user feedback) in at least 60% of cases.
- **SC-006**: Platform supports ingestion of at least 100,000 log records per second sustained for a single tenant without degradation of query performance.
- **SC-007**: Full-text log search returns results in under 1 second for queries within the most recent 7 days of data.
- **SC-008**: Alert notifications are delivered to configured channels (Slack, PagerDuty) within 60 seconds of anomaly detection.
- **SC-009**: Sampling recommendations, when applied, reduce storage costs for targeted log patterns by at least 50% without losing operationally significant log entries.
- **SC-010**: The platform sustains 99.9% availability for ingestion endpoints (measured monthly), ensuring no log data is lost during normal operations.

## Assumptions

- Target users are SRE teams, DevOps engineers, and developers at cloud-native organizations running microservice architectures instrumented with OpenTelemetry or willing to adopt it.
- Services are already producing structured or semi-structured logs; the platform does not need to instrument applications — only receive and analyze their output.
- The deployment environment has access to sufficient compute for running ML model inference (anomaly detection) alongside high-throughput log ingestion.
- The platform will be deployed as a self-hosted solution initially, with a managed cloud offering as a future possibility.
- Users have access to Slack and/or PagerDuty for alert routing; email is available as a fallback.
- Log retention of 30 days (hot), with configurable warm/cold tiers, is sufficient for most operational investigation needs.
- OpenTelemetry is the primary instrumentation standard; legacy ingestion paths (syslog, plain HTTP) are supported for backward compatibility but are not the primary expected input.
- Multi-tenancy isolation is enforced at the database level, not merely at the application level.
- The anomaly detection system requires a minimum of 7 days of ingested log data per service before it can produce full AI-powered contextual baseline models. During the learning period, basic statistical detection is available with higher expected false-positive rates.
- Security log analysis (OWASP/NIST event detection) is deferred to a future release and is not part of the initial specification scope.
- Prometheus-compatible metrics ingestion is deferred to a future release (v1.1). For the initial release, all metric-like data (error rates, latency percentiles, log volume trends) is derived from ingested logs and trace spans.
