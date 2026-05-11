# Log Aggregation & Anomaly Detection — Phased Development Plan

> Project: 008-log-aggregation-anomaly-detection · Created: 2026-05-11
> Purpose: Provide sufficient detail for Claude Code (Opus) to implement each phase end-to-end.

---

## Technology Decisions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Primary Language | TypeScript (Node.js) | Broad ecosystem for HTTP APIs, OpenTelemetry SDK support, async I/O for high-throughput ingestion, single language across API and UI |
| API Framework | Fastify | Highest-throughput Node.js framework, native JSON schema validation, plugin architecture for modular ingestion endpoints |
| Telemetry Storage | ClickHouse (MergeTree engine) | 10-20x compression over PostgreSQL, millions of rows/second ingestion, sub-second analytical queries over billions of rows, TTL-based retention — the SigNoz-proven architecture for observability |
| Operational Storage | PostgreSQL 16+ | ACID transactions for config/auth/alerting, row-level security for multi-tenancy, foreign keys for referential integrity, mature ecosystem |
| Log Ingestion Protocol | OpenTelemetry (OTLP/gRPC + OTLP/HTTP) | CNCF graduated standard, vendor-neutral, unified logs/traces/metrics data model, 200+ collector integrations |
| Additional Ingestion | Fluent Bit, Syslog (RFC 5424/3164), HTTP JSON | Cover legacy systems (syslog), Kubernetes-native (Fluent Bit), and direct application integration (HTTP) |
| Full-Text Search | ClickHouse tokenbf_v1 index | Sub-second search over billions of log lines without Elasticsearch operational complexity; 99%+ granule filtering with small false-positive rate |
| Anomaly Detection ML | Python microservice (FastAPI) | Access to PyTorch/transformers ecosystem for LogBERT, scikit-learn for statistical models, FastAPI for internal gRPC/HTTP API |
| LLM Integration | Claude API (Anthropic) | Root-cause narrative generation, natural-language query translation, adaptive threshold explanation — prompt-cacheable for cost efficiency |
| Frontend | Next.js 15 (App Router) | Server components for dashboard SSR, React ecosystem for interactive log explorer and live tail, Tailwind CSS for rapid UI development |
| Charting | Recharts + custom canvas | Recharts for dashboard charts, custom HTML Canvas for log timeline/histogram (performance at 100K+ data points) |
| Message Queue | Redis Streams | Lightweight pub/sub for ingestion buffering, anomaly detection job queue, and alert evaluation — avoids Kafka operational overhead for initial scale |
| Authentication | OAuth 2.0 + OIDC (via next-auth) | Enterprise SSO requirement, supports Google/GitHub/SAML providers, JWT-based API authentication |
| Real-Time Transport | Server-Sent Events (SSE) | Live tail log streaming, alert notifications — simpler than WebSocket for unidirectional data, supports HTTP/2 multiplexing |
| Container Orchestration | Docker Compose (dev), Kubernetes Helm chart (prod) | Docker Compose for local development; Helm chart for production deployment with ClickHouse Operator |
| CI/CD | GitHub Actions | Native GitHub integration, matrix testing across Node.js and Python services, ClickHouse service container for integration tests |
| Package Manager | pnpm (monorepo with workspaces) | Faster installs than npm, strict dependency isolation, workspace protocol for shared packages |

### Project Structure

```
logwatch/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml                    # local dev: ClickHouse, PostgreSQL, Redis
├── docker-compose.prod.yml
├── .github/
│   └── workflows/
│       ├── ci.yml                        # lint, test, build
│       └── release.yml                   # docker image build + push
├── packages/
│   ├── shared/                           # shared types, constants, utils
│   │   ├── package.json
│   │   └── src/
│   │       ├── types/
│   │       │   ├── log-record.ts         # OTel log record types
│   │       │   ├── trace-span.ts         # OTel trace span types
│   │       │   ├── metric.ts             # Prometheus-compatible metric types
│   │       │   ├── anomaly.ts            # anomaly detection types
│   │       │   ├── alert.ts              # alert rule and event types
│   │       │   └── api.ts                # API request/response types
│   │       ├── constants/
│   │       │   ├── severity.ts           # OTel severity levels
│   │       │   └── ocsf.ts              # OCSF class/category enums
│   │       └── utils/
│   │           ├── trace-context.ts      # W3C traceparent parser
│   │           └── syslog.ts             # RFC 5424 parser
│   ├── db/                               # database migrations and client
│   │   ├── package.json
│   │   └── src/
│   │       ├── postgres/
│   │       │   ├── migrations/           # numbered SQL migration files
│   │       │   ├── client.ts             # pg connection pool + RLS setup
│   │       │   └── seed.ts               # development seed data
│   │       └── clickhouse/
│   │           ├── migrations/           # ClickHouse DDL scripts
│   │           └── client.ts             # ClickHouse client wrapper
│   └── test-utils/                       # shared test fixtures and helpers
│       ├── package.json
│       └── src/
│           ├── fixtures/                 # sample log records, traces, metrics
│           ├── factories.ts              # test data factories
│           └── setup.ts                  # test DB setup/teardown
├── apps/
│   ├── api/                              # Fastify API server
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── server.ts                 # Fastify app bootstrap
│   │       ├── plugins/
│   │       │   ├── auth.ts               # JWT verification + tenant context
│   │       │   ├── clickhouse.ts         # ClickHouse client plugin
│   │       │   └── postgres.ts           # PostgreSQL client plugin
│   │       ├── routes/
│   │       │   ├── ingest/               # OTLP, syslog, HTTP ingestion
│   │       │   ├── logs/                 # log search, live tail SSE
│   │       │   ├── traces/               # trace lookup, service map
│   │       │   ├── alerts/               # alert rule CRUD, alert events
│   │       │   ├── anomalies/            # anomaly list, feedback
│   │       │   ├── services/             # service registry
│   │       │   ├── admin/                # tenant, user, API key management
│   │       │   └── ai/                   # NL query, RCA reports
│   │       ├── services/                 # business logic
│   │       │   ├── ingestion.ts          # log parsing + ClickHouse insert
│   │       │   ├── search.ts             # ClickHouse query builder
│   │       │   ├── alert-evaluator.ts    # periodic alert rule evaluation
│   │       │   └── notification.ts       # Slack, PagerDuty, webhook delivery
│   │       └── workers/
│   │           ├── alert-scheduler.ts    # cron-based alert evaluation loop
│   │           └── graph-builder.ts      # service dependency discovery
│   ├── anomaly-engine/                   # Python ML microservice
│   │   ├── pyproject.toml
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── main.py                   # FastAPI app
│   │       ├── models/
│   │       │   ├── logbert.py            # LogBERT anomaly classifier
│   │       │   ├── statistical.py        # baseline + z-score detection
│   │       │   └── manager.py            # model lifecycle management
│   │       ├── pipeline/
│   │       │   ├── consumer.py           # Redis Streams consumer
│   │       │   └── scorer.py             # anomaly scoring pipeline
│   │       └── api/
│   │           ├── health.py
│   │           └── predict.py            # HTTP prediction endpoint
│   ├── web/                              # Next.js frontend
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       └── app/
│   │           ├── layout.tsx
│   │           ├── (auth)/               # login, callback
│   │           ├── (dashboard)/          # main app layout
│   │           │   ├── logs/             # log explorer + live tail
│   │           │   ├── traces/           # trace viewer + service map
│   │           │   ├── alerts/           # alert rule management
│   │           │   ├── anomalies/        # anomaly feed + detail
│   │           │   ├── services/         # service registry + topology
│   │           │   ├── settings/         # tenant config, users, API keys
│   │           │   └── cost/             # usage & cost dashboard
│   │           └── api/                  # Next.js API routes (auth proxy)
│   └── cli/                              # CLI for log shipping + admin
│       ├── package.json
│       └── src/
│           └── index.ts
├── helm/
│   └── logwatch/                         # Kubernetes Helm chart
│       ├── Chart.yaml
│       ├── values.yaml
│       └── templates/
└── docs/
    └── openapi.yaml                      # OpenAPI 3.2 specification
```

---

## Phase 1: Project Scaffolding & Data Layer

### Purpose

Establish the monorepo structure, database schemas, connection management, and migration tooling. This phase produces no user-facing functionality but creates the foundation that every subsequent phase depends on. The ClickHouse telemetry schema follows Data Model Suggestion 2 (Hybrid Columnar + Relational) and the PostgreSQL operational schema follows the same model. Both schemas align with the OpenTelemetry Logs Data Model, W3C Trace Context, and OCSF for security events.

### Tasks

#### 1.1 — Initialize pnpm Monorepo

**What**: Create the workspace root with pnpm configuration, shared TypeScript config, ESLint, and Prettier.

**Design**:

```typescript
// pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'

// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

Each workspace package extends `tsconfig.base.json` and adds its own `paths` and `references`. ESLint uses `@typescript-eslint/recommended` with `no-explicit-any` set to `error`. Prettier uses 2-space indent, single quotes, trailing commas.

**Testing**:
- **T1.1.1 — Workspace resolution**: `pnpm install` completes without errors; `pnpm -r exec pwd` lists all workspace packages. Expected: 6 packages listed.
- **T1.1.2 — TypeScript compilation**: `pnpm -r build` compiles all packages. Expected: zero errors, `dist/` directory created in each package.
- **T1.1.3 — Lint pass**: `pnpm -r lint` passes on all packages. Expected: zero warnings, zero errors.

---

#### 1.2 — Shared Types Package

**What**: Define TypeScript types for the entire platform, mirroring the OTLP data model and the chosen database schema.

**Design**:

```typescript
// packages/shared/src/types/log-record.ts

/** Maps 1:1 to ClickHouse otel_logs columns and OTLP LogRecord */
export interface LogRecord {
  id: string;                          // UUID
  tenantId: string;
  timestamp: bigint;                   // nanoseconds since epoch
  observedTimestamp: bigint;
  severityNumber: SeverityNumber;      // 1-24 per OTel spec
  severityText: SeverityText;
  body: string;
  traceId: string;                     // 32-char hex (W3C Trace Context)
  spanId: string;                      // 16-char hex
  traceFlags: number;
  resourceFingerprint: string;
  resourceAttributes: Record<string, string>;
  logAttributes: Record<string, string>;
  logAttributesNumber: Record<string, number>;
  logAttributesBool: Record<string, boolean>;
  sourceType: SourceType;
  anomalyScore: number;               // 0.0-1.0
  anomalyDetected: boolean;
}

export enum SeverityNumber {
  TRACE = 1, TRACE2 = 2, TRACE3 = 3, TRACE4 = 4,
  DEBUG = 5, DEBUG2 = 6, DEBUG3 = 7, DEBUG4 = 8,
  INFO = 9, INFO2 = 10, INFO3 = 11, INFO4 = 12,
  WARN = 13, WARN2 = 14, WARN3 = 15, WARN4 = 16,
  ERROR = 17, ERROR2 = 18, ERROR3 = 19, ERROR4 = 20,
  FATAL = 21, FATAL2 = 22, FATAL3 = 23, FATAL4 = 24,
}

export type SeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export type SourceType = 'otlp' | 'syslog' | 'http' | 'fluent_bit';

// packages/shared/src/types/trace-span.ts

export interface TraceSpan {
  tenantId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
  operationName: string;
  serviceName: string;
  spanKind: SpanKind;
  statusCode: SpanStatusCode;
  statusMessage: string;
  startTime: bigint;
  endTime: bigint;
  durationNs: bigint;
  resourceAttributes: Record<string, string>;
  spanAttributes: Record<string, string>;
  spanAttributesNumber: Record<string, number>;
  events: SpanEvent[];
}

export type SpanKind = 'CLIENT' | 'SERVER' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
export type SpanStatusCode = 'OK' | 'ERROR' | 'UNSET';

export interface SpanEvent {
  name: string;
  timestamp: bigint;
  attributes: Record<string, string>;
}

// packages/shared/src/types/anomaly.ts

export interface Anomaly {
  id: string;
  tenantId: string;
  serviceId: string | null;
  modelId: string | null;
  anomalyType: AnomalyType;
  severity: AlertSeverity;
  score: number;                       // 0.0-1.0
  title: string;
  description: string | null;
  detectedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  sampleLogIds: string[];
  relatedTraceIds: string[];
  status: AnomalyStatus;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  userFeedback: AnomalyFeedback | null;
}

export type AnomalyType = 'volume_spike' | 'novel_pattern' | 'error_rate' | 'latency';
export type AnomalyStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';
export type AnomalyFeedback = 'helpful' | 'not_helpful' | 'false_positive';
export type AlertSeverity = 'critical' | 'warning' | 'info';

// packages/shared/src/types/alert.ts

