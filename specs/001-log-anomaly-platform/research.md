# Research: Log Aggregation & Anomaly Detection Platform

**Branch**: `001-log-anomaly-platform` | **Date**: 2026-05-11

## Technology Decisions

### 1. Data Architecture: Hybrid ClickHouse + PostgreSQL

**Decision**: Use ClickHouse for telemetry storage (logs, traces) and PostgreSQL for operational data (users, tenants, alerts, anomalies, config).

**Rationale**: This is the SigNoz/ClickStack-proven architecture for observability platforms. ClickHouse achieves 10-20x compression over PostgreSQL on log data through columnar encoding (LZ4, ZSTD, delta encoding) and sustains millions of inserts/second. PostgreSQL provides ACID transactions, foreign key constraints, and row-level security for multi-tenant operational data. Neither engine is asked to do something it wasn't designed for.

**Alternatives considered**:
- **Data Model 1 (PostgreSQL-only)**: Simpler operations but caps at ~50K rows/sec ingestion. Full-text search over billions of rows is 10-100x slower than ClickHouse. Rejected because the spec requires 100K logs/sec sustained (SC-006).
- **Data Model 3 (Event-Sourced CQRS)**: Excellent for compliance audit trails but adds significant implementation complexity (projections, snapshots, event versioning). The platform's audit needs are satisfied by a simpler audit_log table. Rejected for unnecessary complexity.
- **Data Model 4 (Graph-Relational)**: Knowledge graph for root-cause traversal is compelling but adds a third conceptual layer. PostgreSQL recursive CTEs handle service dependency graphs adequately for topologies under 500 services. Rejected for initial release; graph layer can be added later if needed.

### 2. API Framework: Fastify

**Decision**: Use Fastify as the Node.js API framework.

**Rationale**: Highest-throughput Node.js framework (benchmarks show 2-3x over Express). Native JSON schema validation eliminates runtime type-checking overhead. Plugin architecture allows modular registration of ingestion endpoints (OTLP, syslog, HTTP JSON). Built-in support for request/reply hooks aligns with the tenant context injection pattern (setting `app.current_tenant` per request).

**Alternatives considered**:
- **Express**: Slower throughput, less structured plugin model. Rejected for performance.
- **NestJS**: Heavier abstraction layer with decorators and DI container. Rejected for unnecessary complexity at this stage.
- **Hono**: Lightweight and fast but smaller ecosystem and less battle-tested for production observability workloads. Rejected for ecosystem maturity.

### 3. Anomaly Detection: Python Microservice (FastAPI)

**Decision**: Separate Python microservice for ML workloads, communicating via Redis Streams and HTTP.

**Rationale**: Python has the only mature ecosystem for LogBERT (transformers/PyTorch), statistical anomaly detection (scikit-learn), and LLM integration. Running ML inference in Node.js would require ONNX runtime bindings with limited model support. A separate microservice allows independent scaling of ML compute and independent deployment of model updates.

**Alternatives considered**:
- **Node.js with ONNX Runtime**: Limited model format support, no native PyTorch. Rejected for ecosystem limitations.
- **Go microservice with Python bindings**: Adds CGo complexity without meaningful throughput benefit for batch inference workloads. Rejected for complexity.
- **Embedded Python in Node.js (child_process)**: Fragile, hard to scale, no isolation. Rejected for operational concerns.

### 4. Anomaly Detection Approach: Two-Phase (Statistical + AI)

**Decision**: Statistical detection during 7-day learning period, then full LogBERT-based contextual detection after baseline established.

**Rationale**: Per spec clarification, new services need immediate (if less sophisticated) detection. Statistical methods (z-score on error rates, volume spike detection) work with minimal data. LogBERT requires sufficient training samples to learn service-specific patterns. The two-phase approach provides day-one value while building toward the platform's differentiating contextual detection.

**Alternatives considered**:
- **Global baseline model from day one**: Requires a large pre-trained model and risks high false-positive rates for services with unusual patterns. Rejected for accuracy concerns.
- **No detection until baseline**: Leaves users without any anomaly detection for 7 days. Rejected per spec clarification (Q2, session 2).

### 5. Frontend: Next.js 15 (App Router)

**Decision**: Use Next.js 15 with App Router for the web frontend.

**Rationale**: Server components enable SSR for dashboard pages (faster initial load). React ecosystem provides the interactive components needed for log explorer, trace timeline, and live tail. Tailwind CSS enables rapid UI development. Next.js API routes serve as an auth proxy between the browser and the Fastify API.

**Alternatives considered**:
- **Vite + React SPA**: No SSR benefits; API proxy requires separate configuration. Rejected for missing SSR.
- **Remix**: Smaller ecosystem, less community tooling for dashboard-heavy applications. Rejected for ecosystem size.
- **Grafana Plugin**: Would leverage existing Grafana deployments but constrains the UI to Grafana's plugin framework, limiting the anomaly detection and NL query UX. Rejected for UX flexibility.

### 6. Ingestion Buffering: Redis Streams

**Decision**: Use Redis Streams for ingestion buffering between the API server and ClickHouse batch inserts.

**Rationale**: Redis Streams provides ordered, persistent message delivery with consumer groups — sufficient for ingestion buffering at 100K msgs/sec. It also serves as the job queue for anomaly detection (the Python service consumes from a Redis Stream). Avoids the operational complexity of Kafka for initial scale.

