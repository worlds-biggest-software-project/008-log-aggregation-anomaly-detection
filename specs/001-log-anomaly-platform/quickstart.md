# Quickstart: Log Aggregation & Anomaly Detection Platform

**Branch**: `001-log-anomaly-platform` | **Date**: 2026-05-11

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | API server, CLI, shared packages |
| pnpm | 9+ | Monorepo package manager |
| Python | 3.11+ | Anomaly detection engine |
| Docker + Docker Compose | 24+ | Local ClickHouse, PostgreSQL, Redis |
| Git | 2.x | Source control |

## Clone & Install

```bash
git clone <repo-url> logwatch
cd logwatch
pnpm install
```

## Start Infrastructure

```bash
docker compose up -d
```

This starts:
- **ClickHouse** (port 8123 HTTP, 9000 native) — telemetry storage
- **PostgreSQL** (port 5432) — operational data
- **Redis** (port 6379) — ingestion buffer and job queue

Wait for services to be healthy:
```bash
docker compose ps
```

## Run Database Migrations

```bash
# PostgreSQL migrations (creates tables, RLS policies, seed data)
pnpm --filter @logwatch/db run migrate

# ClickHouse DDL (creates otel_logs, otel_traces, metrics tables)
pnpm --filter @logwatch/db run clickhouse:setup
```

## Set Up the Anomaly Engine (Python)

```bash
cd apps/anomaly-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure Environment

Copy the example environment file and fill in required values:

```bash
cp .env.example .env
```

Key variables:
```env
# PostgreSQL
DATABASE_URL=postgresql://logwatch:logwatch@localhost:5432/logwatch

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=observability

# Redis
REDIS_URL=redis://localhost:6379

# Auth (NextAuth.js)
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NEXTAUTH_URL=http://localhost:3000

# Claude API (for NL queries and RCA)
ANTHROPIC_API_KEY=<your-api-key>

# Anomaly engine
ANOMALY_ENGINE_URL=http://localhost:8001
```

## Start All Services

In separate terminals (or use a process manager):

```bash
# Terminal 1: API server (Fastify)
pnpm --filter @logwatch/api run dev
# → http://localhost:4000

# Terminal 2: Anomaly engine (FastAPI)
cd apps/anomaly-engine && source .venv/bin/activate
uvicorn src.main:app --reload --port 8001
# → http://localhost:8001

# Terminal 3: Web UI (Next.js)
pnpm --filter @logwatch/web run dev
# → http://localhost:3000
```

## Verify Setup

### Check API health
```bash
curl http://localhost:4000/health
# {"status": "ok", "clickhouse": "ok", "postgres": "ok", "redis": "ok"}
```

### Send a test log via HTTP JSON
```bash
curl -X POST http://localhost:4000/api/v1/ingest/json \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-api-key>" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-05-11T14:30:00.000Z",
        "severity": "INFO",
        "body": "Quickstart test log entry",
        "service": "quickstart-test",
        "attributes": {"env": "development"}
      }
    ]
  }'
```

### Search for the test log
```bash
curl "http://localhost:4000/api/v1/logs?q=quickstart&from=2026-05-11T00:00:00Z" \
  -H "Authorization: Bearer <jwt-token>"
```

### Send test OTLP data (using OpenTelemetry Collector)

Configure an OTel Collector with:
```yaml
exporters:
  otlphttp:
    endpoint: http://localhost:4000/api/v1/ingest/otlp
    headers:
      X-API-Key: "<your-api-key>"
```

## Running Tests

```bash
# TypeScript unit + integration tests
pnpm test

# Python anomaly engine tests
cd apps/anomaly-engine && pytest

# E2E tests (requires all services running)
pnpm --filter @logwatch/web run test:e2e
```

## Project Structure

```
logwatch/
├── apps/
│   ├── api/              # Fastify API server (TypeScript)
│   ├── anomaly-engine/   # FastAPI ML service (Python)
│   ├── web/              # Next.js 15 frontend
│   └── cli/              # CLI for log shipping + admin
├── packages/
│   ├── shared/           # Shared types, constants, utils
│   ├── db/               # Database migrations and clients
│   └── test-utils/       # Test fixtures and factories
├── docker-compose.yml    # Local dev infrastructure
└── helm/logwatch/        # Kubernetes Helm chart (production)
```

## Common Tasks

| Task | Command |
|------|---------|
| Add a migration | `pnpm --filter @logwatch/db run migrate:create <name>` |
| Reset database | `pnpm --filter @logwatch/db run migrate:reset` |
| Lint | `pnpm lint` |
| Type check | `pnpm typecheck` |
| Build all | `pnpm build` |
| Build Docker images | `docker compose -f docker-compose.prod.yml build` |