export interface AlertRule {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  ruleType: AlertRuleType;
  condition: AlertCondition;
  notificationChannelIds: string[];
  severity: AlertSeverity;
  evaluationIntervalSeconds: number;
  cooldownMinutes: number;
  lastEvaluatedAt: Date | null;
  lastFiredAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AlertRuleType = 'threshold' | 'anomaly' | 'log_pattern' | 'absence';

export interface AlertCondition {
  queryType: 'clickhouse';
  query: string;
  operator: '>' | '<' | '>=' | '<=' | '==' | '!=';
  threshold: number;
}

export interface NotificationChannel {
  id: string;
  tenantId: string;
  name: string;
  channelType: ChannelType;
  config: SlackConfig | PagerDutyConfig | WebhookConfig | EmailConfig;
  isVerified: boolean;
  createdAt: Date;
}

export type ChannelType = 'slack' | 'pagerduty' | 'email' | 'webhook';

export interface SlackConfig {
  webhookUrl: string;
  channel: string;
  mentionOnCritical?: string;
}

export interface PagerDutyConfig {
  integrationKey: string;
  severity: string;
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

export interface EmailConfig {
  recipients: string[];
  fromAddress?: string;
}
```

**Testing**:
- **T1.2.1 — Type compilation**: `tsc --noEmit` on the shared package produces zero errors.
- **T1.2.2 — Type import**: apps/api can import and use all types from `@logwatch/shared`. Expected: successful compilation.
- **T1.2.3 — Severity enum values**: Unit test asserting `SeverityNumber.ERROR === 17` and `SeverityNumber.FATAL === 21` per OTel spec.

---

#### 1.3 — Docker Compose Development Environment

**What**: Create a Docker Compose file that starts ClickHouse, PostgreSQL, and Redis for local development.

**Design**:

```yaml
# docker-compose.yml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.8
    ports:
      - "8123:8123"    # HTTP
      - "9000:9000"    # Native
    volumes:
      - clickhouse-data:/var/lib/clickhouse
    environment:
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: 1
    ulimits:
      nofile:
        soft: 262144
        hard: 262144

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: logwatch
      POSTGRES_PASSWORD: logwatch_dev
      POSTGRES_DB: logwatch
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru

volumes:
  clickhouse-data:
  postgres-data:
```

Configuration is read from environment variables with defaults for development:

```typescript
// packages/shared/src/config.ts

export interface AppConfig {
  clickhouse: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  postgres: {
    connectionString: string;
    poolMin: number;
    poolMax: number;
  };
  redis: {
    url: string;
  };
  server: {
    port: number;
    host: string;
  };
}

export function loadConfig(): AppConfig {
  return {
    clickhouse: {
      host: process.env.CLICKHOUSE_HOST ?? 'localhost',
      port: parseInt(process.env.CLICKHOUSE_PORT ?? '8123', 10),
      database: process.env.CLICKHOUSE_DB ?? 'logwatch',
      username: process.env.CLICKHOUSE_USER ?? 'default',
      password: process.env.CLICKHOUSE_PASSWORD ?? '',
    },
    postgres: {
      connectionString: process.env.DATABASE_URL ?? 'postgresql://logwatch:logwatch_dev@localhost:5432/logwatch',
      poolMin: parseInt(process.env.PG_POOL_MIN ?? '2', 10),
      poolMax: parseInt(process.env.PG_POOL_MAX ?? '10', 10),
    },
    redis: {
      url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    },
    server: {
      port: parseInt(process.env.PORT ?? '3001', 10),
      host: process.env.HOST ?? '0.0.0.0',
    },
  };
}
```

**Testing**:
- **T1.3.1 — Container startup**: `docker compose up -d` starts all three services; `docker compose ps` shows all healthy. Expected: 3 running containers.
- **T1.3.2 — ClickHouse connectivity**: `curl http://localhost:8123/?query=SELECT%201` returns `1`. Expected: HTTP 200.
- **T1.3.3 — PostgreSQL connectivity**: `psql -h localhost -U logwatch -d logwatch -c 'SELECT 1'` returns `1`. Expected: success.
- **T1.3.4 — Redis connectivity**: `redis-cli ping` returns `PONG`.

---

#### 1.4 — PostgreSQL Schema Migrations

**What**: Implement all PostgreSQL operational tables using a migration runner (node-pg-migrate).

**Design**:

The migration creates all PostgreSQL tables from Data Model Suggestion 2: tenants, users, api_keys, services, service_dependencies, anomaly_models, anomalies, anomaly_baselines, notification_channels, alert_rules, alert_events, rca_reports, nl_queries, ingest_usage, sampling_recommendations, and audit_log. Each table includes `tenant_id` with RLS policies.

```typescript
// packages/db/src/postgres/client.ts

import pg from 'pg';

export async function createPostgresPool(connectionString: string): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString,
    min: 2,
    max: 10,
  });

  // Verify connection
  const client = await pool.connect();
  await client.query('SELECT 1');
  client.release();

  return pool;
}

/** Set tenant context for RLS — call at the start of every request */
export async function setTenantContext(
  client: pg.PoolClient,
  tenantId: string
): Promise<void> {
  await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
}
```

Migration files follow the pattern `001_create_tenants.sql`, `002_create_users.sql`, etc. The SQL matches Data Model Suggestion 2's PostgreSQL schema exactly. RLS is enabled on every table with `tenant_id`.

**Testing**:
- **T1.4.1 — Migration up**: `pnpm db:migrate up` runs all migrations without errors against a clean PostgreSQL instance. Expected: all 16 tables created.
- **T1.4.2 — Migration down**: `pnpm db:migrate down` rolls back all migrations. Expected: all tables dropped.
- **T1.4.3 — RLS enforcement**: Insert a row into `users` with `tenant_id = 'A'`. Set `app.current_tenant = 'B'`. Query `users`. Expected: zero rows returned.
- **T1.4.4 — Foreign key integrity**: Attempt to insert an `alert_rule` with a non-existent `tenant_id`. Expected: foreign key violation error.
- **T1.4.5 — Idempotent migration**: Run `pnpm db:migrate up` twice. Expected: second run is a no-op, no errors.

---

#### 1.5 — ClickHouse Schema Migrations

**What**: Create ClickHouse tables for telemetry storage: otel_logs, otel_traces, metrics_time_series, metrics_samples, metrics_samples_1h (with materialized view), and security_events.

**Design**:

The ClickHouse DDL matches Data Model Suggestion 2 exactly. The migration runner is a simple script that executes SQL files in order using the ClickHouse HTTP interface.

```typescript
// packages/db/src/clickhouse/client.ts

import { createClient, ClickHouseClient } from '@clickhouse/client';

export async function createClickHouseClient(config: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}): Promise<ClickHouseClient> {
  const client = createClient({
    url: `http://${config.host}:${config.port}`,
    database: config.database,
    username: config.username,
    password: config.password,
    clickhouse_settings: {
      async_insert: 1,
      wait_for_async_insert: 0,        // fire-and-forget for high throughput
    },
  });

  // Verify and create database if needed
  await client.query({ query: `CREATE DATABASE IF NOT EXISTS ${config.database}` });

  return client;
}
```

ClickHouse migration files: `001_create_otel_logs.sql`, `002_create_otel_traces.sql`, `003_create_metrics.sql`, `004_create_security_events.sql`. Each file contains the `CREATE TABLE` DDL from Data Model Suggestion 2 with MergeTree engines, codecs, indexes, and TTL clauses.

**Testing**:
- **T1.5.1 — Table creation**: After migration, `SHOW TABLES FROM logwatch` returns 6 tables (otel_logs, otel_traces, metrics_time_series, metrics_samples, metrics_samples_1h, security_events). Expected: 6 rows.
- **T1.5.2 — TTL configuration**: `SELECT engine_full FROM system.tables WHERE name = 'otel_logs'` includes `TTL toDateTime(timestamp) + toIntervalDay(30)`. Expected: TTL clause present.
- **T1.5.3 — Token bloom filter index**: Insert 1000 log records with varied body text. Query with `hasToken(body, 'TimeoutError')`. Expected: correct results returned, bloom filter index used (verify via `EXPLAIN`).
- **T1.5.4 — Compression codecs**: Insert 10,000 log records. Verify via `SELECT compression_codec FROM system.columns WHERE table = 'otel_logs' AND name = 'body'` returns `ZSTD(3)`.

---

## Phase 2: Log Ingestion Pipeline

### Purpose

Build the core ingestion pipeline that receives log records via OTLP/HTTP, Syslog (RFC 5424), and plain HTTP JSON endpoints, normalizes them to the OpenTelemetry Logs Data Model, buffers them through Redis Streams, and batch-inserts them into ClickHouse. This is the foundational data path — every subsequent feature depends on logs being in ClickHouse.

### Tasks

#### 2.1 — Fastify API Server Bootstrap

**What**: Create the Fastify application with plugin architecture, health checks, graceful shutdown, and OpenAPI documentation.

**Design**:

```typescript
// apps/api/src/server.ts

import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import { loadConfig } from '@logwatch/shared';
import { clickhousePlugin } from './plugins/clickhouse';
import { postgresPlugin } from './plugins/postgres';
import { authPlugin } from './plugins/auth';

export async function buildServer() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty' }
        : undefined,
    },
    requestTimeout: 30_000,
    bodyLimit: 10_485_760,             // 10 MB for log batches
  });

  // OpenAPI 3.2 documentation
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'LogWatch API',
        version: '0.1.0',
        description: 'AI-native log aggregation and anomaly detection platform',
      },
      servers: [{ url: `http://localhost:${config.server.port}` }],
    },
  });
  await app.register(fastifySwaggerUI, { routePrefix: '/docs' });

  // Database plugins
  await app.register(clickhousePlugin, { config: config.clickhouse });
  await app.register(postgresPlugin, { config: config.postgres });
  await app.register(authPlugin);

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down gracefully`);
      await app.close();
      process.exit(0);
    });
  }

  return app;
}
```

**Testing**:
- **T2.1.1 — Server startup**: Server starts on configured port. `GET /health` returns `{ status: 'ok' }`. Expected: HTTP 200.
- **T2.1.2 — OpenAPI docs**: `GET /docs` returns Swagger UI HTML. Expected: HTTP 200 with HTML content.
- **T2.1.3 — Graceful shutdown**: Send SIGTERM while requests are in flight. Expected: in-flight requests complete, then server exits with code 0.
- **T2.1.4 — Body size limit**: Send a POST with 11 MB body. Expected: HTTP 413 Payload Too Large.

---

#### 2.2 — OTLP HTTP Log Ingestion Endpoint

**What**: Implement the `/v1/logs` endpoint that accepts OTLP ExportLogsServiceRequest payloads (JSON encoding), normalizes them to `LogRecord` types, and inserts into ClickHouse via batch insert.

**Design**:

```typescript
// apps/api/src/routes/ingest/otlp-logs.ts

import { FastifyPluginAsync } from 'fastify';
import { LogRecord, SeverityNumber } from '@logwatch/shared';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

/** OTLP ExportLogsServiceRequest JSON structure */
interface OtlpExportLogsRequest {
  resourceLogs: Array<{
    resource: {
      attributes: Array<{ key: string; value: OtlpAnyValue }>;
    };
    scopeLogs: Array<{
      logRecords: Array<{
        timeUnixNano: string;
        observedTimeUnixNano?: string;
        severityNumber?: number;
        severityText?: string;
        body?: OtlpAnyValue;
        attributes?: Array<{ key: string; value: OtlpAnyValue }>;
        traceId?: string;         // base64 or hex
        spanId?: string;
        flags?: number;
      }>;
    }>;
  }>;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

function flattenOtlpAttributes(
  attrs: Array<{ key: string; value: OtlpAnyValue }> | undefined
): { strings: Record<string, string>; numbers: Record<string, number>; bools: Record<string, boolean> } {
  const strings: Record<string, string> = {};
  const numbers: Record<string, number> = {};
  const bools: Record<string, boolean> = {};
  if (!attrs) return { strings, numbers, bools };
  for (const attr of attrs) {
    if (attr.value.stringValue !== undefined) strings[attr.key] = attr.value.stringValue;
    else if (attr.value.intValue !== undefined) numbers[attr.key] = parseInt(attr.value.intValue, 10);
    else if (attr.value.doubleValue !== undefined) numbers[attr.key] = attr.value.doubleValue;
    else if (attr.value.boolValue !== undefined) bools[attr.key] = attr.value.boolValue;
  }
  return { strings, numbers, bools };
}

function computeResourceFingerprint(attrs: Record<string, string>): string {
  const sorted = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

const otlpLogsRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: OtlpExportLogsRequest }>('/v1/logs', {
    schema: {
      description: 'OTLP log ingestion endpoint (JSON encoding)',
      tags: ['ingest'],
      response: { 200: { type: 'object', properties: { accepted: { type: 'number' } } } },
    },
  }, async (request, reply) => {
    const tenantId = request.tenantId;   // set by auth plugin
    const rows: LogRecord[] = [];

    for (const resourceLog of request.body.resourceLogs) {
      const resourceAttrs = flattenOtlpAttributes(resourceLog.resource.attributes);
      const fingerprint = computeResourceFingerprint(resourceAttrs.strings);

      for (const scopeLog of resourceLog.scopeLogs) {
        for (const lr of scopeLog.logRecords) {
          rows.push({
            id: randomUUID(),
            tenantId,
            timestamp: BigInt(lr.timeUnixNano),
            observedTimestamp: BigInt(lr.observedTimeUnixNano ?? lr.timeUnixNano),
            severityNumber: (lr.severityNumber ?? SeverityNumber.INFO) as SeverityNumber,
            severityText: (lr.severityText ?? 'INFO') as any,
            body: lr.body?.stringValue ?? '',
            traceId: lr.traceId ?? '',
            spanId: lr.spanId ?? '',
            traceFlags: lr.flags ?? 0,
            resourceFingerprint: fingerprint,
            resourceAttributes: resourceAttrs.strings,
            logAttributes: flattenOtlpAttributes(lr.attributes).strings,
            logAttributesNumber: flattenOtlpAttributes(lr.attributes).numbers,
            logAttributesBool: flattenOtlpAttributes(lr.attributes).bools,
            sourceType: 'otlp',
            anomalyScore: 0,
            anomalyDetected: false,
          });
        }
      }
    }

    await app.clickhouse.insertLogRecords(rows);

    return { accepted: rows.length };
  });
};

export default otlpLogsRoute;
```

