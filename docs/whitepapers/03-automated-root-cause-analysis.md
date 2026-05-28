# From Anomaly to Answer in 60 Seconds: How AI-Automated Root-Cause Analysis Works

**LogWatch Whitepaper** | May 2026

---

## Executive Summary

When a production incident occurs, the clock starts. Mean time to detect (MTTD) has improved dramatically with modern monitoring tools, but mean time to resolve (MTTR) has remained stubbornly high. Industry benchmarks consistently report MTTR of 1-4 hours for severity-1 incidents, with the majority of that time spent on investigation: correlating logs across services, inspecting distributed traces, checking deployment history, and building a mental model of what went wrong.

This whitepaper presents LogWatch's automated root-cause analysis (RCA) system: an AI pipeline that assembles evidence from logs, distributed traces, deployment events, and service dependencies, then generates a plain-language narrative explaining the probable cause of an anomaly --- complete with confidence scoring and cited evidence.

The goal is not to replace human judgment, but to compress the investigation phase from hours to seconds, giving incident responders a head start that accelerates resolution.

---

## The Investigation Bottleneck

### What Happens After an Alert

When an on-call engineer receives a production alert, the investigation typically follows this sequence:

1. **Triage** (2-5 minutes): Open the observability dashboard. Identify the affected service. Read the error messages. Assess severity.

2. **Log correlation** (10-30 minutes): Search for related errors across upstream and downstream services. Filter by time window, severity, and trace ID. Identify which errors are symptoms and which are root causes.

3. **Trace inspection** (10-20 minutes): Find distributed traces that include the affected service. Walk the trace timeline to identify where failures originated. Examine span durations for latency anomalies.

4. **Deployment check** (5-15 minutes): Check deployment history for the affected service and its dependencies. Compare the anomaly start time with recent deployment timestamps. Review changelogs for relevant changes.

5. **Hypothesis formation** (10-30 minutes): Synthesise findings into a probable cause. Test the hypothesis against available evidence. If the first hypothesis doesn't hold, iterate.

6. **Remediation** (variable): Apply the fix --- rollback, config change, scaling, or code patch.

Steps 2-5 are the investigation phase, consuming 35-95 minutes of skilled engineering time. This phase requires expertise in the query language, familiarity with the service architecture, and the ability to hold multiple data sources in working memory simultaneously.

### Why Investigation Takes So Long

The investigation bottleneck persists because existing tools present *data* without providing *analysis*:

- **Log search** returns matching records but does not explain why they matter or how they relate to each other
- **Trace viewers** display span timelines but do not highlight which spans are anomalous relative to baselines
- **Deployment dashboards** show what was deployed but do not correlate deployments with observed failures
- **Alert systems** tell you something is wrong but not why

The engineer must manually stitch these signals together, context-switching between tools (or tabs within a tool), applying domain knowledge about service dependencies and normal behaviour, and reasoning about temporal correlations. This is fundamentally a *reasoning task* --- exactly the kind of work that large language models excel at.

---

## LogWatch's Root-Cause Analysis Pipeline

LogWatch automates the investigation phase by assembling evidence from all available signals and applying LLM reasoning to produce a structured, cited root-cause narrative.

### When RCA Reports Are Generated

RCA reports are generated automatically when:
- An anomaly is classified as **critical** severity by the three-layer detection system
- A user manually requests a report ("Generate Report" button on any anomaly)

### The Evidence Assembly Pipeline

The RCA pipeline operates in four stages:

#### Stage 1: Anomaly Context Collection

Starting from the detected anomaly, the pipeline collects:

- **Anomalous log records**: The specific log messages that triggered the anomaly detection, including timestamps, severity, body text, and attributes
- **Anomaly metadata**: Type (volume spike, novel pattern, error rate change, latency anomaly), severity score, affected service, and time window
- **Baseline comparison**: Current metric values vs. historical baseline (mean, standard deviation, percentiles, hourly/day-of-week patterns)

#### Stage 2: Trace Correlation

The pipeline queries ClickHouse for distributed traces that pass through the affected service during the anomaly window:

- **Trace retrieval**: All traces containing spans from the affected service where the span's `start_time` falls within the anomaly window
- **Error trace identification**: Traces where the affected service's spans have `status_code = ERROR`
- **Latency anomaly identification**: Traces where span durations exceed the baseline p95 for that operation
- **Upstream root identification**: For each error trace, walk the span tree upward to find the *earliest* span with an error status --- this is often the true root cause, with downstream errors being symptoms

Example trace analysis:

```
Trace: abc-123-def
  ├─ api-gateway (200ms, OK)
  │   └─ payment-service (TIMEOUT after 5000ms, ERROR)  ← symptom
  │       └─ redis-cache (TIMEOUT after 4800ms, ERROR)  ← root cause
  └─ notification-service (skipped, ERROR)               ← downstream impact
```

