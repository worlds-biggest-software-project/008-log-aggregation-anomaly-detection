# LogWatch Installation Guide

**Version**: 0.1.0 | **Last Updated**: May 2026

This guide covers every way to install and run LogWatch, from a quick local setup to a production Kubernetes deployment.

---

## Table of Contents

1. [System Requirements](#system-requirements)
2. [Quick Start (5 Minutes)](#quick-start-5-minutes)
3. [Development Setup (Full)](#development-setup-full)
4. [Production: Docker Compose](#production-docker-compose)
5. [Production: Kubernetes with Helm](#production-kubernetes-with-helm)
6. [Connecting Your Services](#connecting-your-services)
7. [Post-Installation Checklist](#post-installation-checklist)
8. [Upgrading](#upgrading)
9. [Uninstalling](#uninstalling)

---

## System Requirements

### Minimum (Development / Evaluation)

| Component | Requirement |
|-----------|-------------|
| CPU | 4 cores |
| RAM | 8 GB |
| Disk | 20 GB free (SSD recommended) |
| OS | macOS 13+, Ubuntu 22.04+, Debian 12+, or Windows 11 (WSL2) |
| Docker | 24.0+ with Docker Compose v2 |
| Node.js | 20 LTS or newer |
| pnpm | 9.0+ |
| Python | 3.11+ |
| Git | 2.x |

### Recommended (Production)

| Component | Requirement |
|-----------|-------------|
| CPU | 8+ cores (16+ for >50K logs/sec) |
| RAM | 32 GB minimum (64 GB for >50K logs/sec) |
| Disk | SSD, 500 GB+ (depends on retention and volume) |
| ClickHouse | 16 GB RAM dedicated, SSD storage |
| PostgreSQL | 4 GB RAM dedicated |
| Redis | 1 GB RAM dedicated |
| GPU | NVIDIA with CUDA (optional, accelerates anomaly detection 10x) |

### Storage Estimation

```
Daily storage = (logs_per_second) * (avg_log_size_bytes) * 86,400 / compression_ratio

Example:
  10,000 logs/sec * 500 bytes * 86,400 sec / 10 (compression)
  = ~43 GB/day raw → ~4.3 GB/day compressed

  At 30-day retention: ~129 GB compressed storage needed
```

---

## Quick Start (5 Minutes)

The fastest way to get LogWatch running locally with sample data.

### Step 1: Clone and Install

```bash
git clone https://github.com/logwatch/logwatch.git
cd logwatch
pnpm install
```

### Step 2: Start Infrastructure

```bash
docker compose up -d
```

This starts ClickHouse, PostgreSQL, and Redis. Wait for all services to be healthy:

```bash
docker compose ps
```

All three services should show `(healthy)` status.

### Step 3: Set Up the Database

```bash
# Create PostgreSQL tables, RLS policies, and seed data
pnpm --filter @logwatch/db run migrate

# Create ClickHouse tables (otel_logs, otel_traces, metrics)
pnpm --filter @logwatch/db run clickhouse:setup
```

### Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
```

Optional but recommended:
```env
ANTHROPIC_API_KEY=<your-key>   # Enables NL queries and RCA reports
```

### Step 5: Start LogWatch

Open three terminal windows:

```bash
# Terminal 1: API server
pnpm --filter @logwatch/api run dev
# → Running at http://localhost:4000

# Terminal 2: Anomaly engine
cd apps/anomaly-engine
python -m venv .venv
source .venv/bin/activate      # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn src.main:app --reload --port 8001
# → Running at http://localhost:8001

# Terminal 3: Web UI
pnpm --filter @logwatch/web run dev
# → Running at http://localhost:3000
```

### Step 6: Verify

```bash
# Check API health
curl http://localhost:4000/health
# Expected: {"status":"ok","clickhouse":"ok","postgres":"ok","redis":"ok"}

# Send a test log
curl -X POST http://localhost:4000/api/v1/ingest/json \
  -H "Content-Type: application/json" \
  -d '{
    "logs": [{
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "severity": "INFO",
      "body": "LogWatch installation verified successfully",
      "service": "install-test"
    }]
  }'
```

Open http://localhost:3000 in your browser. You should see the LogWatch dashboard.

---

## Development Setup (Full)

For contributors and developers who want the complete development environment.

### Prerequisites

Ensure all tools are installed:

```bash
# Check versions
node --version    # v20.x or newer
pnpm --version    # 9.x or newer
python3 --version # 3.11 or newer
docker --version  # 24.x or newer
git --version     # 2.x
```

### Clone and Install Dependencies

```bash
git clone https://github.com/logwatch/logwatch.git
cd logwatch
pnpm install
```

### Start Infrastructure Services

```bash
docker compose up -d
```

Infrastructure services and their ports:

| Service | Port | Credentials |
|---------|------|------------|
| ClickHouse HTTP | 8123 | user: `default`, password: `clickhouse` |
| ClickHouse Native | 9000 | Same as above |
| PostgreSQL | 5432 | user: `logwatch`, password: `logwatch`, db: `logwatch` |
| Redis | 6379 | No password |

### Run Database Migrations

```bash
# PostgreSQL: tables, indexes, RLS policies, seed tenants
pnpm --filter @logwatch/db run migrate

# ClickHouse: DDL for otel_logs, otel_traces, metrics tables
pnpm --filter @logwatch/db run clickhouse:setup
```

### Set Up the Anomaly Engine

```bash
cd apps/anomaly-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt  # Includes pytest, mypy, ruff
```

### Configure Environment

```bash
cp .env.example .env
```

Complete `.env` for development:

```env
# PostgreSQL
DATABASE_URL=postgresql://logwatch:logwatch@localhost:5432/logwatch

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=observability
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=clickhouse

# Redis
REDIS_URL=redis://localhost:6379

# Auth
NEXTAUTH_SECRET=dev-secret-change-in-production-abc123
NEXTAUTH_URL=http://localhost:3000

# OAuth (optional for local dev — use email/password instead)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Claude API (optional — NL queries and RCA will be disabled without it)
ANTHROPIC_API_KEY=

# Anomaly engine
ANOMALY_ENGINE_URL=http://localhost:8001

# API server
PORT=4000
NODE_ENV=development
```

### Start All Services

Use separate terminals or a process manager like `concurrently`:

```bash
# Option A: Separate terminals
pnpm --filter @logwatch/api run dev          # Terminal 1 → :4000
cd apps/anomaly-engine && uvicorn src.main:app --reload --port 8001  # Terminal 2 → :8001
pnpm --filter @logwatch/web run dev          # Terminal 3 → :3000
```

### Running Tests

```bash
# All TypeScript tests (unit + integration)
pnpm test

# TypeScript tests in watch mode
pnpm test -- --watch

# Python anomaly engine tests
cd apps/anomaly-engine && pytest

# Python tests with coverage
cd apps/anomaly-engine && pytest --cov=src

# E2E tests (all services must be running)
pnpm --filter @logwatch/web run test:e2e

# Lint and type check
pnpm lint
pnpm typecheck
```

### Common Development Tasks

| Task | Command |
|------|---------|
| Create a new migration | `pnpm --filter @logwatch/db run migrate:create <name>` |
| Reset database | `pnpm --filter @logwatch/db run migrate:reset` |
| Build all packages | `pnpm build` |
| Lint all packages | `pnpm lint` |
| Type check all packages | `pnpm typecheck` |

---

## Production: Docker Compose

For single-server production deployments handling up to ~10K logs/sec.

### Step 1: Clone the Repository

```bash
git clone https://github.com/logwatch/logwatch.git
cd logwatch
```

### Step 2: Configure Environment

Create a `.env` file with production values:

```env
# Generate secure secrets
NEXTAUTH_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)

# PostgreSQL (change these passwords!)
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql://logwatch:<password>@postgres:5432/logwatch

# ClickHouse
CLICKHOUSE_PASSWORD=<strong-random-password>

# Redis
REDIS_PASSWORD=<strong-random-password>

# Claude API (optional)
ANTHROPIC_API_KEY=<your-key>

# Web UI URL (your domain)
NEXTAUTH_URL=https://logwatch.yourdomain.com

# OAuth provider (configure at least one)
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
```

### Step 3: Build and Start

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

This starts all services:

| Service | Internal Port | External Port | Description |
|---------|-------------|---------------|-------------|
| `api` | 4000 | 4000 | Fastify API server |
| `anomaly-engine` | 8000 | 8000 | Python ML service |
| `web` | 3000 | 3000 | Next.js dashboard |
| `postgres` | 5432 | 5432 | PostgreSQL |
| `clickhouse` | 8123, 9000 | 8123, 9000 | ClickHouse |
| `redis` | 6379 | 6379 | Redis |

### Step 4: Run Migrations

```bash
# Wait for database services to be ready
docker compose -f docker-compose.prod.yml exec api pnpm --filter @logwatch/db run migrate
docker compose -f docker-compose.prod.yml exec api pnpm --filter @logwatch/db run clickhouse:setup
```

### Step 5: Configure Reverse Proxy

Place a reverse proxy (Nginx, Caddy, or Traefik) in front of LogWatch for TLS termination and routing:

**Nginx example** (`/etc/nginx/sites-available/logwatch`):

```nginx
server {
    listen 443 ssl http2;
    server_name logwatch.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/logwatch.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/logwatch.yourdomain.com/privkey.pem;

    # Web UI
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for live tail)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Ingestion endpoints (higher body size limit)
    location /api/v1/ingest/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        client_max_body_size 10m;
    }
}
```

### Step 6: Verify

```bash
curl https://logwatch.yourdomain.com/api/v1/health
```

### Backup Strategy

| Data | How to Backup | Frequency |
|------|--------------|-----------|
| PostgreSQL | `pg_dump logwatch > backup.sql` | Daily |
| ClickHouse | `clickhouse-client -q "BACKUP TABLE otel_logs TO Disk('backups', 'otel_logs')"` | Daily |
| Redis | Not required (ephemeral buffer) | - |
| `.env` file | Copy to secure storage | On change |

### Log Rotation

Docker Compose logs grow unbounded by default. Add to `docker-compose.prod.yml`:

```yaml
services:
  api:
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
```

---

## Production: Kubernetes with Helm

For production deployments handling 10K+ logs/sec with high availability.

### Prerequisites

- Kubernetes 1.28+ cluster
- Helm 3.12+
- `kubectl` configured for your cluster
- Container registry access (to push LogWatch images)
- Persistent volume provisioner (for ClickHouse and PostgreSQL data)

### Step 1: Build and Push Docker Images

```bash
# From the logwatch/ directory
docker build -t your-registry/logwatch-api:0.1.0 -f apps/api/Dockerfile .
docker build -t your-registry/logwatch-anomaly-engine:0.1.0 -f apps/anomaly-engine/Dockerfile .
docker build -t your-registry/logwatch-web:0.1.0 -f apps/web/Dockerfile .

docker push your-registry/logwatch-api:0.1.0
docker push your-registry/logwatch-anomaly-engine:0.1.0
docker push your-registry/logwatch-web:0.1.0
```

### Step 2: Create Namespace and Secrets

```bash
kubectl create namespace logwatch

# Create secrets
kubectl -n logwatch create secret generic logwatch-secrets \
  --from-literal=database-url="postgresql://logwatch:<password>@logwatch-postgres:5432/logwatch" \
  --from-literal=redis-url="redis://logwatch-redis:6379" \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=nextauth-secret="$(openssl rand -base64 32)" \
  --from-literal=anthropic-api-key="<your-key>" \
  --from-literal=clickhouse-password="<password>"
```

### Step 3: Configure Helm Values

Create a `values-production.yaml`:

```yaml
api:
  replicaCount: 3
  image:
    repository: your-registry/logwatch-api
    tag: "0.1.0"
  port: 4000
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: "2"
      memory: 2Gi

anomalyEngine:
  replicaCount: 2
  image:
    repository: your-registry/logwatch-anomaly-engine
    tag: "0.1.0"
  port: 8000
  resources:
    requests:
      cpu: "1"
      memory: 2Gi
    limits:
      cpu: "4"
      memory: 8Gi
  # Uncomment for GPU-accelerated inference:
  # gpu:
  #   enabled: true
  #   count: 1

web:
  replicaCount: 2
  image:
    repository: your-registry/logwatch-web
    tag: "0.1.0"
  port: 3000

postgres:
  enabled: true
  auth:
    database: logwatch
    username: logwatch
    existingSecret: logwatch-secrets
  primary:
    persistence:
      size: 50Gi
      storageClass: fast-ssd

clickhouse:
  enabled: true
  persistence:
    size: 500Gi
    storageClass: fast-ssd
  resources:
    requests:
      cpu: "2"
      memory: 16Gi
    limits:
      cpu: "8"
      memory: 32Gi

redis:
  enabled: true
  architecture: standalone
  master:
    persistence:
      size: 2Gi
    resources:
      requests:
        memory: 1Gi

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/websocket-services: "logwatch-api"
  tls:
    - secretName: logwatch-tls
      hosts:
        - logwatch.yourdomain.com
  hosts:
    - host: logwatch.yourdomain.com
      paths:
        - path: /api
          service: api
        - path: /
          service: web
```

### Step 4: Install with Helm

```bash
helm install logwatch ./helm/logwatch \
  --namespace logwatch \
  --values values-production.yaml
```

### Step 5: Run Database Migrations

```bash
# Wait for pods to be ready
kubectl -n logwatch wait --for=condition=ready pod -l app.kubernetes.io/name=logwatch-api --timeout=120s

# Run migrations
kubectl -n logwatch exec deploy/logwatch-api -- pnpm --filter @logwatch/db run migrate
kubectl -n logwatch exec deploy/logwatch-api -- pnpm --filter @logwatch/db run clickhouse:setup
```

### Step 6: Verify

```bash
# Check pod status
kubectl -n logwatch get pods

# Check API health
kubectl -n logwatch port-forward svc/logwatch-api 4000:4000 &
curl http://localhost:4000/health

# Check ingress
curl https://logwatch.yourdomain.com/api/v1/health
```

### Scaling

```bash
# Scale API server horizontally
kubectl -n logwatch scale deployment logwatch-api --replicas=5

# Scale anomaly engine (each replica processes independently)
kubectl -n logwatch scale deployment logwatch-anomaly-engine --replicas=3

# Use HPA for automatic scaling
kubectl -n logwatch autoscale deployment logwatch-api \
  --min=2 --max=10 --cpu-percent=70
```

### Helm Upgrade

```bash
helm upgrade logwatch ./helm/logwatch \
  --namespace logwatch \
  --values values-production.yaml
```

---

## Connecting Your Services

Once LogWatch is running, connect your applications to send logs and traces.

### Option 1: OpenTelemetry Collector (Recommended)

The standard approach for cloud-native environments. Configure your existing OTel Collector to export to LogWatch:

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key_here"

service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
```

### Option 2: Fluent Bit

For environments already using Fluent Bit for log collection:

```ini
# fluent-bit.conf
[OUTPUT]
    Name        http
    Match       *
    Host        logwatch.yourdomain.com
    Port        443
    URI         /api/v1/ingest/json
    Format      json
    Header      X-API-Key lw_your_api_key_here
    Header      Content-Type application/json
    tls         On
```

### Option 3: Direct HTTP

For simple integrations or custom log shipping:

```bash
curl -X POST https://logwatch.yourdomain.com/api/v1/ingest/json \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lw_your_api_key_here" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-05-11T14:30:00.000Z",
        "severity": "ERROR",
        "body": "Connection refused: database-primary:5432",
        "service": "my-api",
        "attributes": {
          "environment": "production",
          "version": "v1.2.3"
        }
      }
    ]
  }'
```

### Option 4: Syslog (Legacy Systems)

For servers emitting syslog (RFC 5424 or RFC 3164):

```bash
# Forward syslog to LogWatch
# In rsyslog.conf or syslog-ng.conf:
*.* @@logwatch.yourdomain.com:1514
```

### CI/CD Deployment Tracking

Register deployments from your CI/CD pipeline so LogWatch can correlate anomalies with releases:

```bash
# In your deployment pipeline (GitHub Actions, GitLab CI, Jenkins, etc.)
curl -X POST https://logwatch.yourdomain.com/api/v1/deployments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lw_your_api_key_here" \
  -d '{
    "service": "payment-service",
    "version": "v2.3.1",
    "commit_sha": "'$GITHUB_SHA'",
    "deployer": "github-actions",
    "changelog": "Updated Redis connection pool configuration"
  }'
```

---

## Post-Installation Checklist

After LogWatch is running, complete these steps to ensure full functionality:

### Required

- [ ] **Verify API health**: `curl <logwatch-url>/api/v1/health` returns all components `ok`
- [ ] **Create first tenant**: Set up your organisation as a tenant via the web UI or API
- [ ] **Create API key**: Generate an ingestion API key for your services (Settings > API Keys)
- [ ] **Connect first service**: Configure at least one service to send logs (see above)
- [ ] **Verify log ingestion**: Send a test log and confirm it appears in the Logs page

### Recommended

- [ ] **Configure OAuth provider**: Set up Google or GitHub OAuth for team login (Settings > Auth)
- [ ] **Set up Slack notifications**: Add a Slack webhook as a notification channel (Alerts > Channels)
- [ ] **Configure PagerDuty**: Add PagerDuty integration for critical alerts
- [ ] **Create first alert rule**: Set up an anomaly-based alert rule
- [ ] **Configure redaction rules**: Enable built-in patterns for credit cards, emails, tokens (Settings > Redaction)
- [ ] **Set retention policy**: Adjust log/trace retention to match your needs (Settings > Retention)

### Optional

- [ ] **Add Anthropic API key**: Enable natural-language queries and root-cause analysis
- [ ] **Register CI/CD webhook**: Send deployment events for root-cause correlation
- [ ] **Set up monitoring**: Point Prometheus at LogWatch's `/metrics` endpoint
- [ ] **Configure backups**: Set up daily PostgreSQL and ClickHouse backups
- [ ] **Enable TLS**: Configure reverse proxy with TLS certificates

---

## Upgrading

### Docker Compose

```bash
cd logwatch
git pull origin main

# Rebuild images
docker compose -f docker-compose.prod.yml build

# Apply database migrations
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @logwatch/db run migrate

# Restart with new images
docker compose -f docker-compose.prod.yml up -d
```

### Kubernetes / Helm

```bash
cd logwatch
git pull origin main

# Build and push new images
docker build -t your-registry/logwatch-api:0.2.0 -f apps/api/Dockerfile .
docker build -t your-registry/logwatch-anomaly-engine:0.2.0 -f apps/anomaly-engine/Dockerfile .
docker build -t your-registry/logwatch-web:0.2.0 -f apps/web/Dockerfile .
docker push your-registry/logwatch-api:0.2.0
docker push your-registry/logwatch-anomaly-engine:0.2.0
docker push your-registry/logwatch-web:0.2.0

# Update values-production.yaml with new tag: "0.2.0"

# Run Helm upgrade
helm upgrade logwatch ./helm/logwatch \
  --namespace logwatch \
  --values values-production.yaml

# Run any new migrations
kubectl -n logwatch exec deploy/logwatch-api -- pnpm --filter @logwatch/db run migrate
```

### Breaking Changes

Always check the [CHANGELOG](../CHANGELOG.md) before upgrading. Breaking changes will be clearly marked with migration instructions.

---

## Uninstalling

### Docker Compose

```bash
# Stop all services
docker compose -f docker-compose.prod.yml down

# Remove all data (DESTRUCTIVE)
docker compose -f docker-compose.prod.yml down -v
```

### Kubernetes / Helm

```bash
# Remove LogWatch
helm uninstall logwatch --namespace logwatch

# Remove persistent volumes (DESTRUCTIVE)
kubectl -n logwatch delete pvc --all

# Remove namespace
kubectl delete namespace logwatch
```
