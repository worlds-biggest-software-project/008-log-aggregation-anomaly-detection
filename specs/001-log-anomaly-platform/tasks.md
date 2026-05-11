# Tasks: Log Aggregation & Anomaly Detection Platform

**Input**: Design documents from `specs/001-log-anomaly-platform/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contract.md, quickstart.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Monorepo scaffolding, local development environment, CI pipeline.

- [x] T001 Create pnpm monorepo root with `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, and `.gitignore` in `logwatch/`
- [x] T002 [P] Create `packages/shared/` package with `package.json`, `tsconfig.json`, and `src/index.ts` entry point in `logwatch/packages/shared/`
- [x] T003 [P] Create `packages/db/` package with `package.json`, `tsconfig.json`, and `src/index.ts` entry point in `logwatch/packages/db/`
- [x] T004 [P] Create `packages/test-utils/` package with `package.json`, `tsconfig.json`, and `src/index.ts` entry point in `logwatch/packages/test-utils/`
- [x] T005 [P] Create `apps/api/` Fastify app scaffold with `package.json`, `tsconfig.json`, and `src/server.ts` bootstrap in `logwatch/apps/api/`
- [x] T006 [P] Create `apps/web/` Next.js 15 app scaffold with App Router layout in `logwatch/apps/web/`
- [x] T007 [P] Create `apps/anomaly-engine/` Python FastAPI scaffold with `requirements.txt`, `pyproject.toml`, and `src/main.py` in `logwatch/apps/anomaly-engine/`
- [x] T008 [P] Create `apps/cli/` CLI app scaffold with `package.json` and `src/index.ts` in `logwatch/apps/cli/`
- [x] T009 Create `docker-compose.yml` with ClickHouse 24.8+, PostgreSQL 16+, and Redis 7+ services in `logwatch/docker-compose.yml`
- [x] T010 [P] Create `.env.example` with all required environment variables in `logwatch/.env.example`
- [x] T011 [P] Configure ESLint, Prettier, and root-level `pnpm lint` script in `logwatch/`
- [x] T012 [P] Configure Vitest at workspace level with shared config in `logwatch/vitest.config.ts`
- [x] T013 [P] Create `.github/workflows/ci.yml` with lint, typecheck, test, and build jobs in `logwatch/.github/workflows/ci.yml`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, database schemas, auth middleware, and tenant isolation. MUST complete before any user story.