The ClickHouse insert uses the `@clickhouse/client` `insert` method with `async_insert=1` for buffered high-throughput writes:

```typescript
// apps/api/src/services/ingestion.ts

export async function insertLogRecords(
  client: ClickHouseClient,
  records: LogRecord[]
): Promise<void> {
  await client.insert({
    table: 'otel_logs',
    values: records.map(r => ({
      timestamp: Number(r.timestamp) / 1e9,  // convert ns to seconds for DateTime64(9)
      observed_timestamp: Number(r.observedTimestamp) / 1e9,
      id: r.id,
      tenant_id: r.tenantId,
      trace_id: r.traceId,
      span_id: r.spanId,
      trace_flags: r.traceFlags,
      severity_text: r.severityText,
      severity_number: r.severityNumber,
      body: r.body,
      resource_fingerprint: r.resourceFingerprint,
      resource_string: r.resourceAttributes,
      attributes_string: r.logAttributes,
      attributes_number: r.logAttributesNumber,
      attributes_bool: r.logAttributesBool,
      source_type: r.sourceType,
      anomaly_score: r.anomalyScore,
      anomaly_detected: r.anomalyDetected,
      syslog_facility: 0,
      syslog_hostname: '',
      syslog_app_name: '',
    })),
    format: 'JSONEachRow',
  });
}
```

**Testing**:
- **T2.2.1 — OTLP ingestion**: POST a valid OTLP ExportLogsServiceRequest with 100 log records. Expected: HTTP 200, `{ accepted: 100 }`, and 100 rows queryable in ClickHouse.
- **T2.2.2 — Resource fingerprint stability**: Send two batches with identical resource attributes. Expected: both batches produce the same `resource_fingerprint` value.
- **T2.2.3 — Severity mapping**: Send log records with `severityNumber: 17`. Expected: stored as `severity_number = 17`, `severity_text = 'ERROR'`.
- **T2.2.4 — Trace context preservation**: Send a log record with `traceId: '0af7651916cd43dd8448eb211c80319c'` and `spanId: '00f067aa0ba902b7'`. Expected: queryable in ClickHouse by trace_id.
- **T2.2.5 — Empty body handling**: Send a log record with no `body` field. Expected: stored with empty string body, no error.
- **T2.2.6 — Large batch**: Send 10,000 log records in a single request. Expected: HTTP 200, all records inserted.

---

#### 2.3 — Syslog Ingestion Endpoint (RFC 5424)

**What**: Implement a UDP/TCP syslog receiver that parses RFC 5424 (and RFC 3164 fallback) messages and inserts them as log records.

**Design**:

```typescript
// packages/shared/src/utils/syslog.ts

/** Parsed RFC 5424 syslog message */
export interface SyslogMessage {
  facility: number;           // 0-23
  severity: number;           // 0-7 (syslog severity, NOT OTel severity)
  timestamp: Date;
  hostname: string;
  appName: string;
  procId: string;
  msgId: string;
  structuredData: Record<string, Record<string, string>>;
  message: string;
}

/**
 * Maps syslog severity (0=Emergency, 7=Debug) to OTel SeverityNumber.
 * RFC 5424 severity is inverse of OTel: lower number = higher severity.
 */
export function syslogSeverityToOtel(syslogSeverity: number): SeverityNumber {
  const mapping: Record<number, SeverityNumber> = {
    0: SeverityNumber.FATAL,   // Emergency
    1: SeverityNumber.FATAL,   // Alert
    2: SeverityNumber.ERROR4,  // Critical
    3: SeverityNumber.ERROR,   // Error
    4: SeverityNumber.WARN,    // Warning
    5: SeverityNumber.INFO,    // Notice
    6: SeverityNumber.INFO,    // Informational
    7: SeverityNumber.DEBUG,   // Debug
  };
  return mapping[syslogSeverity] ?? SeverityNumber.INFO;
}

/** Parse RFC 5424 syslog message. Falls back to RFC 3164 parsing. */
export function parseSyslog(raw: string): SyslogMessage {
  // RFC 5424: <PRI>VERSION SP TIMESTAMP SP HOSTNAME SP APP-NAME SP PROCID SP MSGID SP STRUCTURED-DATA SP MSG
  const rfc5424Regex = /^<(\d+)>(\d+) (\S+) (\S+) (\S+) (\S+) (\S+) ((?:\[.+?\])*|-) ?(.*)$/s;
  const match = raw.match(rfc5424Regex);
  if (match) {
    const pri = parseInt(match[1], 10);
    return {
      facility: Math.floor(pri / 8),
      severity: pri % 8,
      timestamp: new Date(match[3]),
      hostname: match[4] === '-' ? '' : match[4],
      appName: match[5] === '-' ? '' : match[5],
      procId: match[6] === '-' ? '' : match[6],
      msgId: match[7] === '-' ? '' : match[7],
      structuredData: parseStructuredData(match[8]),
      message: match[9] ?? '',
    };
  }
  // Fallback: RFC 3164 parsing
  return parseRfc3164(raw);
}
```

The syslog endpoint listens on UDP 1514 and TCP 1514 (configurable), parses each message, converts to `LogRecord`, and inserts into ClickHouse. The `syslog_facility`, `syslog_hostname`, and `syslog_app_name` columns in ClickHouse are populated.

**Testing**:
- **T2.3.1 — RFC 5424 parsing**: Parse `<165>1 2026-05-11T14:30:00.000Z myhost myapp 1234 ID47 - This is a test`. Expected: facility=20, severity=5, appName='myapp', message='This is a test'.
- **T2.3.2 — Severity mapping**: Syslog severity 3 (Error) maps to OTel SeverityNumber.ERROR (17). Expected: correct mapping for all 8 levels.
- **T2.3.3 — RFC 3164 fallback**: Parse `<34>Oct 11 22:14:15 mymachine su: 'su root' failed`. Expected: successful parse with facility=4, severity=2.
- **T2.3.4 — UDP reception**: Send a syslog message via UDP to port 1514. Expected: message appears in ClickHouse within 5 seconds.
- **T2.3.5 — Structured data extraction**: Parse message with `[exampleSDID@32473 iut="3" eventSource="Application"]`. Expected: `structuredData` contains the key-value pairs.

---

#### 2.4 — HTTP JSON Ingestion Endpoint

**What**: Implement a simple `/v1/ingest` endpoint that accepts JSON log records directly from applications that cannot use OTLP or syslog.

**Design**:

```typescript
// apps/api/src/routes/ingest/http-json.ts

interface HttpLogRecord {
  timestamp?: string;          // ISO 8601
  level?: string;              // debug, info, warn, error, fatal
  message: string;
  service?: string;
  traceId?: string;
  spanId?: string;
  attributes?: Record<string, string | number | boolean>;
}

interface HttpIngestRequest {
  logs: HttpLogRecord[];
}

// POST /v1/ingest
// Content-Type: application/json
// Authorization: Bearer <api_key>
// Body: { "logs": [{ "message": "...", "level": "error", ... }] }
```

The endpoint normalizes `level` strings to OTel `SeverityNumber`, generates timestamps for records that omit them, and populates `source_type = 'http'`.

**Testing**:
- **T2.4.1 — Basic ingestion**: POST `{ "logs": [{ "message": "Hello world", "level": "info" }] }`. Expected: HTTP 200, record in ClickHouse with severity_number=9.
- **T2.4.2 — Batch ingestion**: POST 500 log records. Expected: all 500 stored.
- **T2.4.3 — Missing timestamp**: POST a log record without `timestamp`. Expected: `observed_timestamp` is set to server receipt time.
- **T2.4.4 — Level normalization**: POST with `level: "warning"`. Expected: maps to `severity_text: 'WARN'`, `severity_number: 13`.
- **T2.4.5 — Invalid JSON**: POST malformed JSON. Expected: HTTP 400 with descriptive error message.

---

#### 2.5 — Ingestion Buffering via Redis Streams

**What**: Add a Redis Streams buffer between ingestion endpoints and ClickHouse to handle burst traffic and provide backpressure.

**Design**:

```typescript
// apps/api/src/services/ingestion-buffer.ts

import { Redis } from 'ioredis';
import { LogRecord } from '@logwatch/shared';

const STREAM_KEY = 'logwatch:ingest:logs';
const CONSUMER_GROUP = 'clickhouse-writers';
const BATCH_SIZE = 5000;
const FLUSH_INTERVAL_MS = 1000;

export class IngestionBuffer {
  private redis: Redis;
  private batch: LogRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
  }

  /** Enqueue log records for async ClickHouse insertion */
  async enqueue(records: LogRecord[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const record of records) {
      pipeline.xadd(STREAM_KEY, '*',
        'data', JSON.stringify(record)
      );
    }
    await pipeline.exec();
  }

  /** Start consuming from Redis Streams and batch-inserting into ClickHouse */
  async startConsumer(insertFn: (records: LogRecord[]) => Promise<void>): Promise<void> {
    // Create consumer group if it doesn't exist
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
    } catch {
      // Group already exists
    }

    const consumerId = `writer-${process.pid}`;
    const consume = async () => {
      const results = await this.redis.xreadgroup(
        'GROUP', CONSUMER_GROUP, consumerId,
        'COUNT', BATCH_SIZE.toString(),
        'BLOCK', FLUSH_INTERVAL_MS.toString(),
        'STREAMS', STREAM_KEY, '>'
      );

      if (results && results.length > 0) {
        const records: LogRecord[] = [];
        const messageIds: string[] = [];
        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            messageIds.push(id);
            records.push(JSON.parse(fields[1]) as LogRecord);
          }
        }
        if (records.length > 0) {
          await insertFn(records);
          // Acknowledge processed messages
          await this.redis.xack(STREAM_KEY, CONSUMER_GROUP, ...messageIds);
        }
      }

      // Continue consuming
      setImmediate(consume);
    };

    consume();
  }
}
```

When the ingestion buffer is enabled, the HTTP endpoints enqueue to Redis Streams instead of inserting directly into ClickHouse. A background consumer drains the stream in batches of 5,000 records (or every 1 second, whichever comes first) and performs ClickHouse batch inserts.

**Testing**:
- **T2.5.1 — Buffered ingestion**: Enqueue 10,000 records. Expected: all records appear in ClickHouse within 5 seconds.
- **T2.5.2 — Batch coalescence**: Enqueue 100 records rapidly. Expected: they are inserted in a single ClickHouse batch (verifiable via ClickHouse query log).
- **T2.5.3 — Consumer recovery**: Kill the consumer process mid-batch. Restart it. Expected: unacknowledged messages are reprocessed; no data loss.
- **T2.5.4 — Backpressure**: Fill Redis to near `maxmemory`. Expected: ingestion endpoint returns HTTP 503 Service Unavailable.

---

## Phase 3: Log Search & Live Tail

### Purpose

Deliver the primary user-facing value: searching logs with sub-second response and streaming live logs in real time. This phase builds the query engine over ClickHouse, the log search API, and the SSE-based live tail endpoint.

### Tasks

#### 3.1 — Log Search Query Builder

**What**: Build a query builder that translates structured search parameters into optimized ClickHouse SQL.

**Design**:

