# Implementation Plan: Log Aggregation & Anomaly Detection Platform

**Branch**: `001-log-anomaly-platform` | **Date**: 2026-05-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-log-anomaly-platform/spec.md`

## Summary

Build an AI-native observability platform that ingests logs and traces via OpenTelemetry, stores telemetry in ClickHouse (columnar analytics) and operational data in PostgreSQL (ACID transactions), detects anomalies using a Python ML microservice (statistical baselines + LogBERT), and provides a Next.js web UI for log search, trace visualization, anomaly investigation, and alert management. The platform differentiates through contextual anomaly detection that reduces false positives, natural-language log querying, and automated root-cause narrative generation powered by Claude API.

## Technical Context

**Language/Version**: TypeScript (Node.js 20+) for API and frontend; Python 3.11+ for anomaly detection engine
**Primary Dependencies**: Fastify (API server), Next.js 15 (frontend), FastAPI (Python ML service), @clickhouse/client, pg, ioredis
**Storage**: ClickHouse 24.8+ (telemetry: logs, traces), PostgreSQL 16+ (operational: users, tenants, alerts, anomalies), Redis 7+ (ingestion buffer, job queue)
**Testing**: Vitest (TypeScript unit/integration), Playwright (E2E), pytest (Python unit/integration)
**Target Platform**: Linux server — Docker Compose (development), Kubernetes with Helm (production)
**Project Type**: Web service (pnpm monorepo with 4 apps: api, anomaly-engine, web, cli; 3 shared packages: shared, db, test-utils)
**Performance Goals**: 100K log records/sec sustained ingestion per tenant, sub-second full-text search over 7 days of data, anomaly detection within 5 minutes of pattern emergence
**Constraints**: Backpressure (HTTP 429/503) under overload — no silent data loss; database-enforced multi-tenant isolation (PostgreSQL RLS, ClickHouse partition-by-tenant); ingestion-time redaction of sensitive data
**Scale/Scope**: Multi-tenant SaaS architecture; initial target: 10 tenants, 500 services, 100K logs/sec aggregate; Data Model Suggestion 2 (Hybrid ClickHouse + PostgreSQL)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution has not been customized (contains template placeholders only). No specific gates are defined. The plan proceeds without constitution-specific constraints. If a constitution is later defined via `/speckit-constitution`, the plan should be re-evaluated against its gates.

## Project Structure

### Documentation (this feature)

```text
specs/001-log-anomaly-platform/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: technology decisions and rationale
├── data-model.md        # Phase 1: entity model with ClickHouse + PostgreSQL schemas
├── quickstart.md        # Phase 1: developer setup guide
├── contracts/           # Phase 1: API contracts
│   └── api-contract.md  # REST API endpoint contract
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── tasks.md             # Phase 2 output (created by /speckit-tasks)
```

### Source Code (repository root)

```text
logwatch/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml                    # local dev: ClickHouse, PostgreSQL, Redis
├── docker-compose.prod.yml
├── .github/workflows/
│   ├── ci.yml                            # lint, test, build
│   └── release.yml                       # docker image build + push
├── packages/
│   ├── shared/                           # shared types, constants, utils
│   │   └── src/
│   │       ├── types/                    # OTel log, trace, anomaly, alert types
│   │       ├── constants/                # severity levels, OCSF enums
│   │       └── utils/                    # W3C traceparent parser, RFC 5424 parser
│   ├── db/                               # database migrations and clients
│   │   └── src/
│   │       ├── postgres/                 # migrations, pool client, RLS setup
│   │       └── clickhouse/               # DDL scripts, client wrapper
│   └── test-utils/                       # shared test fixtures and factories
├── apps/
│   ├── api/                              # Fastify API server
│   │   └── src/
│   │       ├── server.ts                 # app bootstrap
│   │       ├── plugins/                  # auth, clickhouse, postgres plugins
│   │       ├── routes/                   # ingest, logs, traces, alerts, anomalies, services, admin, ai, deployments
│   │       ├── services/                 # ingestion, search, alert-evaluator, notification, redaction
│   │       └── workers/                  # alert-scheduler, graph-builder
│   ├── anomaly-engine/                   # Python ML microservice (FastAPI)
│   │   └── src/
│   │       ├── models/                   # logbert, statistical, manager
│   │       ├── pipeline/                 # Redis consumer, scorer
│   │       └── api/                      # health, predict endpoints
│   ├── web/                              # Next.js 15 frontend
│   │   └── src/app/
│   │       ├── (auth)/                   # login, callback
│   │       └── (dashboard)/              # logs, traces, alerts, anomalies, services, settings, cost
│   └── cli/                              # CLI for log shipping + admin
├── helm/logwatch/                        # Kubernetes Helm chart
└── docs/openapi.yaml                     # OpenAPI 3.2 specification
```

**Structure Decision**: Monorepo with pnpm workspaces. Four applications (api, anomaly-engine, web, cli) share types and database access via internal packages (shared, db, test-utils). This mirrors the SigNoz architecture: TypeScript for the API/UI layer, Python for ML workloads.

## Complexity Tracking

No constitution violations to justify — constitution is uncustomized.