- [x] T014 Define OTel log record TypeScript types (`OtelLogRecord`, `SeverityLevel`, `ResourceAttributes`) in `logwatch/packages/shared/src/types/log.ts`
- [x] T015 [P] Define OTel trace span TypeScript types (`TraceSpan`, `SpanKind`, `SpanStatus`) in `logwatch/packages/shared/src/types/trace.ts`
- [x] T016 [P] Define anomaly, alert, and tenant TypeScript types (`Anomaly`, `AlertRule`, `NotificationChannel`, `Tenant`, `User`) in `logwatch/packages/shared/src/types/`
- [x] T017 [P] Define severity level constants and OCSF enum mappings in `logwatch/packages/shared/src/constants/severity.ts`
- [x] T018 [P] Implement W3C traceparent parser utility in `logwatch/packages/shared/src/utils/traceparent.ts`
- [x] T019 [P] Implement RFC 5424 syslog message parser utility in `logwatch/packages/shared/src/utils/syslog-parser.ts`
- [x] T020 Create PostgreSQL connection pool wrapper with `app.current_tenant` context injection in `logwatch/packages/db/src/postgres/client.ts`
- [x] T021 [P] Create ClickHouse client wrapper with tenant-scoped query helper in `logwatch/packages/db/src/clickhouse/client.ts`
- [x] T022 Write PostgreSQL migration: `tenants`, `users`, `api_keys` tables with RLS policies in `logwatch/packages/db/src/postgres/migrations/001_tenants_users.sql`
- [x] T023 Write PostgreSQL migration: `services`, `service_dependencies` tables with RLS in `logwatch/packages/db/src/postgres/migrations/002_services.sql`
- [x] T024 [P] Write PostgreSQL migration: `redaction_rules` table with RLS and seed built-in patterns in `logwatch/packages/db/src/postgres/migrations/003_redaction_rules.sql`
- [x] T025 [P] Write PostgreSQL migration: `audit_log` table (partitioned by `created_at`) in `logwatch/packages/db/src/postgres/migrations/004_audit_log.sql`
- [x] T026 Write ClickHouse DDL: `otel_logs` table with indexes and TTL in `logwatch/packages/db/src/clickhouse/001_otel_logs.sql`
- [x] T027 [P] Write ClickHouse DDL: `otel_traces` table with indexes and TTL in `logwatch/packages/db/src/clickhouse/002_otel_traces.sql`
- [x] T028 Create migration runner scripts (`migrate`, `migrate:create`, `migrate:reset`, `clickhouse:setup`) in `logwatch/packages/db/package.json`
- [x] T029 Implement Fastify auth plugin: JWT verification (NextAuth.js tokens) and API key validation with tenant context injection in `logwatch/apps/api/src/plugins/auth.ts`
- [x] T030 [P] Implement Fastify ClickHouse plugin: register ClickHouse client as app decorator in `logwatch/apps/api/src/plugins/clickhouse.ts`
- [x] T031 [P] Implement Fastify PostgreSQL plugin: register pg pool with per-request tenant context in `logwatch/apps/api/src/plugins/postgres.ts`
- [x] T032 Implement RBAC middleware enforcing viewer/editor/admin role permissions per endpoint in `logwatch/apps/api/src/plugins/rbac.ts`
- [x] T033 [P] Implement audit log service: record configuration changes with actor, action, before/after values in `logwatch/apps/api/src/services/audit.ts`
- [x] T034 Create test factories for tenants, users, services, and log records in `logwatch/packages/test-utils/src/factories.ts`
- [x] T035 [P] Configure NextAuth.js with OAuth 2.0/OIDC providers (Google, GitHub) and JWT session strategy in `logwatch/apps/web/src/app/api/auth/[...nextauth]/route.ts`
- [x] T036 [P] Create login page and auth callback handler in `logwatch/apps/web/src/app/(auth)/login/page.tsx`
- [x] T037 Create authenticated dashboard layout with sidebar navigation in `logwatch/apps/web/src/app/(dashboard)/layout.tsx`

---

## Phase 3: User Story 1 — Ingest and Search Logs (P1)

**Story Goal**: Ingest logs via OTLP, syslog, and HTTP JSON; search with sub-second full-text; live tail via SSE.
**Independent Test**: Send logs via OTLP/HTTP, search by keyword/severity/time range, verify live tail streaming.
**Depends on**: Phase 2

- [x] T038 [US1] Implement redaction service: apply tenant redaction rules to log bodies and attributes at ingestion time in `logwatch/apps/api/src/services/redaction.ts`
- [x] T039 [US1] Implement log normalization service: malformed log handling (default timestamps, severity, body truncation) per FR-044 in `logwatch/apps/api/src/services/normalizer.ts`
- [x] T040 [US1] Implement ingestion service: accept normalized logs, apply redaction, publish to Redis Stream with backpressure (429/503) in `logwatch/apps/api/src/services/ingestion.ts`
- [x] T041 [US1] Implement OTLP log ingestion route (HTTP JSON + protobuf) in `logwatch/apps/api/src/routes/ingest/otlp-logs.ts`
- [x] T042 [P] [US1] Implement syslog ingestion route (RFC 5424/3164 parsing via shared util) in `logwatch/apps/api/src/routes/ingest/syslog.ts`
- [x] T043 [P] [US1] Implement HTTP JSON ingestion route in `logwatch/apps/api/src/routes/ingest/json.ts`
- [x] T044 [US1] Implement Redis Stream → ClickHouse batch writer worker: consume from Redis Stream, batch insert into `otel_logs` in `logwatch/apps/api/src/workers/log-writer.ts`
- [x] T045 [US1] Implement service auto-discovery: extract `service.name` from resource attributes, upsert into `services` table in `logwatch/apps/api/src/services/service-registry.ts`
- [x] T046 [US1] Implement log search service: full-text search via `hasToken()`, severity/service/time/attribute filters in `logwatch/apps/api/src/services/search.ts`
- [x] T047 [US1] Implement `GET /v1/logs` search route with pagination in `logwatch/apps/api/src/routes/logs.ts`
- [x] T048 [US1] Implement `GET /v1/logs/live` SSE route for live tail with filter support in `logwatch/apps/api/src/routes/logs-live.ts`
- [x] T049 [US1] Create log explorer page with search bar, severity/service/time filters, and results table in `logwatch/apps/web/src/app/(dashboard)/logs/page.tsx`
- [x] T050 [P] [US1] Create log detail panel component (expandable row with full body, attributes, trace link) in `logwatch/apps/web/src/app/(dashboard)/logs/log-detail.tsx`
- [x] T051 [US1] Create live tail view component with SSE connection and filter-as-you-type in `logwatch/apps/web/src/app/(dashboard)/logs/live-tail.tsx`

