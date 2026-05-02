# Standards & API Reference

> Project: Log Aggregation & Anomaly Detection (Candidate #008) · Generated: 2026-05-03

## Industry Standards & Specifications

### ISO Standards

#### ISO 27001:2022 Annex A 8.15 – Logging
- **Standard Number:** ISO 27001:2022
- **Official URL:** https://www.iso.org/standard/27001
- **Description:** Defines information security management requirements including mandatory logging of system activities, exceptions, and faults. Requires organizations to produce, store, protect, and analyze logs for security and compliance. Fundamental requirement for any enterprise log management system that handles sensitive data.

#### ISO 27035:2016 – Information Security Incident Management
- **Standard Number:** ISO 27035:2016
- **Official URL:** https://www.iso.org/standard/44379
- **Description:** Specifies requirements for detection, reporting, assessment, and response to information security incidents using log data. Log aggregation systems must support the incident detection and forensics workflows defined in this standard.

#### ISO 20022 – Financial Industry Message Standards
- **Standard Number:** ISO 20022
- **Official URL:** https://www.iso20022.org/
- **Description:** While primarily for financial services, ISO 20022 establishes patterns for structured data interchange and API design. Relevant for log platforms supporting compliance in financial organizations; includes updated API standards as of June 2025.

#### ISO 9001:2015 – Quality Management Systems
- **Standard Number:** ISO 9001:2015
- **Official URL:** https://www.iso.org/standard/62085
- **Description:** Requires documented evidence of process execution and quality tracking, typically captured in application logs. Log systems supporting ISO 9001 compliance must provide audit trails, retention policies, and tamper-proof evidence storage.

---

### W3C & IETF Standards

#### W3C Trace Context (W3C Recommendation)
- **Official Specification:** https://www.w3.org/TR/trace-context/
- **Status:** W3C Recommendation (Production)
- **Description:** Standardizes HTTP headers (`traceparent` and `tracestate`) for propagating distributed trace context across services. Essential for correlating logs with distributed traces; enables multi-service transaction tracking without vendor lock-in. Supports modern cloud-native observability patterns.

#### RFC 5424 – The Syslog Protocol
- **Standard Number:** RFC 5424
- **Official URL:** https://datatracker.ietf.org/doc/html/rfc5424
- **Status:** IETF Standards Track (obsoletes RFC 3164)
- **Description:** Defines structured syslog format with precise timestamps, hostname, application name, and facility codes. Includes support for vendor-specific structured data in SD-PARAM format. Enables interoperability between diverse logging sources; required for enterprise syslog ingestion.

#### RFC 3164 – The BSD Syslog Protocol
- **Standard Number:** RFC 3164
- **Official URL:** https://datatracker.ietf.org/doc/html/rfc3164
- **Status:** IETF Informational (superseded by RFC 5424)
- **Description:** Original syslog protocol still widely used for device and OS log emission. Less precise timestamps and metadata than RFC 5424; log aggregation systems must support both formats for legacy system compatibility.

#### RFC 7231 – HTTP Semantics and Content
- **Standard Number:** RFC 7231
- **Official URL:** https://datatracker.ietf.org/doc/html/rfc7231
- **Status:** IETF Standards Track
- **Description:** Defines HTTP method semantics and status codes fundamental to REST APIs used by log management platforms. Required for implementing HTTP log ingestion endpoints and API design patterns.

#### RFC 8288 – Web Linking
- **Standard Number:** RFC 8288
- **Official URL:** https://datatracker.ietf.org/doc/html/rfc8288
- **Status:** IETF Standards Track
- **Description:** Specifies Link header for web resources and pagination patterns. Relevant for log API navigation, cursor-based pagination for large result sets, and HATEOAS hypermedia linking in log query responses.

---

### Data Model & API Specifications

#### OpenTelemetry Protocol (OTLP) – CNCF Specification
- **Official Specification:** https://opentelemetry.io/docs/specs/otel/protocol/
- **Status:** CNCF Incubating (de facto standard, graduated in 2021)
- **Description:** Vendor-neutral, open standard for telemetry data collection. OTLP defines unified log, metric, and trace data models; enables log ingestion without vendor lock-in. Supported by 200+ observability tools; native support for structured logging with attributes and resource context.

#### OpenAPI Specification 3.2.0
- **Official Specification:** https://spec.openapis.org/oas/v3.2.0.html
- **Status:** Latest stable release (September 2025)
- **Description:** Standard for documenting REST APIs with full JSON Schema 2020-12 compatibility. Includes streaming media types (Server-Sent Events, JSON Lines, JSON Sequences) relevant for live log tail and real-time alerting APIs. OpenAPI 3.2 adds QUERY HTTP method support and OAuth 2.0 Device Flow.

#### JSON Schema Draft 2020-12
- **Official Specification:** https://json-schema.org/
- **Latest Version:** 2020-12
- **Description:** Standardized schema language for validating JSON data structures. Essential for defining log event schemas, API request/response validation, and data model contracts. Fully integrated with OpenAPI 3.1+ for seamless schema reuse.

#### GraphQL Specification (October 2021)
- **Official Specification:** https://graphql.org/learn/
- **Status:** Stable (production-ready)
- **Description:** Alternative to REST for flexible querying of log data with schema introspection. Enables clients to request only required fields, reducing bandwidth for large log queries. Introspection API allows self-documenting schema discovery; useful for advanced log query interfaces.

#### Prometheus Remote Write Protocol
- **Official Specification:** https://prometheus.io/docs/prometheus/latest/storage/#remote-storage-integrations
- **Description:** De facto standard for time-series metric ingestion. Many log aggregation systems extend this for log metrics and histogram data. Compatible with OpenTelemetry metrics export.

---

### Security & Authentication Standards

#### OAuth 2.0 Authorization Framework
- **Standard Number:** RFC 6749
- **Official URL:** https://datatracker.ietf.org/doc/html/rfc6749
- **Status:** IETF Standards Track
- **Description:** Industry standard for API access delegation without sharing passwords. Required for multi-tenant log platforms where API clients need scoped access to specific logs. Essential for SaaS log management services.

#### OpenID Connect (OIDC) 1.0
- **Official Specification:** https://openid.net/specs/openid-connect-core-1_0.html
- **Status:** Stable (built on OAuth 2.0)
- **Description:** Adds identity layer to OAuth 2.0, enabling federated authentication (OIDC with enterprise identity providers). Supports single sign-on (SSO) scenarios for enterprise log platform deployments.

#### OWASP Logging Cheat Sheet
- **Official URL:** https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- **Description:** Prescriptive guidance on what events must be logged (authentication, authorization failures, input validation errors) and recommended formats (CEF, CLFS over syslog). Defines sensitive data redaction requirements to prevent credential leakage in logs.

#### OWASP Logging Vocabulary Cheat Sheet
- **Official URL:** https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html
- **Description:** Standardizes log field names and event type taxonomy across applications. Enables cross-system correlation and reduces ambiguity in log analysis; essential for building context-aware anomaly detection systems.

#### OWASP Secure Logging Benchmark
- **Official URL:** https://owasp.org/www-project-secure-logging-benchmark/
- **Description:** Provides metrics and benchmarking criteria for evaluating log security. Guides log platform design decisions around retention, encryption, access control, and audit trail integrity.

#### NIST SP 800-92 – Guide to Computer Security Log Management
- **Official URL:** https://csrc.nist.gov/publications/detail/sp/800-92/final
- **Description:** Federal guidance defining log management program requirements: log creation, transmission, storage, analysis, review, retention, and protection. Establishes baseline security controls required by US federal agencies and federal contractors. Covers incident detection workflows using log data.

#### NIST Cybersecurity Framework
- **Official URL:** https://www.nist.gov/cyberframework
- **Description:** High-level cybersecurity governance framework emphasizing detection and response functions powered by log analysis. Log aggregation is a critical component of NIST CSF implementation for detecting unauthorized access and policy violations.

#### Common Event Format (CEF)
- **Official Standard:** Developed by ArcSight, endorsed by OWASP
- **Description:** Structured log format for security event interoperability between SIEM systems. CEF enables log normalization across diverse security tools (firewalls, intrusion detection systems, proxies) for centralized correlation and alerting.

#### W3C Extended Log Format (W3C)
- **Official URL:** https://www.w3.org/TR/WD-logfile.html
- **Description:** Standardized format for HTTP server access logs. Widely implemented by web servers (Apache, Nginx, IIS) and ingested by log platforms. Enables structured parsing of request metadata (user agent, referrer, response code, latency) for web application monitoring.

---

### Log Event & Observability Standards

#### Common Event Expression (CEE)
- **Description:** Industry effort to standardize log data structure and taxonomy, separate from syntax. Defines which event types should be logged and how to name and structure fields consistently.

#### OCSF (Open Cybersecurity Schema Framework)
- **Official URL:** https://schema.ocsf.io/
- **Description:** Emerging standard for log aggregation defining normalized event mappings. Enables cross-source correlation regardless of vendor: events like "Denied" actions from different security tools normalize to consistent fields (action_id: 2). Critical for SOC automation and log analytics at scale.

---

## Similar Products — Developer Documentation & APIs

### 1. Datadog (Log Management + Observability)

- **Description:** Commercial cloud observability platform with ML-powered anomaly detection (Watchdog), log management with pay-per-GB ingestion, 650+ integrations, and unified dashboards for logs/metrics/traces.

- **API Documentation:** https://docs.datadoghq.com/api/latest/
- **Logs API Reference:** https://docs.datadoghq.com/api/latest/logs/
- **Anomaly Detection API:** https://docs.datadoghq.com/monitors/types/anomaly/
- **Content Anomaly Detection:** https://docs.datadoghq.com/security/cloud_siem/detect_and_monitor/custom_detection_rules/content_anomaly/

- **SDKs/Libraries:**
  - Python SDK: https://github.com/DataDog/datadog-api-client-python
  - JavaScript SDK: https://github.com/DataDog/datadog-api-client-js
  - Go SDK: https://github.com/DataDog/datadog-api-client-go
  - Java SDK: https://github.com/DataDog/datadog-api-client-java

- **Developer Guide:** https://docs.datadoghq.com/getting_started/

- **Standards:** REST/JSON API, OpenAPI-documented, supports OpenTelemetry Collector as ingestion path, Watchdog uses machine learning for automatic anomaly detection without threshold configuration

- **Authentication:** API keys, OAuth 2.0 for app integrations

---

### 2. Elasticsearch (Inverted-Index Search Engine)

- **Description:** Distributed full-text search and analytics engine with Kibana visualization, Logstash data pipeline, and X-Pack ML for anomaly detection. Elasticsearch Service provides managed deployment on AWS, GCP, Azure.

- **API Documentation:** https://www.elastic.co/docs/api/doc/elasticsearch/
- **Search API Reference:** https://www.elastic.co/guide/en/elasticsearch/reference/current/search-apis.html
- **Alerting API:** https://www.elastic.co/guide/en/kibana/current/alerting-setup.html
- **Machine Learning API:** https://www.elastic.co/guide/en/elasticsearch/reference/current/ml-apis.html

- **SDKs/Libraries:**
  - Python: https://github.com/elastic/elasticsearch-py
  - JavaScript/Node.js: https://github.com/elastic/elasticsearch-js
  - Go: https://github.com/elastic/go-elasticsearch
  - Java: https://github.com/elastic/elasticsearch-java

- **Developer Guide:** https://www.elastic.co/guide/en/elasticsearch/reference/current/getting-started.html

- **Standards:** REST/JSON API, OpenAPI specification, KQL (Kibana Query Language), supports OTLP logs export, X-Pack ML includes LSTM-based anomaly detection

- **Authentication:** Basic auth, API keys, service tokens, OAuth 2.0

---

### 3. OpenSearch (Apache 2.0 Fork of Elasticsearch)

- **Description:** Open-source fork of Elasticsearch 7.10 under Apache License 2.0. Includes ML Commons plugin for anomaly detection, security plugin with RBAC and field-level encryption, and managed deployment via Amazon OpenSearch Service.

- **API Documentation:** https://opensearch.org/docs/latest/api-reference/
- **Anomaly Detection API:** https://opensearch.org/docs/latest/observing-your-data/ad/api/
- **Security Plugin API:** https://opensearch.org/docs/latest/security/access-control/api/

- **SDKs/Libraries:**
  - Python: https://github.com/opensearch-project/opensearch-py
  - JavaScript/Node.js: https://github.com/opensearch-project/opensearch-js
  - Go: https://github.com/opensearch-project/opensearch-go
  - Java: https://github.com/opensearch-project/opensearch-java

- **Developer Guide:** https://opensearch.org/docs/latest/getting-started/

- **Standards:** REST/JSON API, nearly identical to Elasticsearch 7.10 DSL, OpenSearch Dashboards (Kibana fork), ML Commons uses Random Cut Forest (RCF) algorithm for unsupervised anomaly detection

- **Authentication:** Basic auth, SAML, OIDC, LDAP, API keys (via security plugin)

---

### 4. Grafana Loki (Label-Indexed Log Aggregation)

- **Description:** Open-source (AGPLv3) log aggregation optimized for cost-efficient high-volume ingestion through label-only indexing. Designed for Kubernetes/Prometheus stacks with seamless Grafana integration for unified logs/metrics/traces dashboards.

- **API Documentation:** https://grafana.com/docs/loki/latest/api/
- **LogQL Query Language Reference:** https://grafana.com/docs/loki/latest/query/query_reference/
- **Querying Loki:** https://grafana.com/docs/loki/latest/query/

- **SDKs/Libraries:**
  - Promtail (agent): https://grafana.com/docs/loki/latest/send-data/promtail/
  - Grafana Agent / Alloy: https://grafana.com/docs/agent/latest/
  - Python client: https://github.com/grafana/loki-client-python
  - Go client: https://github.com/grafana/loki/tree/main/clients/pkg

- **Developer Guide:** https://grafana.com/docs/loki/latest/get-started/overview/

- **Standards:** REST/JSON API, LogQL (metric-style queries similar to PromQL), supports Prometheus scrape configs, integrates with OpenTelemetry Collector for OTLP logs export

- **Authentication:** Basic auth (default), OAuth 2.0 Proxy, LDAP

---

### 5. SigNoz (Unified Observability – Logs/Metrics/Traces)

- **Description:** Open-source (Apache 2.0) unified observability platform built on ClickHouse backend and OpenTelemetry-native. Provides logs, metrics, and distributed traces in a single query context without vendor lock-in. SigNoz Cloud offers transparent $0.30/GB pricing.

- **API Documentation:** https://signoz.io/docs/userguide/apis/
- **OpenTelemetry Integration:** https://signoz.io/docs/opencode-observability/
- **Sending Logs via OTLP:** https://signoz.io/docs/frontend-monitoring/sending-logs-with-opentelemetry/

- **SDKs/Libraries:**
  - OpenTelemetry SDKs (any language): https://opentelemetry.io/docs/languages/
  - OpenTelemetry Collector: https://github.com/open-telemetry/opentelemetry-collector
  - Python exporter: https://github.com/open-telemetry/opentelemetry-python
  - JavaScript exporter: https://github.com/open-telemetry/opentelemetry-js

- **Developer Guide:** https://signoz.io/docs/introduction/

- **Standards:** OTLP (OpenTelemetry Protocol) native, REST/JSON API, ClickHouse SQL for advanced analytics, trace-to-log correlation via W3C Trace Context

- **Authentication:** Email/password, SSO support, API tokens

---

### 6. New Relic (AI-Assisted Anomaly Detection)

- **Description:** Commercial cloud observability platform with AI-assisted anomaly detection, pay-per-GB ingestion model, and unified APM/logs/infrastructure monitoring. Generous free tier (100 GB/month ingestion).

- **API Documentation:** https://docs.newrelic.com/docs/apis/intro-apis/introduction-new-relic-apis/
- **Logs API:** https://docs.newrelic.com/docs/logs/ui-data/
- **NRQL Query Language:** https://docs.newrelic.com/docs/query-your-data/nrql-new-relic-query-language/
- **Anomaly Detection:** https://docs.newrelic.com/docs/alerts-applied-intelligence/applied-intelligence/anomaly-detection-applied-intelligence/

- **SDKs/Libraries:**
  - Node.js SDK: https://github.com/newrelic/node-newrelic
  - Python SDK: https://github.com/newrelic/newrelic-python-agent
  - Java SDK: https://github.com/newrelic/newrelic-java-agent
  - Go SDK: https://github.com/newrelic/go-agent

- **Developer Guide:** https://docs.newrelic.com/docs/apm/new-relic-apm/getting-started/introduction-apm/

- **Standards:** REST/JSON API, NerdGraph GraphQL API for advanced queries, NRQL (similar to SQL), supports OTLP data export

- **Authentication:** API keys, OAuth 2.0

---

### 7. Splunk (Enterprise Log Intelligence)

- **Description:** Enterprise log intelligence platform with powerful SPL (Search Processing Language), ML Toolkit for anomaly detection, and extensive security/compliance use cases. Industry standard for security operations and compliance.

- **API Documentation:** https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTprolog
- **Search Language Reference:** https://help.splunk.com/en/splunk-enterprise/spl-search-reference/9.1/
- **Alerts and Scheduled Searches:** https://docs.splunk.com/Documentation/Splunk/latest/Alert/Aboutalerts
- **Machine Learning Toolkit:** https://docs.splunk.com/Documentation/MLTKforSplunk/latest/User/

- **SDKs/Libraries:**
  - Python SDK: https://github.com/splunk/splunk-sdk-python
  - JavaScript SDK: https://github.com/splunk/splunk-sdk-javascript
  - Java SDK: https://github.com/splunk/splunk-sdk-java
  - Go SDK: https://github.com/splunk/splunk-sdk-go

- **Developer Guide:** https://docs.splunk.com/Documentation/Splunk/latest/Developer/

- **Standards:** REST/JSON API, SPL (Search Processing Language), supports syslog RFC 5424/3164 ingestion, HEC (HTTP Event Collector) for structured event ingestion

- **Authentication:** Username/password, tokens, SAML, OAuth 2.0

---

### 8. Wazuh (Security-Focused Log Monitoring & SIEM)

- **Description:** Open-source (GPL-2.0) SIEM platform combining log monitoring, endpoint detection and response (EDR), file integrity monitoring (FIM), vulnerability detection, and real-time security event analysis.

- **API Documentation:** https://documentation.wazuh.com/current/user-manual/api/reference/
- **RESTful API:** https://documentation.wazuh.com/current/user-manual/api/
- **Alert Management:** https://documentation.wazuh.com/current/user-manual/capabilities/alerting/

- **SDKs/Libraries:**
  - Python: https://github.com/wazuh/wazuh-api-client
  - Node.js: https://www.npmjs.com/package/wazuh
  - Shell/Bash integration examples

- **Developer Guide:** https://documentation.wazuh.com/current/deploying-with-docker/quickstart-docker.html

- **Standards:** REST/JSON API, supports syslog RFC 5424, native Windows Event Log collection, JSON event export

- **Authentication:** Username/password, API tokens, OIDC

---

### 9. OpenObserve (Rust-Based Observability)

- **Description:** High-performance, S3-native unified observability platform written in Rust. Claims 140× lower storage cost than ELK through columnar data format and compression. Single-binary deployment for logs, metrics, traces, and dashboards.

- **API Documentation:** https://openobserve.ai/docs/api/
- **Query Language:** https://openobserve.ai/docs/query-syntax/
- **Log Ingestion:** https://openobserve.ai/docs/ingestion/

- **SDKs/Libraries:**
  - Python: https://github.com/openobserve/openobserve-py
  - Node.js: https://www.npmjs.com/package/openobserve
  - Go client in development
  - Fluent Bit plugin: https://github.com/openobserve/fluent-bit-plugin

- **Developer Guide:** https://openobserve.ai/docs/ingestion/fluent-bit/

- **Standards:** REST/JSON API, S3-compatible storage backend, supports syslog and OTLP ingestion, JSON event model

- **Authentication:** API keys, basic auth

---

### 10. Graylog (Security-Focused with SIEM)

- **Description:** Open-source (SSPL core) centralized log management platform with built-in SIEM features, threat detection pipelines, GDPR compliance tooling, and alerting. Elasticsearch-based backend with custom security and processing layers.

- **API Documentation:** https://docs.graylog.org/en/latest/pages/configuration/rest_api.html
- **Alert Management API:** https://docs.graylog.org/en/latest/pages/configuration/alerting.html
- **Stream Processing:** https://docs.graylog.org/en/latest/pages/pipelines/

- **SDKs/Libraries:**
  - Python: https://github.com/Graylog2/graylog-python-api
  - JavaScript: https://www.npmjs.com/package/graylog-api
  - Collectors for log shipping

- **Developer Guide:** https://docs.graylog.org/en/latest/pages/getting_started.html

- **Standards:** REST/JSON API, Elasticsearch 7.x compatible, supports syslog RFC 5424/3164, GELF (Graylog Extended Log Format) for structured JSON events

- **Authentication:** Username/password, LDAP, SAML, OAuth 2.0

---

## Notes

### Emerging Standards & Future Directions

1. **OCSF (Open Cybersecurity Schema Framework)** is rapidly gaining adoption as the unified schema for security log normalization. Unlike legacy CEF, OCSF provides a comprehensive, extensible event taxonomy supported by CISA and industry leaders.

2. **OpenTelemetry Logs** specification reached feature parity with traces and metrics in 2023, making OTLP the de facto standard for vendor-neutral log collection. Adoption is accelerating across observability platforms.

3. **W3C Distributed Tracing Working Group** has a new charter (drafted 2025) to evolve trace context standards. Watch for W3C Trace Context 2.0 enhancements to support additional propagation scenarios.

4. **GraphQL for Observability APIs** is emerging as an alternative to REST for log query interfaces, enabling flexible field selection and reducing over-fetching. New Relic's NerdGraph and others demonstrate viability.

5. **Observability as Code** (OaC) standards are maturing, with tools like OpenTelemetry Collector configuration and alert-as-code gaining traction. No single standard yet, but direction is clear.

### Gaps & Standards Still Evolving

- **Anomaly Detection Algorithms:** No standardized interface or data model for anomaly detection results across platforms. Projects like Wazuh, Elastic, and Datadog use proprietary formats.

- **Log Sampling & Retention Policies:** No industry standard for expressing sampling rules or retention tiers. Organizations define custom policies per platform.

- **AI/LLM Integration:** Emerging field with no standardized contracts for LLM-powered log analysis, natural-language query translation, or root-cause explanations.

- **Cost Attribution & Chargeback:** Multi-tenant observability platforms lack standardized schemas for attributing log ingestion cost per team or service.

### Recommended Alignment for This Project

For the Log Aggregation & Anomaly Detection project to maximize interoperability and adoption:

1. **Ingest:** Support OpenTelemetry (OTLP), RFC 5424 syslog, and CEF as primary log sources.
2. **Query APIs:** Implement OpenAPI 3.2-documented REST endpoints and consider GraphQL for advanced clients.
3. **Data Model:** Adopt OCSF for security event normalization; use OTLP for general observability events.
4. **Authentication:** Support OAuth 2.0 and OIDC for enterprise SSO integrations.
5. **Tracing:** Implement W3C Trace Context headers for seamless trace-to-log correlation.
6. **Alerting:** Design alert rules to be compatible with PagerDuty, Slack, and Webhook standards.
7. **Anomaly Detection:** Design output schema to be compatible with OWASP logging vocabulary for cross-tool consumption.

This alignment ensures the platform can integrate with existing observability ecosystems while providing a foundation for future AI-native enhancements.

---

## Sources

### Standards & Specifications

- [ISO 27001 Standard](https://www.iso.org/standard/27001)
- [RFC 5424 – The Syslog Protocol](https://datatracker.ietf.org/doc/html/rfc5424)
- [RFC 3164 – The BSD Syslog Protocol](https://datatracker.ietf.org/doc/html/rfc3164)
- [W3C Trace Context Specification](https://www.w3.org/TR/trace-context/)
- [OpenAPI Specification v3.2.0](https://spec.openapis.org/oas/v3.2.0.html)
- [JSON Schema](https://json-schema.org/)
- [GraphQL Specification](https://graphql.org/learn/)
- [OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [OWASP Logging Vocabulary Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Vocabulary_Cheat_Sheet.html)
- [NIST SP 800-92 – Guide to Computer Security Log Management](https://csrc.nist.gov/publications/detail/sp/800-92/final)
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- [OCSF (Open Cybersecurity Schema Framework)](https://schema.ocsf.io/)
- [OpenTelemetry Protocol Specification](https://opentelemetry.io/docs/specs/otel/protocol/)

### Product API Documentations

- [Datadog API Documentation](https://docs.datadoghq.com/api/latest/)
- [Elasticsearch API Documentation](https://www.elastic.co/docs/api/doc/elasticsearch/)
- [OpenSearch API Documentation](https://opensearch.org/docs/latest/api-reference/)
- [Grafana Loki API Documentation](https://grafana.com/docs/loki/latest/api/)
- [SigNoz API Documentation](https://signoz.io/docs/userguide/apis/)
- [New Relic API Documentation](https://docs.newrelic.com/docs/apis/intro-apis/introduction-new-relic-apis/)
- [Splunk API Reference](https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTprolog)
- [Wazuh API Documentation](https://documentation.wazuh.com/current/user-manual/api/reference/)
- [OpenObserve API Documentation](https://openobserve.ai/docs/api/)
- [Graylog API Documentation](https://docs.graylog.org/en/latest/pages/configuration/rest_api.html)

---

*End of Standards & API Reference Document*
