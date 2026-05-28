# LogWatch User Guide

**Version**: 0.1.0 | **Last Updated**: May 2026

This guide explains what LogWatch does, how to use its features, and the concepts behind it. Written for everyone on the team, from engineering managers to on-call responders.

For the full technical reference (API endpoints, data model, query syntax), see [user-guide-technical.md](user-guide-technical.md).

---

## Table of Contents

1. [What is LogWatch?](#what-is-logwatch)
2. [Key Concepts](#key-concepts)
3. [Getting Around the Dashboard](#getting-around-the-dashboard)
4. [Searching Logs](#searching-logs)
5. [Using Natural-Language Queries](#using-natural-language-queries)
6. [Live Tail](#live-tail)
7. [Distributed Tracing](#distributed-tracing)
8. [Anomaly Detection](#anomaly-detection)
9. [Root-Cause Analysis Reports](#root-cause-analysis-reports)
10. [Alerts and Notifications](#alerts-and-notifications)
11. [Cost Management](#cost-management)
12. [Managing Your Account](#managing-your-account)
13. [Frequently Asked Questions](#frequently-asked-questions)
14. [Glossary](#glossary)

---

## What is LogWatch?

LogWatch is an observability platform for software teams. It collects the log messages and trace data that your applications produce, stores them in a searchable database, and uses AI to find problems before they become outages.

Think of it as a single place where you can:

- **Search** all your application logs in one place, across every service
- **Ask questions** in plain English instead of learning a query language
- **Get alerted** only when something genuinely new and concerning happens
- **Understand** why something broke, with an AI-generated explanation linking logs, traces, and deployments
- **Control costs** by identifying and sampling repetitive, low-value log lines

LogWatch is open source (Apache 2.0 licence) and self-hosted, so your data never leaves your infrastructure.

---

## Key Concepts

### Logs

A **log record** is a timestamped message produced by your application. When your code writes something like `logger.error("Failed to connect to database")`, that becomes a log record. Each record has:

- **Timestamp**: When it happened
- **Severity**: How serious it is (DEBUG, INFO, WARN, ERROR, FATAL)
- **Body**: The message text
- **Service name**: Which application produced it
- **Attributes**: Additional key-value metadata (user ID, request ID, etc.)

### Traces

A **trace** represents a single user request as it flows through multiple services. For example, when someone clicks "Buy Now", that request might pass through an API gateway, payment service, inventory service, and notification service. A trace connects all of those steps.

Each step in a trace is called a **span**. A span records what happened, how long it took, and whether it succeeded or failed.

LogWatch links logs to traces automatically using standard W3C Trace Context headers. If your services are instrumented with OpenTelemetry, this correlation works out of the box with no extra configuration.

### Anomalies

An **anomaly** is something that LogWatch's AI identifies as unusual compared to a service's normal behaviour. This is different from a static threshold (e.g., "alert if error rate > 5%"). Instead, LogWatch learns what "normal" looks like for each service and flags genuinely new patterns.

Examples of things LogWatch detects as anomalies:
- A new error message that has never appeared before in a specific service
- An unexpected spike in error volume outside normal patterns
- A latency increase that doesn't match historical behaviour

Examples of things LogWatch does NOT flag:
- A Monday morning batch job that always causes a 3x spike (it learns this pattern)
- Elevated errors from a known-flaky upstream dependency that does this regularly

### Tenants

LogWatch supports **multi-tenancy** — multiple teams or organisations can use the same LogWatch installation with complete data isolation. Each tenant has its own logs, traces, alerts, users, and configuration. One tenant can never see another tenant's data.

### Services

A **service** is any software component that sends telemetry to LogWatch. Services are discovered automatically from the log and trace data they send — you don't need to register them manually.

---

## Getting Around the Dashboard

When you log in to LogWatch, you'll see the main navigation on the left side:

| Section | What It Shows |
|---------|--------------|
| **Logs** | Search and explore log records across all services |
| **Traces** | View distributed traces and service maps |
| **Anomalies** | AI-detected anomalies with severity scores and details |
| **Alerts** | Alert rules configuration and notification channels |
| **Services** | Auto-discovered services and their dependency graph |
| **Cost** | Per-service ingestion volumes, costs, and sampling recommendations |
| **Settings** | Tenant configuration, users, API keys, redaction rules |

The top bar shows your current tenant, time range selector, and account menu.

---

## Searching Logs

### Basic Search

The Logs page is your starting point for investigating issues. At the top, you'll find:

1. **Search box**: Type any keyword to search across all log messages
2. **Time range**: Select the time window (last 15 minutes, 1 hour, 24 hours, 7 days, or custom)
3. **Filters**: Narrow results by severity, service name, or custom attributes

Type a keyword and press Enter. Results appear as a list of log records, newest first. Each result shows:

- Timestamp
- Severity level (colour-coded)
- Service name
- Log message body (highlighted where it matches your search)
- Trace ID link (if the log is correlated with a trace)

### Filtering

Use the filter panel to narrow results without modifying your search text:

- **Severity**: Show only ERROR and FATAL records to focus on problems
- **Service**: Show only logs from a specific application
- **Attributes**: Filter by any custom attribute your services include (e.g., `user_id`, `request_path`, `environment`)

### Search Tips

- Search is **full-text** — it matches words and phrases within log message bodies
- Put phrases in quotes for exact matching: `"connection refused"`
- Combine filters to narrow results progressively
- Results are limited to the retention window (default: 30 days)
- Searches across 10 million records typically return in under 1 second

---

## Using Natural-Language Queries

If you don't want to construct searches manually, you can ask LogWatch questions in plain English.

### How to Use It

1. Click the **Ask** tab in the Logs page (next to the search bar)
2. Type your question, for example:
   - "What caused the spike in 5xx errors between 2pm and 3pm UTC yesterday?"
   - "Show me all errors from the payment service in the last hour"
   - "Which services had the most errors today?"
   - "Were there any database connection failures this morning?"
3. Press Enter

LogWatch will:
1. Translate your question into an optimized database query
2. Show you the translated query (so you can learn and verify)
3. Run the query and display the results
4. Generate a plain-English summary of the findings

### Example

**You ask**: "What caused the spike in 5xx errors between 2pm and 3pm UTC yesterday?"

**LogWatch responds**:

> **Query**: `SELECT ... FROM otel_logs WHERE severity_number >= 17 AND timestamp BETWEEN '2026-05-10 14:00:00' AND '2026-05-10 15:00:00' ...`
>
> **Summary**: Found 247 error entries between 14:00 and 15:00 UTC on May 10th. 189 of these (76%) were TimeoutError from `payment-service`, clustered between 14:32 and 14:38 UTC. All point to `redis-cache` as the upstream dependency. The remaining 58 errors were from `notification-service`, which depends on `payment-service`.

### Tips

- Be as specific as you can about time ranges and services
- Natural-language querying uses the Claude API, so an Anthropic API key must be configured
- The translated query is always shown, so you can verify or refine it

---

## Live Tail

Live Tail lets you watch logs streaming in real time as your services produce them.

### How to Use It

1. Go to the **Logs** page
2. Click the **Live Tail** button (top right)
3. Optionally set filters (severity, service name) to narrow the stream
4. New log records appear as they are ingested, typically within 2 seconds of being emitted

### When to Use It

- **During an active incident**: Watch for error patterns as you investigate
- **After a deployment**: Verify that the new version is logging correctly
- **During load testing**: Monitor for unexpected errors under load

### Tips

- You can type in the filter box while Live Tail is running — it filters client-side without restarting the stream
- Live Tail can produce high volume; use filters to keep it manageable
- Click any log line to pause the stream and inspect details

---

## Distributed Tracing

### Viewing Traces

The **Traces** page shows distributed traces collected from your services. Each trace represents a single end-to-end request.

The trace view shows:
- **Timeline**: A horizontal bar chart (Gantt-style) of all spans in the trace
- **Service names**: Which services were involved in the request
- **Durations**: How long each span took
- **Errors**: Red indicators on spans that failed
- **Logs**: Expand any span to see the log records emitted during its execution

### Navigating from Logs to Traces

When you find an interesting log record:

1. Look for the **Trace ID** link on the log record
2. Click it to open the full trace view
3. See the complete call chain that produced this log entry
4. Identify which service in the chain introduced the error

This is the core workflow for diagnosing distributed systems issues: find the symptom in a log, follow it to the trace, and identify the root cause.

### Service Dependency Graph

The **Services** page shows an automatically-generated map of how your services communicate. This is derived from trace data — every time Service A calls Service B, LogWatch records that relationship.

The dependency graph shows:
- All services and their connections
- Call volume between services (last 24 hours)
- Error rates on each connection
- Average latency per dependency

---

## Anomaly Detection

### How It Works (In Plain Terms)

When you first connect a service, LogWatch begins a **learning period** of 7 days. During this time, it observes:
- What error messages are normal for this service
- What volume of logs is typical at different times of day and week
- What latency patterns are expected

After the learning period, LogWatch uses two AI techniques:

1. **LogBERT** (a machine learning model trained on log patterns) to identify error messages that are structurally different from anything seen before
2. **LLM semantic analysis** to understand the meaning and context of log patterns, distinguishing real problems from known noise

### The Anomaly Feed

Go to the **Anomalies** page to see all detected anomalies. Each anomaly shows:

- **Title**: A short description of what was detected (e.g., "Novel NullPointerException pattern in checkout-service")
- **Severity**: Critical, Warning, or Info, with a numeric score (0.0 - 1.0)
- **Service**: Which service is affected
- **Time Window**: When the anomaly was active
- **Sample Logs**: Example log records that triggered the detection
- **Correlated Traces**: Links to traces related to the anomalous behaviour

### Providing Feedback

Your feedback improves detection quality over time:

- **Helpful**: The detection was correct and useful
- **Not Helpful**: The detection was correct but not actionable
- **False Positive**: This was not actually a problem

Click the feedback buttons on any anomaly detail page. LogWatch incorporates this feedback to improve future detection for the affected service.

### Learning Mode

During the first 7 days for a new service, LogWatch runs in **Learning Mode**:
- Basic statistical detection is active (volume spikes, sudden error rate changes)
- Results are labelled as "Learning Mode" to set expectations
- After 7 days, the system transitions to full AI-powered detection

---

## Root-Cause Analysis Reports

When a critical anomaly is detected, LogWatch automatically generates a **Root-Cause Analysis (RCA) report**.

### What's in a Report

Each report contains:

1. **Summary**: A plain-language narrative explaining what happened and why
2. **Probable Cause**: The most likely explanation for the anomaly
3. **Confidence Score**: How confident the AI is in its diagnosis (0-100%)
4. **Evidence Chain**: Links between:
   - Log patterns that changed
   - Correlated distributed traces
   - Recent deployments to affected services
   - Service dependency impacts

### Example Report

> **Summary**: The TimeoutError spike in `payment-service` started 3 minutes after deployment v2.3.1 at 14:30 UTC, which changed the Redis client connection pool size from 20 to 5. Supporting evidence: p99 latency for `redis.get` spans increased from 5ms to 2,400ms at 14:33 UTC. Downstream impact: `checkout-service` and `notification-service` also showed elevated error rates due to their dependency on `payment-service`.
>
> **Probable Cause**: Deployment v2.3.1 reduced the Redis connection pool size, causing connection starvation under normal load.
>
> **Confidence**: 87%

### Providing Feedback

Rate each report as **Helpful** or **Not Helpful** and optionally add notes. This feedback improves future report quality.

---

## Alerts and Notifications

### Alert Rules

Alert rules define when and how LogWatch should notify you. Create rules from the **Alerts** page.

Each rule specifies:

- **Rule type**: What triggers the alert
  - *Anomaly*: Fires when a detected anomaly matches criteria
  - *Log pattern*: Fires when a specific log pattern appears
  - *Metric threshold*: Fires when a derived metric crosses a value
  - *Log absence*: Fires when expected log entries stop appearing
- **Severity**: Critical, Warning, or Info
- **Notification channels**: Where to send the alert (Slack, PagerDuty, email, webhook)
- **Cooldown**: Minimum time between repeat notifications for the same rule (prevents notification storms)
- **Mute window**: Silence alerts during planned maintenance

### Notification Channels

Configure notification channels before creating alert rules:

| Channel Type | What You Need |
|-------------|--------------|
| **Slack** | A Slack incoming webhook URL |
| **PagerDuty** | A PagerDuty integration key |
| **Email** | An email address or distribution list |
| **Webhook** | Any HTTP endpoint that accepts POST requests |

### Alert Lifecycle

1. An anomaly or condition matches an alert rule
2. LogWatch checks the cooldown window (skips if still in cooldown)
3. LogWatch checks the mute window (records but doesn't notify if muted)
4. A notification is sent to all configured channels within 60 seconds
5. The alert event is recorded in the Alerts history for auditing

---

## Cost Management

### Cost Dashboard

The **Cost** page shows:

- **Per-service daily volume**: How many GB of logs each service produces per day
- **Estimated storage cost**: What that volume costs in storage
- **Trend charts**: Volume trends over 7/30 day periods
- **Top talkers**: Services producing the most log volume

### Sampling Recommendations

LogWatch analyses your log streams and identifies high-volume, low-signal patterns. For example:

> **Pattern**: "Health check response 200 OK" from `api-gateway`
> **Current volume**: 2.1 million records/day (4.2 GB)
> **Recommended sample rate**: 1% (keep 1 in 100)
> **Estimated savings**: 4.16 GB/day
> **Reason**: Repetitive health check responses with no diagnostic value. Sampled records still provide sufficient coverage for availability monitoring.

To apply a recommendation:
1. Review the recommendation details
2. Click **Apply** to activate the sampling rule
3. The cost dashboard will reflect reduced volume within 24 hours

Sampling only affects the specified pattern. All other logs from the same service continue at full volume.

---

## Managing Your Account

### Roles and Permissions

LogWatch uses three roles:

| Role | Can Do |
|------|--------|
| **Viewer** | Search logs, view traces, view anomalies, view alerts, view dashboards, view cost data |
| **Editor** | Everything a Viewer can do, plus create/edit/delete alert rules, notification channels, sampling rules, and redaction rules |
| **Admin** | Everything an Editor can do, plus manage tenant settings, manage users, manage API keys, manage retention policies |

### API Keys

API keys are used for programmatic access (log ingestion from your services, CI/CD integration, scripts). Each key has configurable scopes:

- **ingest**: Send logs and traces to LogWatch
- **query**: Read logs, traces, and anomalies
- **alerts**: Manage alert rules and channels
- **admin**: Full administrative access

Create and manage API keys from **Settings > API Keys** (Admin only).

### Data Redaction

LogWatch can automatically mask sensitive data (credit card numbers, email addresses, API keys, bearer tokens) before it's stored. This happens at ingestion time, so sensitive data is never written to disk.

Built-in patterns are available for common sensitive data types. Editors and Admins can also create custom redaction rules using regular expressions.

Configure redaction from **Settings > Redaction Rules**.

---

## Frequently Asked Questions

### How much data can LogWatch handle?

LogWatch is designed for high-volume environments. It supports sustained ingestion of 100,000 log records per second per tenant, with sub-second search across 7 days of data.

### How long are logs retained?

The default retention is 30 days for logs and 14 days for traces. Admins can configure retention per tenant. Derived metrics are retained for 90 days (raw) and 365 days (hourly rollups).

### What happens if LogWatch can't keep up with ingestion volume?

LogWatch applies **backpressure** — it returns HTTP 429 (Too Many Requests) or 503 (Service Unavailable) to senders. OpenTelemetry Collectors and Fluent Bit automatically retry with exponential backoff. No logs are silently dropped.

### Do I need to install an agent on my servers?

No. LogWatch does not require a proprietary agent. It accepts data from:
- OpenTelemetry Collector (the standard choice for cloud-native environments)
- Fluent Bit
- Direct HTTP POST (for simple integrations)
- Syslog (for legacy systems)

### What does LogWatch cost?

LogWatch is open source under the Apache 2.0 licence. You pay only for the infrastructure to run it (servers, storage). There are no per-GB fees, no per-user fees, no feature tiers.

### What AI models does LogWatch use?

- **LogBERT**: A BERT-based model fine-tuned for log pattern classification (runs locally in the anomaly engine)
- **Statistical baselines**: Standard deviation and percentile-based anomaly detection (runs locally)
- **Claude API**: Used for natural-language query translation, root-cause analysis report generation, and adaptive threshold explanations (requires an Anthropic API key)

### Can multiple teams share one LogWatch installation?

Yes. LogWatch supports multi-tenancy with database-enforced isolation. Each team gets its own tenant with separate data, users, and configuration. One tenant can never see another tenant's data.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Anomaly** | An AI-detected deviation from a service's normal behaviour |
| **Baseline** | The learned pattern of normal behaviour for a specific service and metric |
| **ClickHouse** | The columnar database that stores log and trace data |
| **Cooldown** | The minimum time between repeat alert notifications for the same rule |
| **False Positive** | An anomaly detection that flagged normal behaviour as abnormal |
| **Ingestion** | The process of receiving and storing log records from your services |
| **Learning Mode** | The first 7 days after a service starts sending data, during which LogWatch builds baseline models |
| **Live Tail** | A real-time streaming view of new log records as they arrive |
| **LogBERT** | A machine learning model designed to understand log message patterns |
| **OTLP** | OpenTelemetry Protocol — the standard data format for sending logs, traces, and metrics |
| **RCA** | Root-Cause Analysis — an AI-generated report explaining why an anomaly occurred |
| **Redaction** | Masking sensitive data (credit cards, tokens) before it's stored |
| **Retention** | How long log data is kept before automatic deletion |
| **RLS** | Row-Level Security — PostgreSQL's mechanism for enforcing tenant data isolation |
| **Sampling** | Keeping only a percentage of repetitive log records to reduce storage costs |
| **Severity** | The importance level of a log record (DEBUG, INFO, WARN, ERROR, FATAL) |
| **Span** | A single unit of work in a distributed trace |
| **Tenant** | An organisational unit with isolated data and configuration |
| **Trace** | The complete path of a request through multiple services |
| **W3C Trace Context** | The HTTP header standard for propagating trace IDs across services |