---

## Phase 4: User Story 2 — Log-to-Trace Correlation (P1)

**Story Goal**: Ingest trace spans, display trace timeline, navigate from log to trace.
**Independent Test**: Send traced request through multi-service app, navigate from error log to full trace view.
**Depends on**: Phase 3 (log ingestion must be working for log-to-trace links)

- [x] T052 [US2] Implement OTLP trace ingestion route (HTTP JSON + protobuf) with Redis Stream buffering in `logwatch/apps/api/src/routes/ingest/otlp-traces.ts`
- [x] T053 [US2] Implement Redis Stream → ClickHouse batch writer for trace spans in `logwatch/apps/api/src/workers/trace-writer.ts`
- [x] T054 [US2] Implement trace query service: fetch all spans for a trace ID, assemble timeline in `logwatch/apps/api/src/services/trace-query.ts`
- [x] T055 [US2] Implement `GET /v1/traces/:traceId` route returning full trace with spans and associated logs in `logwatch/apps/api/src/routes/traces.ts`
- [x] T056 [P] [US2] Implement `GET /v1/traces` list route with filters (service, operation, status, duration, time range) in `logwatch/apps/api/src/routes/traces.ts`
- [x] T057 [US2] Implement service dependency graph builder worker: derive `service_dependencies` from trace parent-child spans in `logwatch/apps/api/src/workers/graph-builder.ts`
- [x] T058 [US2] Create trace timeline viewer component with span waterfall, durations, and error indicators in `logwatch/apps/web/src/app/(dashboard)/traces/[traceId]/page.tsx`
- [x] T059 [P] [US2] Create trace list page with search and filters in `logwatch/apps/web/src/app/(dashboard)/traces/page.tsx`
- [x] T060 [US2] Add trace correlation link to log detail panel: click trace_id to navigate to trace view in `logwatch/apps/web/src/app/(dashboard)/logs/log-detail.tsx`
- [x] T061 [P] [US2] Implement `GET /v1/services` and `GET /v1/services/:id/dependencies` routes in `logwatch/apps/api/src/routes/services.ts`
- [x] T062 [P] [US2] Create service registry page with dependency graph visualization in `logwatch/apps/web/src/app/(dashboard)/services/page.tsx`

---

## Phase 5: User Story 3 — AI-Powered Anomaly Detection (P1)

**Story Goal**: Learn baselines, detect anomalies (statistical + LogBERT), surface anomaly feed with feedback.
**Independent Test**: Send normal + anomalous log patterns, verify correct detection and classification within 5 minutes.
**Depends on**: Phase 3 (needs ingested logs to analyze)