```typescript
// apps/api/src/services/search.ts

export interface LogSearchParams {
  tenantId: string;
  query?: string;                      // full-text search term
  severityMin?: SeverityNumber;
  severityMax?: SeverityNumber;
  serviceNames?: string[];
  traceId?: string;
  timeStart: Date;                     // required
  timeEnd: Date;                       // required
  attributes?: Record<string, string>; // key=value filters on log_attributes
  limit?: number;                      // default 100, max 10000
  offset?: number;
  sortOrder?: 'asc' | 'desc';         // default 'desc'
}

export interface LogSearchResult {
  records: LogRecord[];
  totalCount: number;
  executionTimeMs: number;
}

export function buildLogSearchQuery(params: LogSearchParams): {
  query: string;
  params: Record<string, unknown>;
} {
  const conditions: string[] = [
    `tenant_id = {tenantId:String}`,
    `timestamp >= {timeStart:DateTime64(9)}`,
    `timestamp <= {timeEnd:DateTime64(9)}`,
  ];

  const queryParams: Record<string, unknown> = {
    tenantId: params.tenantId,
    timeStart: params.timeStart.toISOString(),
    timeEnd: params.timeEnd.toISOString(),
  };

  if (params.query) {
    // Use hasToken for token-level search (uses tokenbf_v1 index)
    conditions.push(`hasToken(body, {searchQuery:String})`);
    queryParams.searchQuery = params.query;
  }

  if (params.severityMin !== undefined) {
    conditions.push(`severity_number >= {sevMin:UInt8}`);
    queryParams.sevMin = params.severityMin;
  }

  if (params.severityMax !== undefined) {
    conditions.push(`severity_number <= {sevMax:UInt8}`);
    queryParams.sevMax = params.severityMax;
  }

  if (params.serviceNames?.length) {
    conditions.push(`resource_string['service.name'] IN {serviceNames:Array(String)}`);
    queryParams.serviceNames = params.serviceNames;
  }

  if (params.traceId) {
    conditions.push(`trace_id = {traceId:String}`);
    queryParams.traceId = params.traceId;
  }

  if (params.attributes) {
    for (const [key, value] of Object.entries(params.attributes)) {
      const paramKey = `attr_${key.replace(/\./g, '_')}`;
      conditions.push(`attributes_string[{${paramKey}_key:String}] = {${paramKey}_val:String}`);
      queryParams[`${paramKey}_key`] = key;
      queryParams[`${paramKey}_val`] = value;
    }
  }

  const limit = Math.min(params.limit ?? 100, 10000);
  const offset = params.offset ?? 0;
  const order = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const query = `
    SELECT *
    FROM otel_logs
    WHERE ${conditions.join('\n      AND ')}
    ORDER BY timestamp ${order}
    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return { query, params: queryParams };
}
```

**Testing**:
- **T3.1.1 — Full-text search**: Insert 1000 logs, 10 containing "TimeoutError". Search for "TimeoutError". Expected: exactly 10 results.
- **T3.1.2 — Severity filter**: Insert logs at DEBUG, INFO, WARN, ERROR. Search with `severityMin: ERROR`. Expected: only ERROR and FATAL logs returned.
- **T3.1.3 — Service name filter**: Insert logs from services A, B, C. Search with `serviceNames: ['A']`. Expected: only service A logs.
- **T3.1.4 — Time range**: Insert logs spanning 24 hours. Search last 1 hour. Expected: only logs from the last hour.
- **T3.1.5 — Trace ID lookup**: Insert 50 logs with the same trace_id. Search by that trace_id. Expected: all 50 logs returned.
- **T3.1.6 — Attribute filter**: Insert logs with `http.status_code: '500'`. Filter by that attribute. Expected: only matching logs.
- **T3.1.7 — Pagination**: Insert 250 logs. Search with limit=100, offset=0, then offset=100, then offset=200. Expected: 100, 100, 50 results respectively.
- **T3.1.8 — Performance**: Insert 1M log records. Full-text search returns within 500ms. Expected: < 500ms.

---

#### 3.2 — Log Search REST API

**What**: Expose the log search query builder as a REST endpoint with pagination, facets, and histogram data.

**Design**:

```typescript
// GET /api/v1/logs/search
// Query params: q, severityMin, severityMax, services, traceId,
//               timeStart, timeEnd, limit, offset, sortOrder

// Response:
interface LogSearchApiResponse {
  data: LogRecord[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  histogram: Array<{
    bucket: string;           // ISO 8601 timestamp (bucket start)
    count: number;
    errorCount: number;
  }>;
  facets: {
    services: Array<{ name: string; count: number }>;
    severities: Array<{ level: string; count: number }>;
  };
  executionTimeMs: number;
}
```

The histogram is computed via a separate ClickHouse query using `toStartOfInterval(timestamp, INTERVAL {bucketSize} SECOND)` to create time buckets. Bucket size is auto-calculated based on the time range (1 min for < 1 hour, 5 min for < 6 hours, 1 hour for < 7 days).

**Testing**:
- **T3.2.1 — Search endpoint**: `GET /api/v1/logs/search?q=error&timeStart=...&timeEnd=...`. Expected: HTTP 200 with matching logs.
- **T3.2.2 — Histogram**: Response includes histogram with correct bucket counts. Expected: bucket counts sum to total.
- **T3.2.3 — Facets**: Response includes service names and severity counts. Expected: counts match actual data.
- **T3.2.4 — Empty results**: Search for a term that doesn't exist. Expected: HTTP 200 with empty `data` array, `total: 0`.
- **T3.2.5 — Invalid time range**: timeEnd before timeStart. Expected: HTTP 400 with validation error.

---

#### 3.3 — Live Tail via Server-Sent Events

**What**: Implement a `/api/v1/logs/tail` SSE endpoint that streams new log records matching a filter in real time.

**Design**:

```typescript
// apps/api/src/routes/logs/tail.ts

// GET /api/v1/logs/tail?services=payment-service&severityMin=13
// Accept: text/event-stream
//
// Response (SSE stream):
// data: {"id":"...","timestamp":"...","body":"...","severityText":"WARN",...}
//
// data: {"id":"...","timestamp":"...","body":"...","severityText":"ERROR",...}

/** 
 * Implementation: Poll ClickHouse every 1 second for new records 
 * where timestamp > lastSeen. The poll query uses the same query 
 * builder as search but with a sliding time window.
 * 
 * For high-volume streams, the poll is throttled to emit at most 
 * 100 records per second to avoid overwhelming the client.
 */
export async function handleLiveTail(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let lastTimestamp = new Date();
  let isActive = true;

  request.raw.on('close', () => { isActive = false; });

  while (isActive) {
    const now = new Date();
    const results = await queryNewLogs(
      request.tenantId,
      lastTimestamp,
      now,
      request.query as LiveTailFilters,
      100  // max records per poll
    );

    for (const record of results) {
      reply.raw.write(`data: ${JSON.stringify(record)}\n\n`);
    }

    if (results.length > 0) {
      lastTimestamp = new Date(Math.max(...results.map(r => new Date(r.timestamp).getTime())));
    }

    await sleep(1000);
  }

  reply.raw.end();
}
```

**Testing**:
- **T3.3.1 — SSE connection**: Open SSE connection to `/api/v1/logs/tail`. Expected: HTTP 200 with `Content-Type: text/event-stream`.
- **T3.3.2 — Real-time delivery**: Open tail, then ingest a log record. Expected: log appears in the SSE stream within 2 seconds.
- **T3.3.3 — Filter application**: Tail with `services=payment-service`. Ingest logs for payment-service and auth-service. Expected: only payment-service logs streamed.
- **T3.3.4 — Connection cleanup**: Close SSE client. Expected: server-side polling stops, no resource leak.
- **T3.3.5 — Throttling**: Ingest 500 logs/second. Expected: tail streams at most 100/second (throttled).

---

## Phase 4: Authentication, Multi-Tenancy & Alert Rules

### Purpose

Secure the platform with OAuth 2.0 / OIDC authentication, enforce tenant isolation via PostgreSQL RLS, and implement alert rule CRUD with notification channel management. This phase makes the platform production-ready for multi-team usage.

### Tasks

#### 4.1 — Authentication & Authorization

**What**: Implement JWT-based authentication supporting API keys (for ingestion) and OAuth 2.0 / OIDC (for UI users).

**Design**:

```typescript
// apps/api/src/plugins/auth.ts

import fp from 'fastify-plugin';
import { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    userId: string | null;
    userRole: 'admin' | 'editor' | 'viewer';
  }
}

export interface JwtPayload {
  sub: string;            // user ID
  tid: string;            // tenant ID
  role: string;
  iat: number;
  exp: number;
}

/**
 * Auth strategy:
 * 1. API key (Bearer lw_xxxx...): hash the key, look up in api_keys table.
 *    Set tenantId from the api_key record. Scopes determine allowed operations.
 * 2. JWT (Bearer eyJ...): verify signature, extract tenantId and userId.
 *    Used by the web frontend after OIDC login.
 * 3. Ingestion endpoints accept API keys only (no user context needed).
 * 4. Admin/config endpoints require JWT with admin role.
 */
async function authenticate(request: FastifyRequest): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw { statusCode: 401, message: 'Missing authorization header' };
  }

  const token = authHeader.slice(7);

  if (token.startsWith('lw_')) {
    // API key authentication
    const keyHash = hashApiKey(token);
    const apiKey = await lookupApiKey(request.server.pg, keyHash);
    if (!apiKey) throw { statusCode: 401, message: 'Invalid API key' };
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw { statusCode: 401, message: 'API key expired' };
    }
    request.tenantId = apiKey.tenantId;
    request.userId = null;
    request.userRole = 'editor';  // API keys get editor role
  } else {
    // JWT authentication
    const payload = verifyJwt(token) as JwtPayload;
    request.tenantId = payload.tid;
    request.userId = payload.sub;
    request.userRole = payload.role as any;
  }
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
```

Role-based access control rules:
- `viewer`: read logs, traces, anomalies, alerts
- `editor`: viewer + create/update alert rules, notification channels, resolve anomalies
- `admin`: editor + manage users, API keys, tenant settings, retention policies

**Testing**:
- **T4.1.1 — API key auth**: Create API key, call ingestion endpoint with it. Expected: HTTP 200, tenant context set correctly.
- **T4.1.2 — Expired API key**: Use an expired API key. Expected: HTTP 401, `API key expired`.
- **T4.1.3 — JWT auth**: Generate valid JWT, call search endpoint. Expected: HTTP 200, correct tenant and user context.
- **T4.1.4 — Invalid JWT**: Send a tampered JWT. Expected: HTTP 401.
- **T4.1.5 — Role enforcement**: Viewer tries to create an alert rule. Expected: HTTP 403 Forbidden.
- **T4.1.6 — Tenant isolation**: User in tenant A queries logs. Expected: only tenant A logs returned (RLS enforced).
- **T4.1.7 — Missing auth header**: Call endpoint without Authorization header. Expected: HTTP 401.

---

#### 4.2 — Alert Rule CRUD

**What**: Implement REST endpoints for creating, reading, updating, and deleting alert rules and notification channels.

**Design**:

```typescript
// POST /api/v1/alerts/rules
interface CreateAlertRuleRequest {
  name: string;
  description?: string;
  ruleType: AlertRuleType;
  condition: AlertCondition;
  notificationChannelIds: string[];
  severity: AlertSeverity;
  evaluationIntervalSeconds?: number;   // default: 60
  cooldownMinutes?: number;             // default: 15
}

// GET /api/v1/alerts/rules
// GET /api/v1/alerts/rules/:id
// PUT /api/v1/alerts/rules/:id
// DELETE /api/v1/alerts/rules/:id

// POST /api/v1/alerts/channels
interface CreateNotificationChannelRequest {
  name: string;
  channelType: ChannelType;
  config: SlackConfig | PagerDutyConfig | WebhookConfig | EmailConfig;
}

// GET /api/v1/alerts/channels
// PUT /api/v1/alerts/channels/:id
// DELETE /api/v1/alerts/channels/:id

// GET /api/v1/alerts/events — list alert firing/resolution events
```

All mutations are recorded in the `audit_log` table per ISO 27001 Annex A 8.15.

**Testing**:
- **T4.2.1 — Create alert rule**: POST a valid alert rule. Expected: HTTP 201, rule stored in PostgreSQL with UUID.
- **T4.2.2 — List alert rules**: Create 5 rules, GET list. Expected: 5 rules returned, ordered by creation date.
- **T4.2.3 — Update alert rule**: Change threshold from 0.05 to 0.10. Expected: HTTP 200, updated value persisted.
- **T4.2.4 — Delete alert rule**: DELETE a rule. Expected: HTTP 204, rule no longer in list.
- **T4.2.5 — Tenant isolation**: Tenant A creates a rule. Tenant B lists rules. Expected: tenant B sees zero rules.
- **T4.2.6 — Audit trail**: Create and update a rule. Query `audit_log`. Expected: 2 audit entries with correct action, actor, and changes.
- **T4.2.7 — Create notification channel**: POST a Slack channel config. Expected: HTTP 201, channel created.
- **T4.2.8 — Validation**: Create alert rule with invalid condition (missing threshold). Expected: HTTP 400 with validation errors.

---

#### 4.3 — Alert Evaluation Scheduler

**What**: Build a background worker that periodically evaluates alert rules against ClickHouse data and fires alerts when conditions are met.

**Design**:

```typescript
// apps/api/src/workers/alert-scheduler.ts

export class AlertScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;

  /**
   * Main loop: every 15 seconds, fetch all enabled alert rules
   * due for evaluation, execute their ClickHouse queries, and
   * fire alerts when thresholds are breached.
   */
  async start(): Promise<void> {
    this.intervalHandle = setInterval(() => this.evaluateRules(), 15_000);
  }

  private async evaluateRules(): Promise<void> {
    const rules = await this.getEvaluatableRules();

    for (const rule of rules) {
      try {
        const value = await this.executeRuleQuery(rule);
        const shouldFire = this.evaluateCondition(value, rule.condition);

        if (shouldFire && !this.isInCooldown(rule)) {
          await this.fireAlert(rule, value);
        } else if (!shouldFire && this.hasActiveAlert(rule)) {
          await this.resolveAlert(rule);
        }

        await this.updateLastEvaluated(rule.id);
      } catch (error) {
        this.logger.error({ ruleId: rule.id, error }, 'Alert evaluation failed');
      }
    }
  }

  private async fireAlert(rule: AlertRule, currentValue: number): Promise<void> {
    // 1. Create alert_event record in PostgreSQL
    const alertEvent = await this.createAlertEvent(rule);
    // 2. Send notifications to all configured channels
    for (const channelId of rule.notificationChannelIds) {
      await this.notificationService.send(channelId, {
        alertRule: rule,
        currentValue,
        firedAt: new Date(),
      });
    }
  }
}
```

**Testing**:
- **T4.3.1 — Threshold breach**: Create rule "error count > 10 in 5 min". Insert 15 error logs. Expected: alert fires within 30 seconds.
- **T4.3.2 — No breach**: Same rule, insert 5 error logs. Expected: no alert fires.
- **T4.3.3 — Cooldown**: Alert fires. Insert more errors immediately. Expected: no duplicate alert within cooldown period.
- **T4.3.4 — Resolution**: Alert fires, then error count drops below threshold. Expected: alert_event status changes to 'resolved'.
- **T4.3.5 — Disabled rule**: Disable a rule. Insert triggering data. Expected: no alert fires.

---

#### 4.4 — Notification Delivery (Slack, PagerDuty, Webhook)

**What**: Implement notification delivery to Slack (incoming webhook), PagerDuty (Events API v2), and generic webhooks.

**Design**:

```typescript
// apps/api/src/services/notification.ts