The pipeline identifies `redis-cache` as the earliest failure point, not `payment-service`.

#### Stage 3: Deployment Correlation

The pipeline queries PostgreSQL for recent deployment events:

- **Affected service deployments**: Any deployment to the affected service within 24 hours before the anomaly started
- **Dependency deployments**: Any deployment to services in the affected service's dependency graph within the same window
- **Temporal correlation score**: How closely the deployment timestamp aligns with the anomaly onset. A deployment 3 minutes before the first anomalous log is strongly correlated; a deployment 18 hours before is weakly correlated.
- **Changelog analysis**: If the deployment record includes a changelog or commit SHA, the pipeline retrieves it for inclusion in the LLM context

#### Stage 4: Service Dependency Context

The pipeline examines the service dependency graph:

- **Upstream services**: Services that the affected service calls. Are any of them also experiencing anomalies?
- **Downstream services**: Services that call the affected service. Are they showing elevated error rates as a cascade effect?
- **Shared dependencies**: Services that share a common dependency with the affected service (e.g., the same database, cache, or message queue). Are they also affected?

This stage identifies whether the anomaly is:
- **Localised**: Only the affected service shows problems (likely a code or configuration issue)
- **Upstream-propagated**: An upstream dependency is the true source (the affected service is a victim)
- **Infrastructure-wide**: Multiple unrelated services show problems simultaneously (likely a shared infrastructure issue)

### Report Generation

All evidence is assembled into a structured context document and submitted to the Claude API with a carefully engineered system prompt. The prompt instructs the LLM to:

1. **Identify the most probable root cause** based on the evidence
2. **Assign a confidence score** (0-100%) reflecting the strength of the evidence
3. **Cite specific evidence** for every claim (log messages, trace IDs, deployment versions, metric values)
4. **Structure the output** as a narrative suitable for an incident review or post-mortem
5. **List alternative hypotheses** if the evidence is ambiguous
6. **Recommend immediate actions** (rollback, scale, investigate further)

### Report Structure

Every RCA report follows a consistent structure:

```
SUMMARY
  One-paragraph narrative explaining what happened, when, and why.

PROBABLE CAUSE
  The specific technical cause with cited evidence.

CONFIDENCE
  0-100% score with explanation of what would increase confidence.

EVIDENCE CHAIN
  1. Log Evidence: specific log patterns with timestamps
  2. Trace Evidence: trace IDs showing the failure path
  3. Deployment Evidence: deployment events with temporal correlation
  4. Dependency Evidence: upstream/downstream impact analysis
  5. Baseline Evidence: metric deviations from historical norms

ALTERNATIVE HYPOTHESES
  Other possible explanations that could not be ruled out.

RECOMMENDED ACTIONS
  Immediate steps to mitigate or resolve.

TIMELINE
  Chronological sequence of events from earliest signal to detection.
```

---

## Example: A Real-World RCA Report

### Scenario

At 14:33 UTC, LogWatch detects a critical anomaly in `payment-service`: a novel `SocketTimeoutException` pattern at a stack frame never seen before, with error rate jumping from 0.1% to 8.7%.

### Generated Report