- [x] T063 [US3] Write PostgreSQL migration: `anomaly_models`, `anomalies`, `anomaly_baselines` tables with RLS in `logwatch/packages/db/src/postgres/migrations/005_anomalies.sql`
- [x] T064 [US3] Implement statistical anomaly detector: z-score on error rates, volume spike detection in `logwatch/apps/anomaly-engine/src/models/statistical.py`
- [x] T065 [US3] Implement anomaly baseline manager: compute and store per-service baselines (mean, stddev, hourly/DoW patterns) in `logwatch/apps/anomaly-engine/src/models/manager.py`
- [x] T066 [US3] Implement LogBERT model wrapper: load pre-trained model, fine-tune on service logs, predict anomaly scores in `logwatch/apps/anomaly-engine/src/models/logbert.py`
- [x] T067 [US3] Implement two-phase detection orchestrator: statistical during learning period, LogBERT after 7-day baseline in `logwatch/apps/anomaly-engine/src/models/detector.py`
- [x] T068 [US3] Implement Redis Stream consumer pipeline: read log batches from Redis, score with detector, write anomalies to PostgreSQL in `logwatch/apps/anomaly-engine/src/pipeline/consumer.py`
- [x] T069 [US3] Implement anomaly scorer: assign severity (0.0–1.0), classify (critical/warning/info), generate title and description in `logwatch/apps/anomaly-engine/src/pipeline/scorer.py`
- [x] T070 [P] [US3] Implement FastAPI health and predict endpoints in `logwatch/apps/anomaly-engine/src/api/routes.py`
- [x] T071 [US3] Implement `GET /v1/anomalies` and `GET /v1/anomalies/:id` routes in `logwatch/apps/api/src/routes/anomalies.ts`
- [x] T072 [US3] Implement `PATCH /v1/anomalies/:id` for status updates and user feedback in `logwatch/apps/api/src/routes/anomalies.ts`
- [x] T073 [US3] Implement `GET /v1/anomalies/:id/baselines` route returning service baseline data in `logwatch/apps/api/src/routes/anomalies.ts`
- [x] T074 [US3] Create anomaly feed page with severity/service/status filters and anomaly cards in `logwatch/apps/web/src/app/(dashboard)/anomalies/page.tsx`
- [x] T075 [US3] Create anomaly detail page with severity score, explanation, sample logs, correlated traces, and feedback buttons in `logwatch/apps/web/src/app/(dashboard)/anomalies/[id]/page.tsx`

---

## Phase 6: User Story 4 — Alert Routing (P2)

**Story Goal**: Configure alert rules, route notifications to Slack/PagerDuty/email/webhook with cooldown and mute.
**Independent Test**: Create rules with different severities and channels, trigger anomalies, verify correct routing.
**Depends on**: Phase 5 (anomaly detection must produce anomalies to trigger alerts)

- [x] T076 [US4] Write PostgreSQL migration: `notification_channels`, `alert_rules`, `alert_events` tables with RLS in `logwatch/packages/db/src/postgres/migrations/006_alerting.sql`
- [x] T077 [US4] Implement notification channel CRUD routes (`/v1/notifications/channels`) including test notification in `logwatch/apps/api/src/routes/notifications.ts`
- [x] T078 [US4] Implement alert rule CRUD routes (`/v1/alerts/rules`) with mute support in `logwatch/apps/api/src/routes/alerts.ts`
- [x] T079 [US4] Implement notification service: dispatch to Slack (webhook), PagerDuty (integration key), email, generic webhook in `logwatch/apps/api/src/services/notification.ts`
- [x] T080 [US4] Implement alert evaluator service: evaluate rules against anomaly events, enforce cooldown, check mute windows in `logwatch/apps/api/src/services/alert-evaluator.ts`
- [x] T081 [US4] Implement alert scheduler worker: periodically evaluate enabled alert rules and fire notifications in `logwatch/apps/api/src/workers/alert-scheduler.ts`
- [x] T082 [US4] Create notification channel management page (add/edit/delete/test channels) in `logwatch/apps/web/src/app/(dashboard)/alerts/channels/page.tsx`
- [x] T083 [US4] Create alert rules management page (add/edit/delete/mute rules) in `logwatch/apps/web/src/app/(dashboard)/alerts/rules/page.tsx`
- [x] T084 [P] [US4] Create alert events timeline page showing firing/resolved history in `logwatch/apps/web/src/app/(dashboard)/alerts/events/page.tsx`

---

## Phase 7: User Story 5 — Natural-Language Log Querying (P2)

**Story Goal**: Translate plain-English questions to ClickHouse queries, execute, summarize results.
**Independent Test**: Ask NL questions about known log data, verify translated query returns correct results with accurate summary.
**Depends on**: Phase 3 (needs log search infrastructure)

- [x] T085 [US5] Write PostgreSQL migration: `nl_queries` table with RLS in `logwatch/packages/db/src/postgres/migrations/007_nl_queries.sql`
- [x] T086 [US5] Implement Claude API client with prompt caching and structured output for query translation in `logwatch/apps/api/src/services/llm-client.ts`
- [x] T087 [US5] Implement NL query translation service: natural language → ClickHouse SQL with schema context and tenant scoping in `logwatch/apps/api/src/services/nl-query.ts`
- [x] T088 [US5] Implement result summarization: generate plain-English explanation of query results via Claude API in `logwatch/apps/api/src/services/nl-query.ts`
- [x] T089 [US5] Implement `POST /v1/ai/query` route: translate, execute, summarize, persist query history in `logwatch/apps/api/src/routes/ai.ts`
- [x] T090 [US5] Create NL query interface component with question input, translated query display, results, and summary in `logwatch/apps/web/src/app/(dashboard)/logs/nl-query.tsx`