export interface NotificationPayload {
  alertRule: AlertRule;
  currentValue: number;
  firedAt: Date;
  anomaly?: Anomaly;
}

export class NotificationService {
  async send(channelId: string, payload: NotificationPayload): Promise<void> {
    const channel = await this.getChannel(channelId);

    switch (channel.channelType) {
      case 'slack':
        await this.sendSlack(channel.config as SlackConfig, payload);
        break;
      case 'pagerduty':
        await this.sendPagerDuty(channel.config as PagerDutyConfig, payload);
        break;
      case 'webhook':
        await this.sendWebhook(channel.config as WebhookConfig, payload);
        break;
      case 'email':
        await this.sendEmail(channel.config as EmailConfig, payload);
        break;
    }
  }

  private async sendSlack(config: SlackConfig, payload: NotificationPayload): Promise<void> {
    const message = {
      channel: config.channel,
      text: `Alert: ${payload.alertRule.name}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*:rotating_light: ${payload.alertRule.severity.toUpperCase()}: ${payload.alertRule.name}*\n` +
              `Current value: \`${payload.currentValue}\`\n` +
              `Fired at: ${payload.firedAt.toISOString()}`,
          },
        },
      ],
    };

    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
  }

  private async sendPagerDuty(config: PagerDutyConfig, payload: NotificationPayload): Promise<void> {
    await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: config.integrationKey,
        event_action: 'trigger',
        payload: {
          summary: `${payload.alertRule.name}: ${payload.currentValue}`,
          severity: payload.alertRule.severity,
          source: 'logwatch',
          timestamp: payload.firedAt.toISOString(),
        },
      }),
    });
  }
}
```

**Testing**:
- **T4.4.1 — Slack delivery**: Configure Slack webhook (mock server). Fire alert. Expected: mock receives POST with correct message format.
- **T4.4.2 — PagerDuty delivery**: Configure PagerDuty integration (mock). Fire alert. Expected: mock receives Events API v2 payload.
- **T4.4.3 — Webhook delivery**: Configure generic webhook. Fire alert. Expected: webhook receives POST with alert details.
- **T4.4.4 — Delivery failure retry**: Slack webhook returns 500. Expected: notification_results records the failure; system retries up to 3 times.
- **T4.4.5 — Alert event record**: After notification delivery, `alert_events.notification_results` contains delivery status.

---

## Phase 5: Anomaly Detection Engine

### Purpose

Build the AI-powered anomaly detection pipeline that distinguishes novel error patterns from known noise — the platform's primary differentiator. This phase implements statistical baseline detection and a LogBERT-based semantic classifier as a Python microservice, with results flowing back into ClickHouse.

### Tasks

#### 5.1 — Statistical Baseline Detection

**What**: Build a statistical anomaly detection module that learns per-service baselines for error rate, log volume, and latency, then detects deviations accounting for time-of-day and day-of-week patterns.

**Design**:

```python
# apps/anomaly-engine/src/models/statistical.py

from dataclasses import dataclass
import numpy as np
from datetime import datetime

@dataclass
class ServiceBaseline:
    service_name: str
    metric_name: str           # 'error_rate', 'log_volume', 'p99_latency'
    mean: float
    stddev: float
    p50: float
    p95: float
    p99: float
    hourly_pattern: list[float]   # 24 elements: multiplier for each hour
    dow_pattern: list[float]      # 7 elements: multiplier for Mon-Sun
    sample_count: int

@dataclass
class AnomalyResult:
    is_anomaly: bool
    score: float               # 0.0-1.0
    anomaly_type: str          # 'volume_spike', 'error_rate', 'latency'
    current_value: float
    expected_value: float
    z_score: float
    explanation: str

class StatisticalDetector:
    """
    Z-score based anomaly detection with time-of-day and day-of-week
    pattern adjustment. A value is anomalous if its adjusted z-score
    exceeds the configured threshold (default: 3.0).
    """

    def __init__(self, z_threshold: float = 3.0):
        self.z_threshold = z_threshold

    def detect(
        self,
        baseline: ServiceBaseline,
        current_value: float,
        at_time: datetime,
    ) -> AnomalyResult:
        hour = at_time.hour
        dow = at_time.weekday()  # 0=Monday

        # Adjust expected value for time-of-day and day-of-week patterns
        hourly_mult = baseline.hourly_pattern[hour] if baseline.hourly_pattern else 1.0
        dow_mult = baseline.dow_pattern[dow] if baseline.dow_pattern else 1.0
        expected = baseline.mean * hourly_mult * dow_mult
        adjusted_stddev = baseline.stddev * hourly_mult * dow_mult

        if adjusted_stddev == 0:
            z_score = 0.0
        else:
            z_score = (current_value - expected) / adjusted_stddev

        # Convert z-score to 0-1 probability using sigmoid
        score = 1.0 / (1.0 + np.exp(-abs(z_score) + self.z_threshold))
        is_anomaly = abs(z_score) > self.z_threshold

        explanation = (
            f"Current {baseline.metric_name} is {current_value:.2f}, "
            f"expected {expected:.2f} (adjusted for {at_time.strftime('%A %H:%M')}). "
            f"Z-score: {z_score:.2f} (threshold: {self.z_threshold})."
        )

        return AnomalyResult(
            is_anomaly=is_anomaly,
            score=min(score, 1.0),
            anomaly_type=self._classify_type(baseline.metric_name, z_score),
            current_value=current_value,
            expected_value=expected,
            z_score=z_score,
            explanation=explanation,
        )

    def _classify_type(self, metric_name: str, z_score: float) -> str:
        if metric_name == 'log_volume' and z_score > 0:
            return 'volume_spike'
        elif metric_name == 'error_rate':
            return 'error_rate'
        elif metric_name == 'p99_latency':
            return 'latency'
        return 'volume_spike'

    def update_baseline(
        self,
        existing: ServiceBaseline | None,
        new_values: list[float],
        timestamps: list[datetime],
    ) -> ServiceBaseline:
        """
        Incrementally update baseline with new observations.
        Uses exponential moving average with alpha=0.1 to slowly
        adapt to service evolution while being resistant to sudden spikes.
        """
        alpha = 0.1
        values = np.array(new_values)

        if existing is None:
            hourly = [0.0] * 24
            dow = [0.0] * 7
            hourly_counts = [0] * 24
            dow_counts = [0] * 7
            for v, t in zip(new_values, timestamps):
                hourly[t.hour] += v
                hourly_counts[t.hour] += 1
                dow[t.weekday()] += v
                dow_counts[t.weekday()] += 1

            mean = float(np.mean(values))
            hourly_pattern = [
                (hourly[h] / hourly_counts[h]) / mean if hourly_counts[h] > 0 and mean > 0 else 1.0
                for h in range(24)
            ]
            dow_pattern = [
                (dow[d] / dow_counts[d]) / mean if dow_counts[d] > 0 and mean > 0 else 1.0
                for d in range(7)
            ]

            return ServiceBaseline(
                service_name='',
                metric_name='',
                mean=mean,
                stddev=float(np.std(values)),
                p50=float(np.percentile(values, 50)),
                p95=float(np.percentile(values, 95)),
                p99=float(np.percentile(values, 99)),
                hourly_pattern=hourly_pattern,
                dow_pattern=dow_pattern,
                sample_count=len(new_values),
            )

        # EMA update
        new_mean = alpha * float(np.mean(values)) + (1 - alpha) * existing.mean
        new_stddev = alpha * float(np.std(values)) + (1 - alpha) * existing.stddev

        return ServiceBaseline(
            service_name=existing.service_name,
            metric_name=existing.metric_name,
            mean=new_mean,
            stddev=new_stddev,
            p50=alpha * float(np.percentile(values, 50)) + (1 - alpha) * existing.p50,
            p95=alpha * float(np.percentile(values, 95)) + (1 - alpha) * existing.p95,
            p99=alpha * float(np.percentile(values, 99)) + (1 - alpha) * existing.p99,
            hourly_pattern=existing.hourly_pattern,  # updated less frequently
            dow_pattern=existing.dow_pattern,
            sample_count=existing.sample_count + len(new_values),
        )
```

**Testing**:
- **T5.1.1 — Normal value**: Baseline mean=100, stddev=10. Current value=105. Expected: `is_anomaly=False`, score < 0.5.
- **T5.1.2 — Anomalous value**: Baseline mean=100, stddev=10. Current value=150. Expected: `is_anomaly=True`, score > 0.8.
- **T5.1.3 — Time-of-day adjustment**: Monday 9AM multiplier=3.0. Value=280 (expected ~300). Expected: `is_anomaly=False` (normal for Monday morning).
- **T5.1.4 — Baseline update**: Initial baseline from 100 samples. Add 50 new samples with slightly higher mean. Expected: baseline mean shifts by ~5% (EMA with alpha=0.1).
- **T5.1.5 — Zero stddev handling**: Baseline with stddev=0. Expected: `z_score=0`, no division by zero error.

---

#### 5.2 — LogBERT Anomaly Classifier

**What**: Implement a LogBERT-based model that classifies log sequences as normal or anomalous based on semantic content, not just volume.

**Design**:

```python
# apps/anomaly-engine/src/models/logbert.py

import torch
from transformers import BertTokenizer, BertForSequenceClassification
from dataclasses import dataclass

@dataclass
class LogBertPrediction:
    is_anomaly: bool
    score: float              # 0.0-1.0 anomaly probability
    novel_pattern: bool       # True if log pattern never seen during training
    explanation: str

class LogBertClassifier:
    """
    Fine-tuned BERT model for log anomaly classification.
    
    Architecture:
    - Base: bert-base-uncased (110M params)
    - Fine-tuned on log data with binary classification head
    - Input: concatenated log lines (up to 512 tokens)
    - Output: [normal, anomaly] logits
    
    Training data preparation:
    - Normal: historical log sequences from stable operation periods
    - Anomaly: log sequences from known incident periods + synthetic anomalies
    """

    def __init__(self, model_path: str, device: str = 'cpu'):
        self.device = torch.device(device)
        self.tokenizer = BertTokenizer.from_pretrained('bert-base-uncased')
        self.model = BertForSequenceClassification.from_pretrained(
            model_path,
            num_labels=2,
        ).to(self.device)
        self.model.eval()

    def predict(self, log_lines: list[str]) -> LogBertPrediction:
        """
        Classify a sequence of log lines as normal or anomalous.
        Input: list of recent log lines (e.g., last 50 lines from a service).
        """
        # Concatenate log lines with [SEP] separator
        text = ' [SEP] '.join(log_lines[-50:])  # max 50 lines

        inputs = self.tokenizer(
            text,
            max_length=512,
            truncation=True,
            padding='max_length',
            return_tensors='pt',
        ).to(self.device)

        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=1)
            anomaly_prob = probs[0][1].item()

        is_anomaly = anomaly_prob > 0.7  # threshold
        novel = anomaly_prob > 0.9       # high confidence = truly novel

        return LogBertPrediction(
            is_anomaly=is_anomaly,
            score=anomaly_prob,
            novel_pattern=novel,
            explanation=self._generate_explanation(log_lines, anomaly_prob),
        )

    def _generate_explanation(self, log_lines: list[str], prob: float) -> str:
        if prob > 0.9:
            return "Novel log pattern detected: this sequence of messages has not been observed during normal operation."
        elif prob > 0.7:
            return "Unusual log pattern: this sequence shows characteristics of known anomaly patterns."
        return "Log sequence appears normal."
```

**Testing**:
- **T5.2.1 — Normal log sequence**: Feed 50 standard INFO-level health check logs. Expected: `is_anomaly=False`, score < 0.3.
- **T5.2.2 — Anomalous sequence**: Feed logs containing a new `NullPointerException` pattern never seen in training. Expected: `is_anomaly=True`, score > 0.7.
- **T5.2.3 — Known-noisy pattern**: Feed logs from a known flaky dependency (e.g., intermittent DNS timeout). Expected: `is_anomaly=False` if the model was trained on this pattern.
- **T5.2.4 — Empty input**: Feed an empty list. Expected: graceful handling, score=0.
- **T5.2.5 — Long input truncation**: Feed 200 log lines (exceeds 512 tokens). Expected: last 50 lines used, no error.

---

#### 5.3 — Anomaly Detection Pipeline (Redis Streams Consumer)

**What**: Build the pipeline that consumes log batches from Redis Streams, runs them through statistical and LogBERT models, and writes anomaly results back to ClickHouse and PostgreSQL.

**Design**:

```python
# apps/anomaly-engine/src/pipeline/consumer.py