> **Summary**
>
> The `payment-service` experienced a critical failure starting at 14:33 UTC on 2026-05-11, with error rate rising from 0.1% to 8.7% over 5 minutes. The root cause is deployment v2.3.1, deployed at 14:30 UTC, which reduced the Redis connection pool size from 20 to 5 connections. Under normal request load (~2,000 req/sec), the reduced pool became saturated, causing `SocketTimeoutException` errors for 87% of Redis operations. Downstream services `checkout-service` and `notification-service` experienced cascading failures.
>
> **Probable Cause**
>
> Deployment v2.3.1 to `payment-service` (deployed at 14:30:12 UTC by `ci-pipeline`, commit `a7f3c2d`) changed the Redis client configuration. The deployment changelog states: "Optimise Redis connection management." The connection pool size was reduced from 20 to 5 connections (confirmed by log attribute `redis.pool.size=5` in post-deployment logs vs. `redis.pool.size=20` in pre-deployment logs).
>
> At the observed request rate of ~2,000/sec, each request performs 1-3 Redis operations (session lookup, cart retrieval, rate limiting). With 5 connections and ~2ms average Redis round-trip time, the pool can sustain approximately 2,500 Redis ops/sec. The actual demand of ~4,000 ops/sec exceeds capacity by 60%, causing connection wait timeouts.
>
> **Confidence: 92%**
>
> High confidence due to: (1) strong temporal correlation between deployment and anomaly onset (3 minutes), (2) novel error pattern never seen before in this service, (3) deployment changelog directly references the affected component, (4) supporting latency data from traces confirms connection pool saturation.
>
> **Evidence Chain**
>
> 1. **Log Evidence**: 1,247 `SocketTimeoutException` records in `payment-service` between 14:33 and 14:38 UTC. Template: `SocketTimeoutException: Unable to acquire connection from pool within 5000ms`. This template has never appeared in `payment-service` baseline data (14 days).
>
> 2. **Trace Evidence**: Trace `t-8a7f3b2c` shows `payment-service` → `redis-cache` span with duration 5,002ms (timeout), vs. baseline p99 of 8ms. 94% of traces through `payment-service` during the window show similar Redis timeout spans.
>
> 3. **Deployment Evidence**: Deployment v2.3.1 registered at 14:30:12 UTC, 2 minutes 48 seconds before first anomalous log. No other deployments to `payment-service` or its dependencies in the preceding 48 hours.
>
> 4. **Dependency Evidence**: `checkout-service` error rate rose from 0.2% to 6.1% starting at 14:34 UTC (1 minute after `payment-service`). `notification-service` error rate rose from 0.1% to 3.8% starting at 14:35 UTC. Both services depend on `payment-service`. No anomalies in services that do not depend on `payment-service`.
>
> 5. **Baseline Evidence**: `payment-service` error rate baseline: mean 0.12%, stddev 0.04%. Current: 8.7%. Z-score: 214. Redis p99 latency baseline: 8ms. Current: 5,002ms.
>
> **Alternative Hypotheses**
>
> - Redis infrastructure issue (rejected: `redis-cache` health checks pass; other services using the same Redis instance are unaffected)
> - Network partition (rejected: only Redis operations are timing out; other external calls from `payment-service` are normal)
>
> **Recommended Actions**
>
> 1. **Immediate**: Roll back `payment-service` to v2.3.0 to restore the 20-connection pool
> 2. **Follow-up**: Review the connection pool sizing in v2.3.1; load-test with production-equivalent traffic before redeployment
> 3. **Prevention**: Add a performance regression test for Redis connection pool capacity under expected load
>
> **Timeline**
>
> | Time (UTC) | Event |
> |-----------|-------|
> | 14:30:12 | Deployment v2.3.1 applied to `payment-service` |
> | 14:30:15 | First log with `redis.pool.size=5` attribute |
> | 14:33:00 | First `SocketTimeoutException` (connection pool saturated) |
> | 14:33:30 | Error rate exceeds statistical threshold (Layer 1) |
> | 14:33:45 | LogBERT identifies novel error template (Layer 2) |
> | 14:34:00 | Cascading errors begin in `checkout-service` |
> | 14:34:15 | LLM analysis confirms critical severity (Layer 3) |
> | 14:34:20 | RCA report generation initiated |
> | 14:35:00 | `notification-service` cascading errors begin |
> | 14:35:30 | **RCA report available** (65 seconds after first anomalous log) |
> | 14:35:45 | Alert sent to PagerDuty and #incidents Slack channel |

### Time to Insight

Without automated RCA, this investigation would typically take 30-60 minutes:
- 10 minutes searching logs across three services
- 10 minutes inspecting traces to identify the Redis timeout pattern
- 5 minutes checking deployment history
- 10 minutes correlating the deployment changelog with the failure
- 5-10 minutes confirming the hypothesis by examining connection pool metrics

With LogWatch's automated RCA: **65 seconds** from first anomalous log to complete report with cited evidence, probable cause, and recommended actions.

---

## Technical Architecture

### Evidence Graph

The RCA pipeline internally constructs an evidence graph that links all signals:

```
                    ┌─────────────────┐
                    │    Anomaly      │
                    │ (entry point)   │
                    └───────┬─────────┘
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌───────────┐ ┌──────────┐ ┌───────────┐
        │   Logs    │ │  Traces  │ │Deployments│
        │ (sample   │ │ (error   │ │ (temporal  │
        │  records) │ │  paths)  │ │  corr.)   │
        └─────┬─────┘ └────┬─────┘ └─────┬─────┘
              │             │             │
              ▼             ▼             ▼
        ┌─────────────────────────────────────┐
        │        Service Dependency Graph      │
        │  (upstream propagation analysis)     │
        └─────────────────┬───────────────────┘
                          ▼
        ┌─────────────────────────────────────┐
        │    LLM Reasoning (Claude API)        │
        │  - Synthesise evidence               │
        │  - Identify probable cause           │
        │  - Score confidence                  │
        │  - Generate narrative                │
        └─────────────────────────────────────┘
```

### Data Sources and Query Patterns