**Alternatives considered**:
- **Apache Kafka**: Production-grade streaming but requires ZooKeeper/KRaft, topic management, and partition tuning. Overkill for initial scale. Can be adopted later if Redis Streams becomes a bottleneck.
- **In-process buffer (array)**: No durability — data loss on API server crash. Rejected for violating the no-data-loss requirement (FR-041).
- **RabbitMQ**: Mature but Redis already required for other uses (caching, rate limiting). Adding RabbitMQ means two message systems. Rejected for operational simplicity.

### 7. Real-Time Streaming: Server-Sent Events (SSE)

**Decision**: Use SSE for live tail log streaming and real-time alert notifications.

**Rationale**: SSE is natively supported by all browsers, works over HTTP/2 with multiplexing, and is simpler than WebSocket for unidirectional data flows. The live tail is a read-only stream from server to client — SSE fits perfectly. Fastify has built-in SSE support via reply.sse().

**Alternatives considered**:
- **WebSocket**: Bidirectional capability unused for live tail. More complex connection management (ping/pong, reconnection). Rejected for unnecessary complexity.
- **Long polling**: Higher latency and server load. Rejected for performance.

### 8. Authentication: OAuth 2.0 + OIDC via NextAuth.js

**Decision**: Use NextAuth.js for OAuth 2.0 / OIDC authentication in the web frontend, with JWT-based API authentication for programmatic access.

**Rationale**: NextAuth.js provides turnkey integration with Google, GitHub, and SAML identity providers. JWT tokens carry tenant_id and role claims, enabling stateless API authentication. API keys (hashed, scoped) provide programmatic access for CI/CD pipelines and CLI tools.

**Alternatives considered**:
- **Custom OAuth implementation**: High effort, security risk. Rejected for security.
- **Keycloak**: Full-featured but adds another service to operate. Rejected for operational complexity at initial scale.
- **Clerk/Auth0**: SaaS dependency for a self-hosted platform. Rejected for self-hosted requirement.

### 9. LLM Integration: Claude API (Anthropic)

**Decision**: Use Claude API for natural-language query translation, root-cause narrative generation, and adaptive threshold explanation.

**Rationale**: Claude's prompt caching reduces cost for repeated context patterns (service baselines, log schema context). Structured output mode ensures reliable JSON responses for query translation. Tool use enables the LLM to call platform APIs (search logs, fetch traces) during root-cause analysis.

**Alternatives considered**:
- **OpenAI GPT-4**: Comparable capability but no prompt caching equivalent for cost efficiency. Viable alternative.
- **Self-hosted LLM (Llama)**: Requires GPU infrastructure, model management, and fine-tuning. Rejected for operational complexity.
- **No LLM (rule-based)**: Cannot achieve natural-language querying or narrative root-cause reports. Rejected as it eliminates core differentiators.

### 10. Full-Text Search: ClickHouse Token Bloom Filter

**Decision**: Use ClickHouse's `tokenbf_v1` index on log body for full-text search, rather than a separate search engine.

**Rationale**: Token bloom filter indexes eliminate 99%+ of irrelevant granules before scanning, providing sub-second search over billions of log lines. This avoids the operational complexity of maintaining Elasticsearch alongside ClickHouse. The small false-positive rate of bloom filters is acceptable — results are post-filtered for exactness.

**Alternatives considered**:
- **Elasticsearch sidecar**: Powerful inverted index but doubles storage cost and adds operational complexity (index lifecycle management, shard tuning). Rejected for cost and complexity.
- **ClickHouse `ngrambf_v1`**: N-gram bloom filter is better for substring search but has higher false-positive rates and larger index size. Token-level search is sufficient for log investigation workflows. Rejected for efficiency.

### 11. Sensitive Data Handling: Ingestion-Time Redaction

**Decision**: Apply regex-based redaction rules at ingestion time, before data reaches persistent storage.

**Rationale**: Per spec clarification, the platform provides configurable per-tenant redaction rules plus built-in patterns for common sensitive data (credit cards, emails, bearer tokens). Redacting at ingestion ensures sensitive data never reaches ClickHouse — no retroactive scrubbing needed.

**Alternatives considered**:
- **Query-time masking**: Data stored unredacted; masked on read. Rejected because sensitive data would exist in storage, violating compliance requirements.
- **Sender-side redaction**: Requires every application to implement redaction. Rejected because it's unreliable and shifts burden to every team.

## Resolved Clarifications

All NEEDS CLARIFICATION items from the Technical Context are resolved:

| Item | Resolution | Source |
| ---- | ---------- | ------ |
| Deployment tracking | Dedicated webhook/API endpoint for CI/CD pipelines | Spec clarification Q1, session 1 |
| Metrics scope | Derived from logs/traces only; no Prometheus ingestion in v1 | Spec clarification Q2, session 1 |
| Backpressure behavior | HTTP 429/503 under overload; no silent data loss | Spec clarification Q3, session 1 |
| Sensitive data handling | Configurable per-tenant redaction at ingestion time | Spec clarification Q4, session 1 |
| RBAC role permissions | Viewer (read-only), Editor (+alerts/channels/sampling), Admin (+users/keys/retention) | Spec clarification Q5, session 1 |
| Malformed log handling | Best-effort normalization; fill defaults, truncate oversized | Spec clarification Q1, session 2 |
| New service anomaly detection | Statistical detection during learning period, full AI after 7 days | Spec clarification Q2, session 2 |