class AnomalyPipeline:
    """
    Continuous pipeline:
    1. Consume log batch references from Redis Streams
    2. Query ClickHouse for recent logs per service (5-minute windows)
    3. Run statistical detection on aggregated metrics
    4. Run LogBERT on log sequences that pass the statistical filter
    5. Write anomaly_score back to ClickHouse log records
    6. Write Anomaly records to PostgreSQL for anomalies above threshold
    7. Publish anomaly events to Redis for alert evaluation
    
    The two-stage filter (statistical first, then LogBERT) keeps LLM/ML
    costs manageable: LogBERT only processes service windows that the
    statistical detector flags as potentially anomalous.
    """

    EVALUATION_WINDOW = 300  # 5 minutes
    CONSUMER_GROUP = 'anomaly-detectors'
    STREAM_KEY = 'logwatch:anomaly:evaluate'

    async def run(self):
        while True:
            # Fetch services with new log data
            services = await self.get_active_services()

            for service in services:
                # Stage 1: Statistical detection
                metrics = await self.compute_service_metrics(service)
                baseline = await self.get_baseline(service)
                stat_result = self.statistical_detector.detect(
                    baseline, metrics.error_rate, datetime.utcnow()
                )

                if stat_result.score > 0.5:
                    # Stage 2: LogBERT semantic classification
                    recent_logs = await self.fetch_recent_logs(service, limit=50)
                    bert_result = self.logbert.predict(recent_logs)

                    if bert_result.is_anomaly:
                        combined_score = (stat_result.score + bert_result.score) / 2
                        await self.record_anomaly(service, combined_score, stat_result, bert_result)

                # Update baseline with current window data
                await self.update_baseline(service, metrics)

            await asyncio.sleep(30)  # evaluate every 30 seconds
```

**Testing**:
- **T5.3.1 — End-to-end detection**: Ingest 1000 normal logs, then 50 error logs with a novel pattern. Expected: anomaly detected within 60 seconds, recorded in PostgreSQL `anomalies` table.
- **T5.3.2 — Two-stage filter**: Ingest logs with normal volume but novel content. Expected: statistical detector passes (low score), LogBERT catches the anomaly.
- **T5.3.3 — Baseline update**: Run pipeline for 10 evaluation windows. Expected: `anomaly_baselines` table updated with current statistics.
- **T5.3.4 — Score writeback**: After anomaly detection, query ClickHouse `otel_logs` for the anomalous window. Expected: `anomaly_score` and `anomaly_detected` columns populated.
- **T5.3.5 — Alert trigger**: Anomaly detected with `severity: critical`. Expected: alert evaluation picks it up and fires configured alerts.

---

## Phase 6: Trace Correlation & Service Map

### Purpose

Ingest distributed traces via OTLP, correlate them with logs using W3C Trace Context, and build a live service dependency map discovered from trace data. This enables the "click a log line to see the full trace" experience and provides the service topology needed for root cause analysis.

### Tasks

#### 6.1 — OTLP Trace Ingestion

**What**: Implement the `/v1/traces` endpoint accepting OTLP ExportTraceServiceRequest and inserting spans into the ClickHouse `otel_traces` table.

**Design**:

The trace ingestion follows the same pattern as log ingestion (Task 2.2): parse the OTLP payload, normalize to `TraceSpan` types, batch-insert into ClickHouse. Spans carry `service_name` from resource attributes and are partitioned by `(tenant_id, toDate(start_time))`.

```typescript
// apps/api/src/routes/ingest/otlp-traces.ts
// POST /v1/traces — OTLP ExportTraceServiceRequest (JSON)

// Key normalization: flatten span events into parallel arrays
// (events_name, events_timestamp, events_attributes) for ClickHouse's
// Array column storage, which is more efficient than nested JSON.
```

**Testing**:
- **T6.1.1 — Trace ingestion**: POST 10 spans for a single trace. Expected: all 10 spans queryable by trace_id.
- **T6.1.2 — Parent-child linking**: Root span has no parent; child spans reference parent_span_id. Expected: `parent_span_id` correctly populated.
- **T6.1.3 — Error span**: Span with `status_code: ERROR`. Expected: `has_error` materialized column is `true`.
- **T6.1.4 — Duration calculation**: Span with start and end times 50ms apart. Expected: `duration_ns = 50000000`.

---

#### 6.2 — Log-to-Trace Correlation API

**What**: Build an API endpoint that, given a trace_id, returns all trace spans and their correlated log records.

**Design**:

```typescript
// GET /api/v1/traces/:traceId
interface TraceDetailResponse {
  traceId: string;
  spans: TraceSpan[];
  logs: LogRecord[];            // logs with matching trace_id
  duration: {
    totalMs: number;
    rootSpanMs: number;
  };
  services: string[];            // unique services in the trace
}
```

Two ClickHouse queries execute in parallel: one on `otel_traces` for spans, one on `otel_logs` filtered by `trace_id`. The API stitches them together using `span_id` to associate logs with their parent span.

**Testing**:
- **T6.2.1 — Trace retrieval**: Ingest trace + logs sharing a trace_id. GET `/api/v1/traces/:id`. Expected: both spans and logs returned.
- **T6.2.2 — Log-span correlation**: Log has `span_id` matching a span. Expected: log appears in the `logs` array associated with that span.
- **T6.2.3 — Cross-service trace**: Trace spans three services. Expected: `services` array contains all three service names.
- **T6.2.4 — Missing trace**: GET a non-existent trace_id. Expected: HTTP 404.

---

#### 6.3 — Service Dependency Discovery & Map

**What**: Build a background worker that analyzes trace data to discover service-to-service dependencies and stores them in the PostgreSQL `service_dependencies` table.

**Design**:

The worker runs every 5 minutes and executes a ClickHouse query that joins parent and child spans to find cross-service calls:

```sql
SELECT
    parent_service AS source,
    child_service AS target,
    count() AS call_count,
    avg(child_duration_ns) / 1e6 AS avg_duration_ms,
    countIf(child_status = 'ERROR') / count() AS error_rate
FROM (
    SELECT
        p.resource_attrs['service.name'] AS parent_service,
        c.resource_attrs['service.name'] AS child_service,
        c.duration_ns AS child_duration_ns,
        c.status_code AS child_status
    FROM otel_traces c
    JOIN otel_traces p ON p.trace_id = c.trace_id AND p.span_id = c.parent_span_id
    WHERE c.tenant_id = {tenantId:String}
      AND c.start_time >= now() - INTERVAL 24 HOUR
      AND parent_service != child_service
)
GROUP BY source, target
HAVING call_count > 10
```

Results are upserted into `service_dependencies` with call count, average duration, and error rate metrics.

The service map API endpoint returns the dependency graph:

```typescript
// GET /api/v1/services/map
interface ServiceMapResponse {
  nodes: Array<{
    id: string;
    name: string;
    namespace: string;
    environment: string;
    errorRate24h: number;
    requestRate24h: number;
  }>;
  edges: Array<{
    source: string;           // service ID
    target: string;
    callCount24h: number;
    avgDurationMs: number;
    errorRate24h: number;
  }>;
}
```

**Testing**:
- **T6.3.1 — Dependency discovery**: Ingest traces where service A calls B calls C. Run discovery worker. Expected: `service_dependencies` contains A→B and B→C edges.
- **T6.3.2 — Metrics on edges**: Edges include call_count, avg_duration_ms, error_rate. Expected: values match actual trace data.
- **T6.3.3 — Stale edge cleanup**: A dependency that hasn't been seen for 7+ days. Expected: not returned in active service map.
- **T6.3.4 — Service map API**: GET `/api/v1/services/map`. Expected: JSON with nodes and edges representing current topology.
- **T6.3.5 — New service auto-registration**: Traces arrive from a service not yet in `services` table. Expected: service automatically registered.

---

## Phase 7: Web Frontend — Log Explorer & Dashboard

### Purpose

Build the Next.js web application with the core user-facing views: log explorer with search and live tail, trace viewer, alert management, anomaly feed, and service map visualization.

### Tasks

#### 7.1 — App Shell & Authentication Flow

**What**: Set up the Next.js application with layout, navigation, dark/light theme, and OIDC authentication via next-auth.

**Design**:

```typescript
// apps/web/src/app/layout.tsx — root layout with sidebar nav
// apps/web/src/app/(auth)/login/page.tsx — OIDC login
// apps/web/src/app/(dashboard)/layout.tsx — authenticated layout with sidebar

// Navigation items:
// - Logs (log explorer + live tail)
// - Traces (trace viewer + service map)
// - Anomalies (anomaly feed + detail)
// - Alerts (rule management + event history)
// - Services (registry + topology)
// - Settings (tenant config, users, API keys)
// - Cost (usage dashboard)
```

Tailwind CSS with `@tailwindcss/typography` for log formatting. System-preference-respecting dark mode using `class` strategy.

**Testing**:
- **T7.1.1 — Login redirect**: Unauthenticated user visits /logs. Expected: redirected to /login.
- **T7.1.2 — OIDC callback**: Complete OIDC flow. Expected: redirected to /logs with session cookie set.
- **T7.1.3 — Navigation**: Click each nav item. Expected: correct page renders without full page reload.
- **T7.1.4 — Dark mode**: Toggle theme. Expected: all components render correctly in both modes.

---

#### 7.2 — Log Explorer Page

**What**: Build the log search page with a query bar, time range selector, severity filters, service filters, result list, and histogram.

**Design**:

The log explorer consists of:
1. **Query bar**: text input for full-text search, with keyboard shortcut (Cmd+K).
2. **Time range picker**: preset ranges (15m, 1h, 6h, 24h, 7d) and custom date picker.
3. **Filter sidebar**: checkboxes for severity levels, multi-select for services.
4. **Histogram**: SVG bar chart showing log volume over time, colored by severity. Brush selection on the histogram narrows the time range.
5. **Results list**: virtualized list (react-window) showing log lines with severity icon, timestamp, service name, and body. Click to expand full attributes.
6. **Live tail toggle**: switches from search mode to real-time streaming (SSE).

```typescript
// apps/web/src/app/(dashboard)/logs/page.tsx

interface LogExplorerState {
  query: string;
  timeRange: { start: Date; end: Date };
  severities: SeverityText[];
  services: string[];
  results: LogRecord[];
  histogram: HistogramBucket[];
  isLiveTail: boolean;
  isLoading: boolean;
}
```

**Testing**:
- **T7.2.1 — Search execution**: Type "error" and press Enter. Expected: results list shows matching logs, histogram updates.
- **T7.2.2 — Time range change**: Select "Last 1 hour". Expected: results reload for the new time range.
- **T7.2.3 — Severity filter**: Uncheck INFO and DEBUG. Expected: only WARN, ERROR, FATAL logs shown.
- **T7.2.4 — Log detail expansion**: Click a log line. Expected: expanded view shows all attributes, trace_id link.
- **T7.2.5 — Live tail mode**: Enable live tail. Expected: new logs stream in real time at the top of the list.
- **T7.2.6 — Histogram brush**: Drag to select a time range on the histogram. Expected: results filter to that range.
- **T7.2.7 — Large result set**: 10,000 results. Expected: virtualized list scrolls smoothly at 60fps.

---

#### 7.3 — Trace Viewer & Service Map

**What**: Build the trace detail page (waterfall/Gantt chart of spans) and the service map page (directed graph of service dependencies).

**Design**:

The trace viewer renders spans as a waterfall chart (similar to Jaeger/Zipkin). Each span is a horizontal bar positioned by start time and sized by duration. Parent-child relationships are shown by indentation. Error spans are highlighted in red. Clicking a span shows its attributes, events, and associated log lines.

The service map renders the `ServiceMapResponse` as a force-directed graph using a canvas-based renderer. Nodes represent services; edges represent call relationships. Edge thickness encodes call volume. Edge color encodes error rate (green → red gradient). Clicking a node navigates to the service detail page.

**Testing**:
- **T7.3.1 — Waterfall render**: View a trace with 20 spans. Expected: all spans rendered with correct relative positioning and duration bars.
- **T7.3.2 — Span detail**: Click a span. Expected: side panel shows span attributes, events, and correlated logs.
- **T7.3.3 — Error highlighting**: Error span highlighted in red. Expected: visual distinction from normal spans.
- **T7.3.4 — Service map render**: 10 services with dependencies. Expected: force-directed graph renders with correct edges.
- **T7.3.5 — Service map interaction**: Click a service node. Expected: navigates to service detail with recent logs and traces.

---

#### 7.4 — Alert Management & Anomaly Feed

**What**: Build the alert rule management page and the anomaly feed showing detected anomalies with feedback controls.

**Design**:

Alert management: table of alert rules with create/edit/delete dialogs. Each rule shows name, type, condition, severity, notification channels, and last fired time. Toggle for enable/disable.

Anomaly feed: reverse-chronological list of detected anomalies with severity badge, service name, title, score bar, and time window. Click to expand: full description (AI-generated), sample log lines, related traces, and feedback buttons (Helpful / Not Helpful / False Positive).

**Testing**:
- **T7.4.1 — Create alert rule**: Fill out the form and submit. Expected: rule appears in the list.
- **T7.4.2 — Edit alert rule**: Change threshold value. Expected: updated value persists after page reload.
- **T7.4.3 — Anomaly feed**: View anomaly list with 10 anomalies. Expected: sorted by detection time, most recent first.
- **T7.4.4 — Anomaly detail**: Click an anomaly. Expected: expanded view with sample logs and description.
- **T7.4.5 — Feedback submission**: Click "False Positive" on an anomaly. Expected: status changes to `false_positive`, feedback recorded.

---

## Phase 8: Natural-Language Log Query

### Purpose

Implement the AI-powered natural-language query interface that translates plain English questions into ClickHouse SQL, executes them, and explains the results in plain English. This addresses the "query language barrier" identified as a key market opportunity.

### Tasks

#### 8.1 — NL-to-SQL Translation Engine

**What**: Build an LLM-powered translation layer that converts natural-language questions about logs into ClickHouse SQL queries.

**Design**:

```typescript
// apps/api/src/services/nl-query.ts