| Evidence Type | Source | Query Pattern |
|--------------|--------|---------------|
| Anomalous logs | ClickHouse `otel_logs` | Window query by service + time range + severity |
| Baseline comparison | PostgreSQL `anomaly_baselines` | Lookup by service + metric name |
| Error traces | ClickHouse `otel_traces` | Join on service name + time range, filter status=ERROR |
| Trace tree walk | ClickHouse `otel_traces` | Recursive parent_span_id traversal |
| Recent deployments | PostgreSQL `deployments` | Service ID + 24h window before anomaly |
| Dependency graph | PostgreSQL `service_dependencies` | Traverse source/target from affected service |
| Prior anomalies | PostgreSQL `anomalies` | Service ID + recent history |

### Performance Characteristics

| Stage | Typical Duration | Bound By |
|-------|-----------------|----------|
| Evidence assembly (Stages 1-4) | 5-15 seconds | ClickHouse trace query complexity |
| LLM report generation | 10-30 seconds | Claude API response time |
| Total end-to-end | 15-45 seconds | - |

Reports are generated asynchronously. The anomaly alert fires immediately; the RCA report becomes available shortly after and is linked from the anomaly detail page.

---

## Confidence Scoring

The confidence score reflects the strength and consistency of available evidence:

| Evidence Factor | Weight | High Score When |
|----------------|--------|----------------|
| Temporal correlation with deployment | 30% | Deployment within 10 minutes of anomaly onset |
| Novel error pattern (LogBERT) | 25% | Template never seen before in this service |
| Trace evidence of failure path | 20% | Clear upstream root identified in trace tree |
| Dependency cascade pattern | 15% | Downstream services affected in temporal sequence |
| Baseline deviation magnitude | 10% | Z-score > 10 for affected metrics |

Scores below 50% indicate ambiguous evidence. The report will list multiple alternative hypotheses and recommend further investigation rather than proposing a single root cause.

### Improving Confidence Over Time

The RCA system improves through two feedback mechanisms:

1. **User ratings**: Engineers rate reports as "Helpful" or "Not Helpful" with optional notes. Unhelpful ratings are analysed to identify systematic weaknesses (e.g., insufficient deployment data, missing dependency edges).

2. **Evidence gap identification**: When confidence is low, the report identifies what additional data would increase it. For example: "Confidence would increase to ~85% if deployment changelogs included the specific configuration changes made."

---

## Limitations and Transparency

LogWatch's RCA system is designed for transparency about its limitations:

**What it can identify**:
- Code and configuration changes introduced by deployments
- Upstream dependency failures propagating through the service graph
- Infrastructure issues affecting multiple services simultaneously
- Capacity issues (pool exhaustion, memory pressure, disk space) evidenced in log patterns

**What it cannot identify**:
- Issues that leave no trace in logs or spans (e.g., silent data corruption)
- Root causes in third-party services that don't send telemetry to LogWatch
- Complex race conditions that require code-level analysis
- Business logic errors where the code works as implemented but the implementation is wrong

**The LLM reasoning layer is not infallible**. It can misidentify correlations as causation, especially when multiple changes occur in the same time window. The confidence score and alternative hypotheses section are designed to communicate this uncertainty explicitly.

The report is a starting point for investigation, not a substitute for engineering judgment. Its value is in compressing the time from alert to informed hypothesis from 30-60 minutes to under 2 minutes.

---

## Conclusion

The gap between detecting an anomaly and understanding its cause is where most incident time is spent. Existing observability tools are excellent at presenting data but poor at synthesising it into explanations. Engineers must manually correlate logs, traces, deployments, and dependencies --- a time-consuming process that depends on individual expertise and familiarity with the system.

LogWatch's automated RCA pipeline closes this gap by:

1. Systematically assembling evidence from all available signals
2. Applying LLM reasoning to identify the most probable cause
3. Presenting findings as a plain-language narrative with cited evidence
4. Providing confidence scoring and alternative hypotheses for transparency

The result: a structured starting point for incident response, delivered in under 2 minutes, that would take a skilled engineer 30-60 minutes to assemble manually.

---

## References

1. He, S. et al. (2021). "LogBERT: Log Anomaly Detection via BERT." arXiv:2103.04475.
2. Du, M. et al. (2017). "DeepLog: Anomaly Detection and Diagnosis from System Logs through Deep Learning." ACM CCS 2017.
3. Nature Scientific Reports (2025). "System Log Anomaly Detection Based on Contrastive Learning and Retrieval Augmented."
4. OpenTelemetry Specification: Trace Context. https://www.w3.org/TR/trace-context/
5. OpenTelemetry Specification: Logs Data Model. https://opentelemetry.io/docs/specs/otel/logs/data-model/

---

*LogWatch is open source under the Apache 2.0 licence. Visit [logwatch.dev](https://logwatch.dev) for documentation, source code, and community.*