---

## Phase 8: User Story 6 — Automated Root-Cause Narrative (P2)

**Story Goal**: Generate RCA reports linking logs, traces, deployments; collect user feedback.
**Independent Test**: Create scenario with known root cause (deploy config change → errors), verify narrative identifies deployment.
**Depends on**: Phase 4 (traces), Phase 5 (anomalies)

- [x] T091 [US6] Write PostgreSQL migration: `deployments`, `rca_reports` tables with RLS in `logwatch/packages/db/src/postgres/migrations/008_deployments_rca.sql`
- [x] T092 [US6] Implement `POST /v1/deployments` and `GET /v1/deployments` routes for deployment tracking in `logwatch/apps/api/src/routes/deployments.ts`
- [x] T093 [US6] Implement RCA evidence gatherer: collect related logs, traces, deployments, and metric changes for an anomaly in `logwatch/apps/api/src/services/rca-evidence.ts`
- [x] T094 [US6] Implement RCA narrative generator: Claude API tool-use workflow to analyze evidence and produce root-cause narrative in `logwatch/apps/api/src/services/rca-generator.ts`
- [x] T095 [US6] Implement `GET /v1/anomalies/:id/rca` route (generate on demand if not cached) and `POST /v1/anomalies/:id/rca/feedback` in `logwatch/apps/api/src/routes/anomalies.ts`
- [x] T096 [US6] Add RCA report section to anomaly detail page: narrative, probable cause, confidence, evidence chain, feedback in `logwatch/apps/web/src/app/(dashboard)/anomalies/[id]/rca-panel.tsx`
- [x] T097 [P] [US6] Create deployments page listing recent deployments per service in `logwatch/apps/web/src/app/(dashboard)/services/[id]/deployments/page.tsx`

---

## Phase 9: User Story 7 — Cost Management Dashboard (P3)

**Story Goal**: Track per-service ingestion volume/cost, generate and apply sampling recommendations.
**Independent Test**: Ingest logs from multiple services, verify cost dashboard shows accurate volumes and sampling suggestions.
**Depends on**: Phase 3 (needs ingestion volume data)

- [x] T098 [US7] Write PostgreSQL migration: `ingest_usage`, `sampling_recommendations` tables with RLS in `logwatch/packages/db/src/postgres/migrations/009_cost_management.sql`
- [x] T099 [US7] Implement usage tracking worker: aggregate daily ingestion volume per service from ClickHouse into `ingest_usage` in `logwatch/apps/api/src/workers/usage-tracker.ts`
- [x] T100 [US7] Implement sampling recommendation service: identify high-volume low-signal patterns, compute sample rates and savings via Claude API in `logwatch/apps/api/src/services/sampling.ts`
- [x] T101 [US7] Implement `GET /v1/cost/usage`, `GET /v1/cost/recommendations`, and `POST /v1/cost/recommendations/:id/apply` routes in `logwatch/apps/api/src/routes/cost.ts`
- [x] T102 [US7] Implement sampling rule enforcement in ingestion pipeline: skip records matching applied sampling rules at configured rate in `logwatch/apps/api/src/services/ingestion.ts`
- [x] T103 [US7] Create cost management dashboard page with per-service volume charts, cost estimates, and trend lines in `logwatch/apps/web/src/app/(dashboard)/cost/page.tsx`
- [x] T104 [US7] Create sampling recommendations panel with apply/dismiss actions and savings estimates in `logwatch/apps/web/src/app/(dashboard)/cost/recommendations.tsx`

---

## Phase 10: User Story 8 — Adaptive Alert Threshold Calibration (P3)

**Story Goal**: Continuously learn per-service baselines, auto-adjust thresholds, explain reasoning.
**Independent Test**: Simulate 14 days of weekly patterns, verify threshold adjustments and explanations.
**Depends on**: Phase 5 (anomaly baselines), Phase 6 (alert rules)