import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a log query translator for an observability platform.
The user asks questions in plain English about their logs, traces, and metrics.
You translate these into ClickHouse SQL queries against the following schema:

TABLE: otel_logs
- timestamp (DateTime64(9))
- tenant_id (LowCardinality(String))
- severity_text (LowCardinality(String)): TRACE, DEBUG, INFO, WARN, ERROR, FATAL
- severity_number (UInt8): 1-24
- body (String): the log message
- trace_id (String): W3C trace ID
- span_id (String): W3C span ID
- resource_string (Map(String, String)): includes 'service.name', 'host.name', etc.
- attributes_string (Map(String, String)): includes 'http.method', 'http.status_code', etc.
- anomaly_score (Float32): 0.0-1.0
- anomaly_detected (Bool)

TABLE: otel_traces
- start_time (DateTime64(9))
- tenant_id (LowCardinality(String))
- trace_id, span_id, parent_span_id (String)
- operation_name, service_name, span_kind, status_code (LowCardinality(String))
- duration_ns (UInt64)

RULES:
1. ALWAYS include tenant_id = '{tenant_id}' in WHERE clause
2. ALWAYS limit results to at most 1000 rows
3. Use hasToken(body, 'term') for text search (uses bloom filter index)
4. Access map values like: resource_string['service.name']
5. For time ranges, use now() - INTERVAL N HOUR/MINUTE/DAY
6. Return ONLY the SQL query, no explanation`;

export interface NlQueryResult {
  naturalLanguage: string;
  generatedQuery: string;
  results: Record<string, unknown>[];
  resultsSummary: string;
  executionTimeMs: number;
}

export async function executeNlQuery(
  anthropic: Anthropic,
  clickhouse: ClickHouseClient,
  tenantId: string,
  question: string,
): Promise<NlQueryResult> {
  // Step 1: Translate NL to SQL
  const translationResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT.replace('{tenant_id}', tenantId),
    messages: [{ role: 'user', content: question }],
  });

  const generatedQuery = extractSql(translationResponse.content[0].text);

  // Step 2: Execute the query
  const startTime = Date.now();
  const results = await clickhouse.query({ query: generatedQuery, format: 'JSONEachRow' });
  const rows = await results.json();
  const executionTimeMs = Date.now() - startTime;

  // Step 3: Generate plain-English summary of results
  const summaryResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `The user asked: "${question}"\n\nThe query returned ${rows.length} results. Here are the first 10:\n${JSON.stringify(rows.slice(0, 10), null, 2)}\n\nProvide a brief, helpful plain-English summary of what the results show.`,
    }],
  });

  return {
    naturalLanguage: question,
    generatedQuery,
    results: rows,
    resultsSummary: summaryResponse.content[0].text,
    executionTimeMs,
  };
}
```

**Testing**:
- **T8.1.1 — Simple query**: "Show me all errors in the last hour". Expected: generates valid ClickHouse SQL with `severity_number >= 17` and `timestamp > now() - INTERVAL 1 HOUR`.
- **T8.1.2 — Service-specific query**: "What caused the spike in 5xx errors in payment-service between 2pm and 3pm yesterday?". Expected: generates query filtering by service name, HTTP status code, and time range.
- **T8.1.3 — Aggregation query**: "Which services have the highest error rate today?". Expected: generates GROUP BY query with error rate calculation.
- **T8.1.4 — Result summary**: Query returns 50 error logs. Expected: summary explains the pattern (e.g., "Most errors are TimeoutError from the Redis client in payment-service").
- **T8.1.5 — Tenant isolation**: Generated SQL always includes `tenant_id` filter. Expected: no query generated without tenant filter.
- **T8.1.6 — SQL injection prevention**: Adversarial input: "Drop table otel_logs; SELECT 1". Expected: generated query is SELECT-only, no DDL/DML.

---

#### 8.2 — NL Query UI

**What**: Add a natural-language query interface to the web frontend with a chat-like experience.

**Design**:

A floating query bar (Cmd+K shortcut) that accepts plain English. Results render below the query with: the generated SQL (collapsible), the result table, and the plain-English summary. Query history is stored in the `nl_queries` PostgreSQL table for the current user.

**Testing**:
- **T8.2.1 — Query submission**: Type a question and press Enter. Expected: loading state, then results and summary appear.
- **T8.2.2 — Generated SQL display**: Click "Show query". Expected: the ClickHouse SQL is displayed with syntax highlighting.
- **T8.2.3 — Query history**: Previous queries shown in a dropdown. Expected: clicking a previous query re-executes it.
- **T8.2.4 — Error handling**: Query that produces a ClickHouse error. Expected: friendly error message displayed, not raw ClickHouse error.

---

## Phase 9: Root Cause Analysis & AI Narratives

### Purpose

Build the AI-powered root cause analysis engine that automatically generates plain-language incident summaries linking anomalous logs, distributed traces, recent deployments, and metric changes. This is the platform's highest-value AI feature — producing a narrative explanation rather than a wall of correlated events.

### Tasks

#### 9.1 — Deployment Tracking

**What**: Add a deployment tracking table and API endpoint so the RCA engine can correlate anomalies with recent code changes.

**Design**:

```typescript
// POST /api/v1/deployments
interface CreateDeploymentRequest {
  serviceName: string;
  version: string;
  commitSha?: string;
  deployedBy?: string;
  changelog?: string;
  deployedAt?: string;          // ISO 8601, defaults to now
}

// PostgreSQL table: deployments
// id, tenant_id, service_id, version, commit_sha, deployed_by, changelog, deployed_at
```

Deployments are also reported via a webhook endpoint that CI/CD systems (GitHub Actions, GitLab CI) can call automatically.

**Testing**:
- **T9.1.1 — Record deployment**: POST a deployment record. Expected: HTTP 201, stored in PostgreSQL.
- **T9.1.2 — List deployments**: GET `/api/v1/deployments?service=payment-service&last=24h`. Expected: recent deployments for that service.
- **T9.1.3 — CI/CD webhook**: POST to `/api/v1/webhooks/deploy` with GitHub Actions payload format. Expected: deployment recorded.

---

#### 9.2 — Root Cause Analysis Engine

**What**: Build an LLM-powered RCA engine that, given an anomaly, gathers evidence from logs, traces, metrics, and deployments, then generates a narrative explanation.

**Design**:

```typescript
// apps/api/src/services/rca-engine.ts

interface RcaEvidence {
  type: 'deployment' | 'log_pattern' | 'metric_change' | 'trace_anomaly';
  summary: string;
  data: Record<string, unknown>;
  timestamp: Date;
  relevanceScore: number;          // 0.0-1.0
}

export async function generateRcaReport(
  anomaly: Anomaly,
  tenantId: string,
): Promise<RcaReport> {
  // Step 1: Gather evidence
  const evidence: RcaEvidence[] = [];

  // 1a. Recent deployments to the affected service (last 24h)
  const deployments = await getRecentDeployments(tenantId, anomaly.serviceId, 24);
  for (const d of deployments) {
    evidence.push({
      type: 'deployment',
      summary: `Deployment ${d.version} to ${d.serviceName} at ${d.deployedAt.toISOString()}`,
      data: { version: d.version, commitSha: d.commitSha, changelog: d.changelog },
      timestamp: d.deployedAt,
      relevanceScore: computeTemporalProximity(d.deployedAt, anomaly.detectedAt),
    });
  }

  // 1b. Log patterns in the anomaly window
  const logPatterns = await getLogPatterns(tenantId, anomaly.windowStart, anomaly.windowEnd, anomaly.serviceId);
  for (const pattern of logPatterns) {
    evidence.push({
      type: 'log_pattern',
      summary: `${pattern.count} occurrences of "${pattern.template}" in ${pattern.serviceName}`,
      data: pattern,
      timestamp: anomaly.windowStart,
      relevanceScore: pattern.count > 100 ? 0.9 : 0.5,
    });
  }

  // 1c. Metric changes (error rate, latency spikes)
  const metricChanges = await getMetricChanges(tenantId, anomaly.serviceId, anomaly.windowStart, anomaly.windowEnd);
  for (const mc of metricChanges) {
    evidence.push({
      type: 'metric_change',
      summary: `${mc.metricName} changed from ${mc.before} to ${mc.after}`,
      data: mc,
      timestamp: anomaly.windowStart,
      relevanceScore: Math.abs(mc.percentChange) > 100 ? 0.9 : 0.5,
    });
  }

  // 1d. Trace anomalies (slow spans, error spans)
  const traceAnomalies = await getTraceAnomalies(tenantId, anomaly.serviceId, anomaly.windowStart, anomaly.windowEnd);
  for (const ta of traceAnomalies) {
    evidence.push({
      type: 'trace_anomaly',
      summary: `${ta.operationName} p99 latency: ${ta.p99Before}ms → ${ta.p99After}ms`,
      data: ta,
      timestamp: anomaly.windowStart,
      relevanceScore: 0.8,
    });
  }

  // Step 2: Sort evidence by relevance
  evidence.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Step 3: Generate narrative with LLM
  const narrative = await generateNarrative(anomaly, evidence.slice(0, 10));

  // Step 4: Store RCA report
  return await storeRcaReport(tenantId, anomaly.id, narrative, evidence);
}

async function generateNarrative(
  anomaly: Anomaly,
  evidence: RcaEvidence[],
): Promise<{ summary: string; probableCause: string; confidence: number }> {
  const prompt = `You are an SRE investigating an incident. Based on the following evidence, write a concise root cause analysis.

ANOMALY:
- Title: ${anomaly.title}
- Type: ${anomaly.anomalyType}
- Service: (service name from ID lookup)
- Time window: ${anomaly.windowStart.toISOString()} to ${anomaly.windowEnd.toISOString()}

EVIDENCE:
${evidence.map((e, i) => `${i + 1}. [${e.type}] ${e.summary}`).join('\n')}

Write:
1. A 2-3 sentence summary of what happened
2. The probable root cause (one sentence)
3. Your confidence level (0.0-1.0)

Be specific. Reference actual service names, deployment versions, and error messages from the evidence.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  return parseNarrativeResponse(response.content[0].text);
}
```

**Testing**:
- **T9.2.1 — Deployment correlation**: Anomaly detected 5 minutes after a deployment. Expected: RCA report includes the deployment as probable cause with high confidence.
- **T9.2.2 — Metric change evidence**: Error rate spikes from 0.1% to 15%. Expected: RCA report includes metric change evidence.
- **T9.2.3 — Trace evidence**: p99 latency spikes on a specific operation. Expected: included in evidence chain.
- **T9.2.4 — Narrative quality**: Generated summary references specific service names, versions, and error messages. Expected: human-readable, actionable narrative.
- **T9.2.5 — No evidence**: Anomaly with no recent deployments or metric changes. Expected: RCA report states low confidence, suggests manual investigation.
- **T9.2.6 — RCA report storage**: Report stored in `rca_reports` table. Expected: retrievable via API.

---

#### 9.3 — RCA Report UI

**What**: Add RCA report display to the anomaly detail page, showing the narrative summary, evidence chain, and feedback controls.

**Design**:

The anomaly detail page includes a "Root Cause Analysis" section that displays:
1. The AI-generated summary paragraph
2. The probable cause (highlighted)
3. Confidence meter (0-100%)
4. Evidence chain as a timeline with icons for each evidence type
5. "Was this helpful?" thumbs up/down feedback

**Testing**:
- **T9.3.1 — RCA display**: Open anomaly with RCA report. Expected: summary, probable cause, and evidence rendered.
- **T9.3.2 — Evidence timeline**: Evidence items displayed in chronological order with type icons.
- **T9.3.3 — Feedback submission**: Click thumbs down. Expected: feedback stored in `rca_reports.helpful`.

---

## Phase 10: Cost Management & Adaptive Thresholds

### Purpose

Build the cost management dashboard that tracks per-service ingestion volume and cost, provides AI-generated sampling recommendations, and implements adaptive alert threshold calibration that learns from service behavior patterns.

### Tasks

#### 10.1 — Ingestion Usage Tracking

**What**: Track per-service, per-day ingestion volume and compute estimated cost, stored in the PostgreSQL `ingest_usage` table.

**Design**:

A background worker runs hourly and queries ClickHouse for per-service ingestion volume:

```sql
SELECT
    resource_string['service.name'] AS service_name,
    toDate(timestamp) AS day,
    'logs' AS signal_type,
    count() AS record_count,
    sum(length(body)) AS bytes_raw
FROM otel_logs
WHERE tenant_id = {tenantId:String}
  AND timestamp >= toDate(now()) - 1
GROUP BY service_name, day
```

Cost is estimated using a configurable rate per GB (default: $0.30/GB, matching SigNoz pricing).

**Testing**:
- **T10.1.1 — Usage tracking**: Ingest 10,000 logs. Run usage worker. Expected: `ingest_usage` row with correct record_count and bytes.
- **T10.1.2 — Per-service breakdown**: Ingest logs from 3 services. Expected: separate usage rows per service.
- **T10.1.3 — Cost estimation**: 1 GB of logs at $0.30/GB rate. Expected: `estimated_cost_usd = 0.30`.

---

#### 10.2 — AI Sampling Recommendations

**What**: Analyze log patterns to identify high-volume, low-signal log lines and recommend sampling rates with estimated cost savings.

**Design**:

```typescript
// apps/api/src/services/sampling-advisor.ts

