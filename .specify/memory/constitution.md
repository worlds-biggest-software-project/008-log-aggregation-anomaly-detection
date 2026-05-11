<!--
  Sync Impact Report
  ==================
  Version change: N/A (template) → 1.0.0 (initial ratification)
  Modified principles: None (all new)
  Added sections:
    - Core Principles (5 principles)
    - Performance & Scale Standards
    - Development Workflow & Quality Gates
    - Governance
  Removed sections: None
  Templates requiring updates:
    - .specify/templates/plan-template.md — ✅ No update needed (Constitution Check section is generic)
    - .specify/templates/spec-template.md — ✅ No update needed (template is principle-agnostic)
    - .specify/templates/tasks-template.md — ✅ No update needed (task structure is generic)
  Follow-up TODOs: None
-->

# LogWatch Platform Constitution

## Core Principles

### I. Data Integrity First

The platform MUST NOT silently discard telemetry data under any
operational condition. When the system cannot accept data at the
offered rate, it MUST apply backpressure (HTTP 429 or 503) so that
senders can retry. In-memory buffering bridges transient storage
outages; when buffers are exhausted, backpressure is the only
acceptable response. Ingestion endpoints MUST sustain 99.9% monthly
availability (SC-010).

This principle supersedes throughput optimization: it is always
preferable to slow down than to lose records.

### II. Tenant Isolation

Every data path — storage, query, configuration, and API — MUST
enforce complete tenant isolation. PostgreSQL tables MUST use
row-level security (RLS) with `app.current_tenant` set per request.
ClickHouse tables MUST partition by `tenant_id` and every query MUST
include a `tenant_id` filter. No API endpoint may return data
belonging to a different tenant, regardless of authentication method
or role.

Cross-tenant data leakage is treated as a security incident, not a
bug.

### III. Standards Native

The platform builds on open standards, not around them:

- **OpenTelemetry**: OTLP is the primary ingestion protocol; the log
  and trace data models map 1:1 to OTel semantic conventions.
- **W3C Trace Context**: `trace_id` and `span_id` provide log-to-trace
  correlation with zero additional configuration.
- **OCSF**: Security events use OCSF class/category/activity IDs for
  normalized correlation (deferred to post-v1 but schema is ready).
- **RFC 5424/3164**: Syslog ingestion normalizes to the unified model.

When a standard exists for a capability, the platform MUST adopt it
rather than inventing a proprietary alternative.

### IV. Progressive Intelligence

The anomaly detection system MUST provide value from day one.
Services with fewer than 7 days of data receive statistical detection
(volume spikes, error rate changes). After the 7-day baseline is
established, the system transitions to full AI-powered contextual
detection (LogBERT + LLM reasoning). Users MUST be informed of the
current detection mode ("learning" vs. "baseline established").

Detection quality improves over time through user feedback (FR-017)
and adaptive baseline recalculation. The system MUST NOT require
manual threshold configuration as a prerequisite for anomaly
detection.

### V. Privacy by Design

Sensitive data MUST be redacted at ingestion time, before it reaches
persistent storage. Each tenant has configurable redaction rules plus
built-in patterns for common sensitive data types (credit cards,
emails, bearer tokens). Once data passes through the redaction
pipeline, the platform guarantees that the original sensitive values
do not exist in any persistent store (ClickHouse or PostgreSQL).

Query-time masking is not an acceptable alternative: if sensitive data
reaches storage, compliance is already violated.

## Performance & Scale Standards

These are hard constraints, not aspirational targets:

| Metric | Target | Spec Reference |
| ------ | ------ | -------------- |
| Sustained ingestion throughput | ≥ 100,000 logs/sec per tenant | SC-006 |
| Full-text search latency (7-day window) | < 1 second | SC-007 |
| Anomaly detection latency | ≤ 5 minutes from pattern emergence | SC-003 |
| Alert notification delivery | ≤ 60 seconds from detection | SC-008 |
| Ingestion endpoint availability | ≥ 99.9% monthly | SC-010 |
| Anomaly false-positive rate (after 14-day baseline) | < 15% | SC-002 |

New features or architectural changes that degrade any of these
metrics below their targets MUST NOT be merged without a documented
justification and a remediation plan.

## Development Workflow & Quality Gates

**Monorepo structure**: pnpm workspace with four apps (`api`,
`anomaly-engine`, `web`, `cli`) and three shared packages (`shared`,
`db`, `test-utils`). Cross-package dependencies use workspace
protocol references.

**Testing strategy**:

- TypeScript: Vitest for unit and integration tests
- Python: pytest for anomaly engine tests
- E2E: Playwright for web UI flows
- All ingestion and query paths MUST have integration tests that run
  against real ClickHouse and PostgreSQL instances (not mocks)

**Quality gates for merge**:

- All tests pass
- Type checking passes (`pnpm typecheck`)
- Linting passes (`pnpm lint`)
- No new security vulnerabilities in dependencies
- Constitution principles are not violated (reviewer responsibility)

**Database changes**:

- PostgreSQL schema changes MUST use versioned migrations
- ClickHouse DDL changes MUST be documented in the `db` package
- RLS policies MUST be verified for every new PostgreSQL table

## Governance

This constitution defines the non-negotiable principles for the
LogWatch platform. All code reviews, design decisions, and
architectural proposals MUST be evaluated against these principles.

**Amendment process**:

1. Propose the change with rationale in a PR description
2. Version bump follows semantic versioning:
   - MAJOR: Principle removed or fundamentally redefined
   - MINOR: New principle added or existing principle materially expanded
   - PATCH: Clarification, wording fix, non-semantic refinement
3. All active contributors MUST be notified of MAJOR/MINOR changes
4. Updated constitution MUST be propagated to dependent templates

**Compliance review**: The Constitution Check section in every
implementation plan (`plan.md`) MUST validate compliance with all
principles before Phase 0 research begins and again after Phase 1
design completes.

**Version**: 1.0.0 | **Ratified**: 2026-05-11 | **Last Amended**: 2026-05-11
