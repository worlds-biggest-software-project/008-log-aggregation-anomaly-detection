# Building on Open Standards: Why OpenTelemetry-Native Observability Eliminates Vendor Lock-In

**LogWatch Whitepaper** | May 2026

---

## Executive Summary

The observability market is undergoing a structural shift. After a decade of proprietary agents, vendor-specific data formats, and closed ecosystems, the industry is converging on OpenTelemetry (OTel) --- a CNCF-graduated, vendor-neutral standard for telemetry collection. As of 2026, OpenTelemetry is the second most active CNCF project after Kubernetes, with SDKs for every major programming language and native support from every major observability platform.

Yet most organisations remain locked into proprietary observability stacks. The cost of switching providers --- re-instrumenting services, rebuilding dashboards, rewriting alert rules, retraining teams --- is so high that it effectively eliminates competitive pressure. Vendors know this, and pricing reflects it.

This whitepaper argues that the adoption of OpenTelemetry is not merely a technical upgrade but a strategic decision that restores purchasing leverage, future-proofs telemetry investment, and enables a best-of-breed observability architecture. It examines the current state of the standard, the practical realities of OTel-native vs. OTel-compatible platforms, and how LogWatch's OTel-native architecture delivers on the promise of vendor independence.

---

## The Lock-In Problem

### How Vendor Lock-In Works in Observability

Observability lock-in operates at three layers:

**Layer 1: Instrumentation**

Proprietary agents and SDKs are installed in every application and on every host. Datadog's `dd-trace` libraries, New Relic's language agents, and Splunk's Universal Forwarder each use vendor-specific APIs, data formats, and configuration models. Once instrumented with a vendor's SDK, switching requires touching every service's code, build pipeline, and deployment configuration.

**Layer 2: Data Format**

Each vendor defines its own data model for logs, traces, and metrics. Datadog uses its internal event schema. Splunk uses its own indexing format. Elastic uses the ECS (Elastic Common Schema). Data stored in one vendor's format cannot be queried by another vendor without transformation.

**Layer 3: Configuration and Knowledge**

Alert rules, dashboards, saved queries, and operational runbooks are expressed in vendor-specific languages and UIs. SPL (Splunk), KQL (Elastic), DQL (Datadog), and NRQL (New Relic) are each proprietary query languages with no portability. Team knowledge of these languages represents a significant investment that is lost on migration.

### The Cost of Switching

Organisations that have attempted observability migrations consistently report:

| Migration Aspect | Typical Effort |
|-----------------|---------------|
| Re-instrumentation of services | 2-4 weeks per 50 services |
| Dashboard recreation | 1-2 weeks per team |
| Alert rule migration | 1 week per team |
| Query language retraining | 2-4 weeks team training |
| Parallel running period | 1-3 months |
| **Total elapsed time** | **4-9 months** |

For an organisation with 200 services and 5 engineering teams, a migration project can consume 2,000-4,000 engineer-hours and 6-9 calendar months. This cost is factored into vendor negotiations, and vendors set pricing accordingly.

---

## OpenTelemetry: The Industry Standard

### What OpenTelemetry Is

OpenTelemetry is a collection of APIs, SDKs, tools, and specifications for generating, collecting, and exporting telemetry data (logs, metrics, traces, and as of 2024, profiling). It is:

- **CNCF-graduated** (since 2021), alongside Kubernetes, Prometheus, and Envoy
- **Vendor-neutral**: No single company controls the project
- **Language-comprehensive**: SDKs for Java, Python, Go, JavaScript/TypeScript, .NET, Ruby, PHP, Rust, C++, Swift, and Erlang/Elixir
- **The second most active CNCF project** by contributor count, after Kubernetes

### The Three Components

**1. OpenTelemetry SDKs**: Libraries that application developers use to generate telemetry. A single SDK call instruments an application for logs, metrics, and traces simultaneously:

```python
from opentelemetry import trace, logs, metrics

tracer = trace.get_tracer("payment-service")
logger = logs.get_logger("payment-service")
meter = metrics.get_meter("payment-service")

with tracer.start_as_current_span("process_payment"):
    logger.info("Processing payment", extra={"amount": 99.99})
    payment_counter.add(1)
```

**2. OpenTelemetry Protocol (OTLP)**: The wire protocol for transmitting telemetry data. OTLP defines a unified data model and serialisation format (protobuf or JSON) for all signal types. Any OTLP-compliant sender can talk to any OTLP-compliant receiver.

**3. OpenTelemetry Collector**: A vendor-neutral data pipeline that receives, processes, and exports telemetry. The Collector acts as a middleware layer between your applications and your observability backend:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 1s