interface SamplingRecommendation {
  serviceName: string;
  logPattern: string;              // e.g., "Health check response 200"
  currentVolumePerDay: number;
  recommendedSampleRate: number;   // e.g., 0.01 = keep 1%
  estimatedSavingsGb: number;
  reason: string;
}

/**
 * Identify top log patterns by volume, classify them as high/low signal
 * using LLM analysis, and recommend sampling rates.
 * 
 * Pattern extraction: group log bodies by template (replace numbers,
 * UUIDs, IPs with placeholders) and count occurrences.
 */
async function generateSamplingRecommendations(
  tenantId: string,
): Promise<SamplingRecommendation[]> {
  // Step 1: Extract top 50 log patterns by volume (last 7 days)
  const patterns = await getTopLogPatterns(tenantId, 50, 7);

  // Step 2: Use LLM to classify each pattern as high/low signal
  // and recommend sampling rates
  const prompt = `Analyze these log patterns and recommend sampling rates...`;
  // (LLM classifies: health checks → 1%, debug → 10%, errors → 100%)

  return recommendations;
}
```

**Testing**:
- **T10.2.1 — Pattern extraction**: Ingest 10,000 health check logs and 100 error logs. Expected: health check pattern identified as top pattern.
- **T10.2.2 — Sampling recommendation**: Health check logs identified. Expected: recommendation to sample at 1% with estimated savings.
- **T10.2.3 — Error logs preserved**: Error logs never recommended for sampling. Expected: recommended rate = 1.0 (keep all).

---

#### 10.3 — Adaptive Alert Threshold Calibration

**What**: Build the adaptive threshold system that continuously learns service-specific baselines and automatically adjusts alert thresholds with explanations.

**Design**:

The adaptive threshold system extends the anomaly baselines (Phase 5) to also adjust alert rule thresholds. Every 24 hours, the system:

1. Recalculates baselines for each service using the last 7 days of data
2. Identifies alert rules whose thresholds are significantly misaligned with current baselines
3. Proposes threshold adjustments with explanations
4. Auto-applies adjustments below a confidence threshold (optional, configurable)

```typescript
interface ThresholdAdjustment {
  alertRuleId: string;
  currentThreshold: number;
  recommendedThreshold: number;
  reason: string;                    // e.g., "Monday morning batch jobs consistently produce 3x normal error volume"
  autoApply: boolean;
  confidence: number;
}
```

**Testing**:
- **T10.3.1 — Baseline recalculation**: 7 days of data with Monday spikes. Expected: baselines reflect Monday pattern.
- **T10.3.2 — Threshold recommendation**: Alert threshold at 100 errors/5min, but Monday baseline is 300. Expected: recommendation to adjust or explanation of pattern.
- **T10.3.3 — Explanation quality**: Explanation references specific time patterns ("this service naturally spikes on Monday mornings"). Expected: specific, actionable.

---

#### 10.4 — Cost Management Dashboard

**What**: Build the frontend cost dashboard showing per-service volume, cost trends, and sampling recommendations.

**Design**:

Dashboard includes:
1. Total ingestion volume and estimated cost (current month)
2. Per-service breakdown table (sortable by volume, cost)
3. 30-day trend chart showing daily ingestion volume
4. Sampling recommendations panel with "Apply" buttons
5. Cost projection: estimated monthly cost based on current ingestion rate

**Testing**:
- **T10.4.1 — Cost summary**: Dashboard shows total GB and estimated cost. Expected: values match `ingest_usage` data.
- **T10.4.2 — Service breakdown**: Table shows per-service volume sorted by cost. Expected: correct sorting and values.
- **T10.4.3 — Trend chart**: 30-day chart renders with correct daily data points.
- **T10.4.4 — Sampling apply**: Click "Apply" on a sampling recommendation. Expected: recommendation status changes to 'applied'.

---

## Phase 11: Metrics Ingestion & Unified Query

### Purpose

Add Prometheus-compatible metrics ingestion so logs and metrics can be queried in a single context. This enables alert rules that combine log patterns with metric thresholds, and provides the metrics data needed for service RED dashboards.

### Tasks

#### 11.1 — Prometheus Remote Write Endpoint

**What**: Implement a Prometheus Remote Write-compatible endpoint that accepts metric samples and stores them in the ClickHouse metrics tables.

**Design**:

```typescript
// POST /api/v1/prom/write
// Content-Type: application/x-protobuf
// Content-Encoding: snappy
//
// Body: Prometheus Remote Write protobuf (WriteRequest)
//
// The endpoint:
// 1. Decompresses Snappy-encoded protobuf
// 2. Deserializes WriteRequest
// 3. Computes fingerprint (xxHash64 of sorted labels) for each time series
// 4. Upserts time series metadata into metrics_time_series
// 5. Batch-inserts samples into metrics_samples
```

**Testing**:
- **T11.1.1 — Remote write**: Configure Prometheus to remote_write to the endpoint. Expected: metrics appear in ClickHouse.
- **T11.1.2 — Fingerprint consistency**: Same label set always produces the same fingerprint. Expected: deterministic hashing.
- **T11.1.3 — High cardinality**: 10,000 unique time series. Expected: all stored without error.
- **T11.1.4 — Rollup materialization**: After raw samples are inserted, 1-hour rollups appear in `metrics_samples_1h`. Expected: automatic via materialized view.

---

#### 11.2 — Metrics Query API

**What**: Build a query API for metrics that supports Prometheus-style range queries.

**Design**:

```typescript
// GET /api/v1/metrics/query
// Query params: metric_name, labels (JSON), start, end, step
//
// Response: time-series data compatible with Grafana data source format

interface MetricQueryResponse {
  series: Array<{
    metric: string;
    labels: Record<string, string>;
    values: Array<[number, number]>;   // [timestamp_seconds, value]
  }>;
}
```

**Testing**:
- **T11.2.1 — Range query**: Query `http_request_duration_seconds` for last hour. Expected: time series data returned.
- **T11.2.2 — Label filter**: Query with `{service="payment-service"}`. Expected: only matching series.
- **T11.2.3 — Rollup usage**: Query spanning 7 days. Expected: uses `metrics_samples_1h` for efficiency (verifiable via query log).

---

## Phase 12: Production Hardening & Deployment

### Purpose

Prepare the platform for production deployment with Kubernetes Helm chart, CI/CD pipeline, observability of the platform itself, comprehensive error handling, and performance optimization.

### Tasks

#### 12.1 — Kubernetes Helm Chart

**What**: Create a Helm chart that deploys all platform components (API, anomaly engine, web, ClickHouse, PostgreSQL, Redis) to Kubernetes.

**Design**:

```yaml
# helm/logwatch/values.yaml
api:
  replicas: 2
  resources:
    requests: { cpu: 500m, memory: 512Mi }
    limits: { cpu: 2000m, memory: 2Gi }

anomalyEngine:
  replicas: 1
  resources:
    requests: { cpu: 1000m, memory: 2Gi }
    limits: { cpu: 4000m, memory: 8Gi }

web:
  replicas: 2
  resources:
    requests: { cpu: 250m, memory: 256Mi }

clickhouse:
  replicas: 3                        # ClickHouse Keeper for replication
  storage: 100Gi
  storageClass: gp3

postgres:
  replicas: 2                        # primary + read replica
  storage: 20Gi

redis:
  maxMemory: 1Gi
```

**Testing**:
- **T12.1.1 — Helm template**: `helm template logwatch ./helm/logwatch` produces valid Kubernetes manifests. Expected: no template errors.
- **T12.1.2 — Helm install**: Install to a test cluster. Expected: all pods reach Running state within 5 minutes.
- **T12.1.3 — Health checks**: All deployments have liveness and readiness probes. Expected: unhealthy pods are restarted.

---

#### 12.2 — CI/CD Pipeline

**What**: Build GitHub Actions workflows for linting, testing, building Docker images, and deploying.

**Design**:

```yaml
# .github/workflows/ci.yml
# Triggers: push to main, pull requests
# Jobs:
#   lint: pnpm -r lint
#   test-unit: pnpm -r test:unit
#   test-integration: starts ClickHouse + PostgreSQL services, runs pnpm -r test:integration
#   build: pnpm -r build && docker build for each app
```

**Testing**:
- **T12.2.1 — CI pass**: Push a commit with passing tests. Expected: all CI jobs pass.
- **T12.2.2 — CI fail**: Push a commit with a linting error. Expected: CI fails with clear error message.
- **T12.2.3 — Docker build**: CI builds Docker images for api, anomaly-engine, web. Expected: all images build successfully.

---

#### 12.3 — Platform Self-Observability

**What**: Instrument the platform itself with OpenTelemetry so operators can monitor the platform's health using standard observability tools.

**Design**:

The API server, anomaly engine, and web frontend all export metrics and traces via OTLP to a configured backend (which can be the platform itself, or an external Prometheus/Grafana stack). Key metrics:

- `logwatch_ingest_records_total` — counter of ingested log records
- `logwatch_ingest_bytes_total` — counter of ingested bytes
- `logwatch_query_duration_seconds` — histogram of query execution time
- `logwatch_anomaly_detections_total` — counter of detected anomalies
- `logwatch_alert_fires_total` — counter of alert firings
- `logwatch_clickhouse_insert_duration_seconds` — histogram of ClickHouse insert latency

**Testing**:
- **T12.3.1 — Metrics export**: Query the `/metrics` endpoint. Expected: Prometheus-format metrics with correct labels.
- **T12.3.2 — Trace propagation**: API request generates trace spans. Expected: spans visible in trace backend.
- **T12.3.3 — Error recording**: Force an error. Expected: error span recorded with stack trace attribute.

---

#### 12.4 — Performance Optimization

**What**: Optimize critical paths for production workloads: ingestion throughput, search latency, and live tail responsiveness.

**Design**:

Optimizations:
1. **ClickHouse async inserts**: Enable `async_insert=1` with `wait_for_async_insert=0` for fire-and-forget ingestion. ClickHouse buffers and flushes automatically.
2. **Connection pooling**: Pre-warmed ClickHouse and PostgreSQL connection pools. ClickHouse: 10 connections. PostgreSQL: 20 connections.
3. **Query result caching**: Redis cache for histogram and facet queries with 30-second TTL (these queries are expensive but tolerance for staleness is high).
4. **Batch size tuning**: Optimal batch size for ClickHouse inserts is 10,000-50,000 rows per insert statement.
5. **SSE backpressure**: Live tail drops oldest events when the client falls behind, preventing server-side buffer growth.

**Testing**:
- **T12.4.1 — Ingestion throughput**: Benchmark: 100K logs/second sustained for 60 seconds. Expected: all logs stored, no errors.
- **T12.4.2 — Search latency**: Full-text search over 10M logs. Expected: p95 < 500ms.
- **T12.4.3 — Live tail latency**: Time from log ingestion to appearance in SSE stream. Expected: < 3 seconds.
- **T12.4.4 — Concurrent users**: 50 concurrent search queries. Expected: p95 < 2 seconds.

---

## Phase Summary & Dependencies

```
Phase 1: Scaffolding & Data Layer
    |
    v
Phase 2: Log Ingestion Pipeline
    |
    +---> Phase 3: Log Search & Live Tail
    |         |
    |         +---> Phase 7: Web Frontend (Log Explorer)
    |         |         |
    |         |         +---> Phase 8: NL Query (depends on 7 for UI)
    |         |
    |         +---> Phase 4: Auth, Multi-Tenancy & Alerts
    |                   |
    |                   +---> Phase 5: Anomaly Detection Engine
    |                   |         |
    |                   |         +---> Phase 9: Root Cause Analysis
    |                   |         |         |
    |                   |         |         +---> Phase 10: Cost Mgmt & Adaptive Thresholds
    |                   |         |
    |                   |         +---> Phase 6: Trace Correlation & Service Map
    |                   |
    |                   +---> Phase 11: Metrics Ingestion (can start after Phase 4)
    |
    +---> Phase 12: Production Hardening (can start after Phase 2, grows with each phase)

Parallelism opportunities:
- Phase 3 and Phase 4 can proceed in parallel after Phase 2
- Phase 5 and Phase 6 can proceed in parallel after Phase 4
- Phase 8 (NL Query) can proceed in parallel with Phase 9 (RCA) after Phase 7
- Phase 11 (Metrics) can proceed in parallel with Phases 5-10
- Phase 12 tasks can be done incrementally alongside other phases
```

---

## Definition of Done (per phase)

1. All tasks in the phase are implemented and merged to `main`
2. All unit tests pass (`pnpm test:unit` exits 0)
3. All integration tests pass against real ClickHouse and PostgreSQL instances (`pnpm test:integration` exits 0)
4. No TypeScript compilation errors (`tsc --noEmit` exits 0)
5. No ESLint errors or warnings (`pnpm lint` exits 0)
6. API endpoints are documented in OpenAPI specification (`docs/openapi.yaml`)
7. Docker Compose development environment starts cleanly and all new functionality works end-to-end
8. All new database tables have corresponding migration files that run successfully up and down
9. New API endpoints include request validation with descriptive error messages for invalid input
10. Sensitive data (API keys, passwords) is never logged or returned in API responses
11. Multi-tenant isolation is verified: tenant A cannot access tenant B's data through any endpoint
12. Performance benchmarks for critical paths (ingestion, search) meet or exceed targets specified in testing sections