- [x] T105 [US8] Implement baseline pattern analyzer: detect hourly and day-of-week patterns from anomaly baselines in `logwatch/apps/anomaly-engine/src/models/pattern_analyzer.py`
- [x] T106 [US8] Implement adaptive threshold calibrator: adjust alert thresholds based on detected patterns in `logwatch/apps/anomaly-engine/src/models/threshold_calibrator.py`
- [x] T107 [US8] Implement threshold explanation generator: produce plain-language reasoning via Claude API for threshold adjustments in `logwatch/apps/api/src/services/threshold-explainer.ts`
- [x] T108 [US8] Add threshold detail view to anomaly baselines UI: show current values, time-of-week patterns, and explanations in `logwatch/apps/web/src/app/(dashboard)/anomalies/baselines/page.tsx`

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Admin UI, CLI, production configuration, documentation.

- [x] T109 Implement admin routes: tenant settings, user management, API key management, redaction rules in `logwatch/apps/api/src/routes/admin.ts`
- [x] T110 [P] Implement `GET /v1/admin/audit-log` route with filters in `logwatch/apps/api/src/routes/admin.ts`
- [x] T111 Create admin settings pages: tenant config, user management, API keys, retention, redaction rules in `logwatch/apps/web/src/app/(dashboard)/settings/`
- [x] T112 [P] Implement CLI commands: `logwatch ingest` (ship logs from stdin), `logwatch query` (search logs), `logwatch api-key create/list/revoke` in `logwatch/apps/cli/src/`
- [x] T113 [P] Create `docker-compose.prod.yml` with production configs and `Dockerfile` for each app in `logwatch/`
- [x] T114 [P] Create Helm chart for Kubernetes deployment in `logwatch/helm/logwatch/`
- [x] T115 [P] Generate OpenAPI 3.2 specification from Fastify route schemas in `logwatch/docs/openapi.yaml`
- [x] T116 [P] Create `.github/workflows/release.yml` for Docker image build and push in `logwatch/.github/workflows/release.yml`
- [x] T117 Implement OTLP gRPC ingestion endpoints (logs + traces) alongside existing HTTP endpoints in `logwatch/apps/api/src/routes/ingest/otlp-grpc.ts`

---

## Dependencies

```text
Phase 1 (Setup)
  └─▶ Phase 2 (Foundational)
        ├─▶ Phase 3 (US1: Ingest & Search) ─────────────────────┐
        │     ├─▶ Phase 4 (US2: Trace Correlation) ─────────────┤
        │     ├─▶ Phase 5 (US3: Anomaly Detection) ─────────────┤
        │     │     └─▶ Phase 6 (US4: Alert Routing)            │
        │     │     └─▶ Phase 8 (US6: Root-Cause) ◀── Phase 4   │
        │     ├─▶ Phase 7 (US5: NL Querying)                    │
        │     └─▶ Phase 9 (US7: Cost Management)                │
        │                                                        │
        │   Phase 10 (US8: Adaptive Thresholds) ◀── Phase 5 + 6 │
        └─▶ Phase 11 (Polish) ◀── All phases ───────────────────┘
```

## Parallel Execution Opportunities

**Within Phase 2**: T014–T019 (shared types/utils) are all parallelizable. T022–T027 (database schemas) are partially parallel across engines.

**Within Phase 3**: T042 (syslog) and T043 (JSON ingest) are parallel with each other after T040 (ingestion service). T049–T051 (UI components) are partially parallel.

**Across Phases**: Phase 4 (traces) and Phase 5 (anomaly detection) can start in parallel once Phase 3 is complete. Phase 7 (NL querying) is independent of Phases 4–6 and can run in parallel with them.

**Phase 11**: Most tasks (T112–T116) are parallelizable since they target independent deliverables (CLI, Docker, Helm, OpenAPI, CI).

## Implementation Strategy

**MVP (recommended starting scope)**: Phase 1 + Phase 2 + Phase 3 (User Story 1). This delivers a functional log ingestion and search platform that can be demonstrated and used immediately. All other phases build incrementally on this foundation.

**First milestone (P1 complete)**: Add Phase 4 + Phase 5 to reach all three P1 user stories: log search, trace correlation, and anomaly detection.

**Second milestone (P2 complete)**: Add Phases 6–8 for alert routing, NL querying, and root-cause analysis.

**Full release**: Add Phases 9–11 for cost management, adaptive thresholds, admin UI, CLI, and production deployment.