exporters:
  otlphttp:
    endpoint: https://logwatch.example.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_..."

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp]
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlphttp]
```

The critical insight: **changing the backend requires changing only the Collector's exporter configuration**. No application code changes. No re-instrumentation. No redeployment of services.

### OTel-Native vs. OTel-Compatible

Not all platforms that "support OpenTelemetry" treat it equally. The distinction matters:

**OTel-Compatible** (most commercial platforms): The platform accepts OTLP data as one ingestion path among many, but was designed around its own proprietary data model and agents. OTLP data is transformed into the internal format, often losing metadata or requiring additional configuration. The platform's native agents remain the recommended (and better-supported) path.

Examples:
- Datadog accepts OTLP but recommends `dd-agent` for full feature support
- Splunk accepts OTLP via the Collector but many features require the Splunk Universal Forwarder
- New Relic accepts OTLP but its proprietary agents provide deeper auto-instrumentation

**OTel-Native** (LogWatch, SigNoz): The platform is designed from the ground up around the OTLP data model. OTLP is not an alternative ingestion path --- it is *the* data model. The internal storage schema maps directly to OTel's log, trace, and metric data models. No translation, no metadata loss, no feature gaps.

| Aspect | OTel-Compatible | OTel-Native |
|--------|----------------|-------------|
| Primary data model | Vendor-specific | OTLP |
| OTLP ingestion | Supported (translated) | Native (no translation) |
| Metadata preservation | Partial (some OTel attributes may be dropped) | Complete |
| Feature parity with proprietary agents | Partial (some features require vendor agent) | Full |
| Switching backend | May require re-instrumentation if using vendor agents | Collector config change only |
| W3C Trace Context | Supported | Native |
| Resource attribute handling | Mapped to vendor schema | Stored natively |

---

## LogWatch's OTel-Native Architecture

### Data Model Alignment

LogWatch's ClickHouse schema maps directly to the OpenTelemetry data model:

**Logs**: The `otel_logs` table columns correspond 1:1 with the OTel Logs Data Model fields:

| OTel Logs Data Model | LogWatch Column |
|---------------------|----------------|
| `Timestamp` | `timestamp` |
| `ObservedTimestamp` | `observed_timestamp` |
| `TraceId` | `trace_id` |
| `SpanId` | `span_id` |
| `TraceFlags` | `trace_flags` |
| `SeverityText` | `severity_text` |
| `SeverityNumber` | `severity_number` |
| `Body` | `body` |
| `Resource` | `resource_string` (as Map) |
| `Attributes` | `attributes_string`, `attributes_number`, `attributes_bool` |

No translation layer. No lossy mapping. Every OTel attribute is preserved exactly as the SDK emitted it.

**Traces**: The `otel_traces` table similarly maps to the OTel Trace Data Model, preserving span events, links, and the full attribute taxonomy.

### Ingestion Paths

LogWatch accepts telemetry through four paths, all converging on the same internal data model:

1. **OTLP/HTTP and OTLP/gRPC** (primary): Direct from OTel Collector or OTel SDK exporters
2. **HTTP JSON** (convenience): A simplified JSON format for applications that don't use OTel SDKs
3. **Syslog (RFC 5424/3164)** (legacy): For infrastructure and legacy systems that emit syslog
4. **CI/CD Webhook** (deployments): For deployment event registration from build pipelines

All four paths normalise to the same internal data model. A log from an OTel Collector and a log from a syslog source are stored in the same table, queryable with the same interface, and analysed by the same anomaly detection pipeline.

### W3C Trace Context

LogWatch uses the W3C Trace Context standard (not a proprietary correlation mechanism) for connecting logs to traces:

- The `traceparent` HTTP header propagates trace and span IDs across services
- Log records automatically include `trace_id` and `span_id` when emitted within a traced context
- LogWatch's UI links log records to traces using these standard fields

For teams already using OpenTelemetry instrumentation, log-to-trace correlation works automatically with zero additional configuration.

---

## The Strategic Value of Vendor Independence

### Restore Purchasing Leverage

When switching costs are near zero, vendor relationships become genuinely competitive. Organisations can:

- Evaluate alternatives in weeks instead of months
- Run proof-of-concept deployments with production data by adding a second Collector exporter
- Negotiate pricing from a position of credible alternatives
- Adopt best-of-breed tools for specific use cases (e.g., security logging to one backend, application observability to another)

### Future-Proof Telemetry Investment

Instrumentation is the most expensive part of an observability deployment. It touches every service, every build pipeline, and every deployment. OpenTelemetry instrumentation is a one-time investment that is independent of the backend:

- If LogWatch doesn't meet your needs in three years, switch to any other OTLP-compatible backend by changing the Collector configuration
- If a new observability platform emerges that solves a problem LogWatch doesn't, add it as a second exporter
- If your team grows and a managed service makes more sense, your instrumentation doesn't change

### Enable Best-of-Breed Architecture

With OpenTelemetry, the Collector becomes a routing layer. A single Collector can export the same data to multiple backends simultaneously:

```yaml
exporters:
  otlphttp/logwatch:
    endpoint: https://logwatch.internal/api/v1/ingest/otlp
  otlphttp/security:
    endpoint: https://wazuh.internal/api/v1/ingest/otlp

service:
  pipelines:
    logs:
      receivers: [otlp]
      exporters: [otlphttp/logwatch, otlphttp/security]
```

This enables architectures where:
- Application logs go to LogWatch for anomaly detection and investigation
- Security-relevant logs go to a SIEM for compliance and threat detection
- Infrastructure metrics go to Prometheus/Grafana for infrastructure dashboards
- All from the same instrumentation, the same Collector, the same telemetry pipeline

---

## Migration Path: From Proprietary to OTel-Native

### Phase 1: Instrument with OTel SDKs (Weeks 1-4)

Replace proprietary agents with OpenTelemetry SDKs. For most languages, this involves:

1. Remove the vendor-specific agent dependency from your build
2. Add the OpenTelemetry SDK dependency
3. Configure the SDK to export via OTLP to a Collector
4. (Optional) Enable auto-instrumentation for common frameworks (HTTP, database, messaging)

Many vendors provide migration guides from their proprietary agents to OTel SDKs. The OTel SDKs provide equivalent or superior auto-instrumentation for most frameworks.

### Phase 2: Deploy OTel Collector (Week 2)

Deploy the OpenTelemetry Collector as a DaemonSet (Kubernetes) or sidecar. Configure it to export to your *current* backend using the vendor-specific exporter. This validates that your OTel instrumentation produces correct data without changing your observability backend.

### Phase 3: Add LogWatch as a Second Exporter (Week 3)

Add LogWatch as a second exporter in the Collector configuration. Both backends receive the same data. Compare results side-by-side: verify that log search, trace correlation, and anomaly detection work correctly in LogWatch.

### Phase 4: Cutover (Week 4+)

Once validated, remove the old vendor's exporter from the Collector. Decommission proprietary agents. The migration is complete.

**Total elapsed time**: 4-6 weeks for most organisations, with no downtime and no data loss during the transition.

Compare this with the 4-9 month timeline for migrating between proprietary platforms. The difference is entirely due to instrumentation portability: with OTel, you are changing a configuration line in the Collector, not re-instrumenting every service.

---

## Standards Alignment

LogWatch aligns with the following industry standards:

| Standard | How LogWatch Uses It |
|----------|---------------------|
| **OpenTelemetry Protocol (OTLP)** | Primary ingestion protocol for all signal types |
| **W3C Trace Context** | Log-to-trace correlation via `traceparent` header |
| **RFC 5424 (Syslog)** | Legacy log ingestion for infrastructure and network devices |
| **RFC 3164 (BSD Syslog)** | Legacy log ingestion for older systems |
| **OpenAPI 3.2** | REST API documentation and client generation |
| **OAuth 2.0 / OIDC** | Authentication and enterprise SSO |
| **OCSF** | Security event normalisation (schema ready, analysis deferred) |
| **NIST SP 800-92** | Log management program requirements alignment |
| **OWASP Logging Guidelines** | Sensitive data redaction and audit logging practices |

### Why Standards Matter for Procurement

For enterprises evaluating observability platforms, standards compliance provides:

1. **Reduced evaluation risk**: Standards-compliant platforms are interchangeable at the data layer
2. **Compliance alignment**: NIST, OWASP, and ISO standards are increasingly required for regulated industries
3. **Talent portability**: Engineers who know OTel, W3C Trace Context, and REST/OpenAPI can be productive immediately, without learning vendor-specific technologies
4. **Audit readiness**: Standards-based data models and APIs simplify compliance audits

---

## Conclusion

The observability market's proprietary era is ending. OpenTelemetry has achieved critical mass as the vendor-neutral standard for telemetry, and organisations that adopt it gain a structural advantage: the freedom to choose, switch, and combine observability backends based on capability and cost rather than lock-in.

LogWatch is built for this new reality. As an OTel-native platform, it does not merely accept OpenTelemetry data --- it is designed around it. Every feature, from anomaly detection to root-cause analysis to natural-language querying, operates on the standard OTel data model without translation or metadata loss.

For organisations beginning their OpenTelemetry journey, LogWatch provides a production-ready backend that validates the investment in standards-based instrumentation. For organisations already on OTel, LogWatch is a Collector configuration change away.

The best time to standardise on OpenTelemetry was three years ago. The second-best time is now.

---

## References

1. OpenTelemetry Project. https://opentelemetry.io/
2. OpenTelemetry Protocol Specification. https://opentelemetry.io/docs/specs/otel/protocol/
3. W3C Trace Context Recommendation. https://www.w3.org/TR/trace-context/
4. CNCF Annual Survey 2025: OpenTelemetry Adoption. https://www.cncf.io/reports/
5. NIST SP 800-92: Guide to Computer Security Log Management. https://csrc.nist.gov/publications/detail/sp/800-92/final
6. OWASP Logging Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

---

*LogWatch is open source under the Apache 2.0 licence. Visit [logwatch.dev](https://logwatch.dev) for documentation, source code, and community.*
