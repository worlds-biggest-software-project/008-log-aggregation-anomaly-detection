# LogWatch Integration Guide

**Version**: 0.1.0 | **Last Updated**: May 2026

How to connect your infrastructure, applications, and CI/CD pipelines to LogWatch. This guide covers every supported data source with copy-paste configuration examples.

---

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Architecture: How Data Flows Into LogWatch](#architecture-how-data-flows-into-logwatch)
3. [Application Instrumentation](#application-instrumentation)
   - [Node.js / TypeScript](#nodejs--typescript)
   - [Python](#python)
   - [Java / Kotlin / Spring Boot](#java--kotlin--spring-boot)
   - [Go](#go)
   - [.NET / C#](#net--c)
   - [Ruby](#ruby)
   - [Rust](#rust)
   - [Any Language (HTTP JSON)](#any-language-http-json)
4. [OpenTelemetry Collector](#opentelemetry-collector)
   - [Standalone Collector](#standalone-collector)
   - [Collector as Gateway](#collector-as-gateway)
   - [Filtering and Processing](#filtering-and-processing)
5. [Kubernetes](#kubernetes)
   - [Cluster-Wide Log Collection](#cluster-wide-log-collection)
   - [Helm-Based Collector Deployment](#helm-based-collector-deployment)
   - [Kubernetes Events](#kubernetes-events)
   - [Pod Annotations for Selective Collection](#pod-annotations-for-selective-collection)
6. [Docker and Docker Compose](#docker-and-docker-compose)
7. [Fluent Bit](#fluent-bit)
8. [Syslog Sources](#syslog-sources)
   - [Linux Servers (rsyslog)](#linux-servers-rsyslog)
   - [Linux Servers (syslog-ng)](#linux-servers-syslog-ng)
   - [Network Devices (Firewalls, Switches, Routers)](#network-devices-firewalls-switches-routers)
9. [Web Servers](#web-servers)
   - [Nginx](#nginx)
   - [Apache](#apache)
   - [Caddy](#caddy)
10. [Databases](#databases)
    - [PostgreSQL](#postgresql)
    - [MySQL / MariaDB](#mysql--mariadb)
    - [MongoDB](#mongodb)
    - [Redis](#redis)
11. [Message Queues](#message-queues)
    - [RabbitMQ](#rabbitmq)
    - [Apache Kafka](#apache-kafka)
12. [Cloud Providers](#cloud-providers)
    - [AWS (CloudWatch Logs)](#aws-cloudwatch-logs)
    - [Google Cloud (Cloud Logging)](#google-cloud-cloud-logging)
    - [Azure (Monitor Logs)](#azure-monitor-logs)
13. [CI/CD Deployment Tracking](#cicd-deployment-tracking)
    - [GitHub Actions](#github-actions)
    - [GitLab CI/CD](#gitlab-cicd)
    - [Jenkins](#jenkins)
    - [Generic Webhook](#generic-webhook)
14. [Custom Attributes and Resource Tags](#custom-attributes-and-resource-tags)
15. [Verifying Your Integration](#verifying-your-integration)
16. [Troubleshooting](#troubleshooting)

---

## Before You Start

You need two things before connecting any data source to LogWatch:

### 1. Your LogWatch Ingestion URL

This is the base URL of your LogWatch API server:

| Deployment | Typical URL |
|-----------|------------|
| Local development | `http://localhost:4000` |
| Docker Compose production | `https://logwatch.yourdomain.com` |
| Kubernetes | `https://logwatch.yourdomain.com` or `http://logwatch-api.logwatch.svc.cluster.local:4000` (in-cluster) |

### 2. An API Key with Ingestion Scope

Create an API key from the LogWatch web UI:

1. Log in to LogWatch
2. Go to **Settings > API Keys**
3. Click **Create API Key**
4. Name: something descriptive (e.g., "production-otel-collector")
5. Scopes: select **ingest** (minimum required)
6. Click **Create**
7. Copy the key (it starts with `lw_`) --- it will not be shown again

For testing, you can also send a quick unauthenticated request to the health endpoint to confirm connectivity:

```bash
curl https://logwatch.yourdomain.com/api/v1/health
```

---

## Architecture: How Data Flows Into LogWatch

```
  ┌──────────────────────────────────────────────────────┐
  │              Your Infrastructure                      │
  │                                                      │
  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────┐  │
  │  │ App     │ │ App     │ │ App     │ │ Infra     │  │
  │  │ (OTel   │ │ (OTel   │ │ (HTTP   │ │ (syslog,  │  │
  │  │  SDK)   │ │  SDK)   │ │  JSON)  │ │  Fluent   │  │
  │  └────┬────┘ └────┬────┘ └────┬────┘ │  Bit)     │  │
  │       │           │           │      └─────┬─────┘  │
  │       └─────┬─────┘           │            │        │
  │             ▼                 │            │        │
  │  ┌────────────────────┐      │            │        │
  │  │  OTel Collector    │      │            │        │
  │  │  (recommended)     │      │            │        │
  │  └─────────┬──────────┘      │            │        │
  │            │                 │            │        │
  └────────────┼─────────────────┼────────────┼────────┘
               │                 │            │
               ▼                 ▼            ▼
  ┌──────────────────────────────────────────────────────┐
  │              LogWatch                                 │
  │                                                      │
  │   POST /api/v1/ingest/otlp   (OTLP protobuf/JSON)   │
  │   POST /api/v1/ingest/json   (simplified JSON)       │
  │   TCP  :1514                 (syslog RFC 5424/3164)  │
  │   POST /api/v1/deployments   (CI/CD webhooks)        │
  └──────────────────────────────────────────────────────┘
```

**Recommended path**: Instrument your applications with OpenTelemetry SDKs, send telemetry to an OpenTelemetry Collector, and configure the Collector to export to LogWatch. This gives you logs, traces, and automatic log-to-trace correlation with no additional effort.

**Alternative paths**: Direct HTTP JSON (for simple integrations), Fluent Bit (if you already use it), or syslog (for infrastructure and legacy systems).

---

## Application Instrumentation

### Node.js / TypeScript

#### Auto-Instrumentation (Recommended)

Install the OpenTelemetry packages:

```bash
npm install @opentelemetry/sdk-node \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-http \
  @opentelemetry/exporter-logs-otlp-http \
  @opentelemetry/sdk-logs \
  @opentelemetry/api-logs
```

Create `instrumentation.ts` (must be loaded before your application code):

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'my-api-service',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || '0.0.0',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4317',   // OTel Collector gRPC
  }),
  logRecordProcessor: new SimpleLogRecordProcessor(
    new OTLPLogExporter({
      url: 'http://localhost:4318/v1/logs',   // OTel Collector HTTP
    })
  ),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

Load it before your app starts:

```bash
node --require ./instrumentation.js dist/server.js
# or with ts-node:
node --require ./instrumentation.ts src/server.ts
```

#### Using a Logger (Winston, Pino)

If you use Winston or Pino, the auto-instrumentation automatically bridges log records into the OTel pipeline. Your existing log calls work as-is:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'my-api-service' },
  transports: [new winston.transports.Console()],
});

// These logs are automatically captured by OTel auto-instrumentation
// and correlated with the active trace
logger.info('Payment processed', { amount: 99.99, userId: 'user-456' });
logger.error('Payment failed', { error: 'Insufficient funds', userId: 'user-456' });
```

#### Direct HTTP (No OTel SDK)

If you don't want to use the OTel SDK, send logs directly via HTTP:

```typescript
async function sendLog(severity: string, message: string, attrs: Record<string, string> = {}) {
  await fetch('https://logwatch.yourdomain.com/api/v1/ingest/json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.LOGWATCH_API_KEY!,
    },
    body: JSON.stringify({
      logs: [{
        timestamp: new Date().toISOString(),
        severity,
        body: message,
        service: 'my-api-service',
        attributes: attrs,
      }],
    }),
  });
}
```

---

### Python

#### Auto-Instrumentation (Recommended)

```bash
pip install opentelemetry-distro opentelemetry-exporter-otlp
opentelemetry-bootstrap -a install   # auto-installs instrumentations for detected libraries
```

Configure via environment variables:

```bash
export OTEL_SERVICE_NAME=my-python-service
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production,service.version=1.2.3"
```

Run your application with auto-instrumentation:

```bash
opentelemetry-instrument python app.py
# or with uvicorn:
opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000
# or with gunicorn:
opentelemetry-instrument gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker
```

#### Manual Logging Integration

Bridge Python's built-in logging module to OpenTelemetry:

```python
import logging
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter

logger_provider = LoggerProvider()
logger_provider.add_log_record_processor(
    BatchLogRecordProcessor(OTLPLogExporter(endpoint="http://localhost:4317"))
)
set_logger_provider(logger_provider)

handler = LoggingHandler(level=logging.INFO, logger_provider=logger_provider)
logging.getLogger().addHandler(handler)

# Standard Python logging now flows to LogWatch via the Collector
logger = logging.getLogger(__name__)
logger.info("Payment processed", extra={"amount": 99.99, "user_id": "user-456"})
```

#### Django

```bash
pip install opentelemetry-instrumentation-django
```

In `manage.py` or `wsgi.py`, before the Django app loads:

```python
from opentelemetry.instrumentation.django import DjangoInstrumentor
DjangoInstrumentor().instrument()
```

Run:

```bash
OTEL_SERVICE_NAME=my-django-app opentelemetry-instrument python manage.py runserver
```

#### FastAPI

```bash
pip install opentelemetry-instrumentation-fastapi
```

```python
from fastapi import FastAPI
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

app = FastAPI()
FastAPIInstrumentor.instrument_app(app)
```

---

### Java / Kotlin / Spring Boot

#### Java Agent Auto-Instrumentation (Recommended)

Download the OpenTelemetry Java Agent:

```bash
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

Run your application with the agent:

```bash
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.service.name=my-java-service \
  -Dotel.exporter.otlp.endpoint=http://localhost:4317 \
  -Dotel.resource.attributes=deployment.environment.name=production,service.version=2.1.0 \
  -jar my-application.jar
```

This automatically instruments:
- Spring Boot (controllers, services, repositories)
- JDBC / JPA / Hibernate (database queries)
- HTTP clients (RestTemplate, WebClient, OkHttp, Apache HttpClient)
- gRPC
- Kafka, RabbitMQ
- Logback and Log4j2 (log records bridged to OTel)

#### Spring Boot Starter (Alternative)

```xml
<!-- pom.xml -->
<dependency>
  <groupId>io.opentelemetry.instrumentation</groupId>
  <artifactId>opentelemetry-spring-boot-starter</artifactId>
</dependency>
```

```yaml
# application.yml
otel:
  service:
    name: my-spring-service
  exporter:
    otlp:
      endpoint: http://localhost:4317
  resource:
    attributes:
      deployment.environment.name: production
```

#### Logback / Log4j2 Bridge

The Java agent automatically bridges Logback and Log4j2 logs into the OTel pipeline. Your existing logging code works without changes:

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

log.info("Payment processed amount={} userId={}", amount, userId);
log.error("Payment failed", exception);
```

These log records are automatically correlated with the active trace span.

---

### Go

```bash
go get go.opentelemetry.io/otel \
  go.opentelemetry.io/otel/sdk \
  go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc \
  go.opentelemetry.io/contrib/bridges/otelslog \
  go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp
```

```go
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func initTracer() func() {
	exporter, _ := otlptracegrpc.New(context.Background(),
		otlptracegrpc.WithEndpoint("localhost:4317"),
		otlptracegrpc.WithInsecure(),
	)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceName("my-go-service"),
			semconv.ServiceVersion("1.0.0"),
			semconv.DeploymentEnvironmentName("production"),
		)),
	)
	otel.SetTracerProvider(tp)
	return func() { tp.Shutdown(context.Background()) }
}

func main() {
	shutdown := initTracer()
	defer shutdown()

	// Use otelslog to bridge slog to OTel
	logger := otelslog.NewLogger("my-go-service")
	slog.SetDefault(logger)

	// Wrap HTTP handlers for automatic trace instrumentation
	handler := otelhttp.NewHandler(http.DefaultServeMux, "server")

	slog.Info("Server starting", "port", 8080)
	http.ListenAndServe(":8080", handler)
}
```

---

### .NET / C#

```bash
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
```

In `Program.cs`:

```csharp
using OpenTelemetry.Logs;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r
        .AddService("my-dotnet-service", serviceVersion: "1.0.0")
        .AddAttributes(new Dictionary<string, object> {
            ["deployment.environment.name"] = "production"
        }))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddOtlpExporter(o => o.Endpoint = new Uri("http://localhost:4317")))
    .WithLogging(logging => logging
        .AddOtlpExporter(o => o.Endpoint = new Uri("http://localhost:4317")));

// Standard ILogger calls are now exported to LogWatch
var app = builder.Build();
app.MapGet("/", (ILogger<Program> logger) => {
    logger.LogInformation("Request received");
    return "Hello";
});
app.Run();
```

---

### Ruby

```bash
gem install opentelemetry-sdk opentelemetry-exporter-otlp opentelemetry-instrumentation-all
```

```ruby
# config/initializers/opentelemetry.rb (Rails)
require 'opentelemetry/sdk'
require 'opentelemetry/exporter/otlp'
require 'opentelemetry/instrumentation/all'

OpenTelemetry::SDK.configure do |c|
  c.service_name = 'my-rails-service'
  c.service_version = '1.0.0'
  c.add_span_processor(
    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(
      OpenTelemetry::Exporter::OTLP::Exporter.new(
        endpoint: 'http://localhost:4317'
      )
    )
  )
  c.use_all  # auto-instrument Rails, ActiveRecord, Net::HTTP, etc.
end
```

---

### Rust

```toml
# Cargo.toml
[dependencies]
opentelemetry = "0.24"
opentelemetry_sdk = "0.24"
opentelemetry-otlp = "0.17"
tracing = "0.1"
tracing-opentelemetry = "0.25"
tracing-subscriber = "0.3"
```

```rust
use opentelemetry::global;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_sdk::Resource;
use opentelemetry::KeyValue;
use tracing_subscriber::layer::SubscriberExt;

fn init_telemetry() {
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint("http://localhost:4317"),
        )
        .with_trace_config(
            opentelemetry_sdk::trace::Config::default()
                .with_resource(Resource::new(vec![
                    KeyValue::new("service.name", "my-rust-service"),
                ]))
        )
        .install_batch(opentelemetry_sdk::runtime::Tokio)
        .unwrap();

    let telemetry_layer = tracing_opentelemetry::layer().with_tracer(tracer);
    let subscriber = tracing_subscriber::registry().with(telemetry_layer);
    tracing::subscriber::set_global_default(subscriber).unwrap();
}
```

---

### Any Language (HTTP JSON)

If no OTel SDK exists for your language, or you want the simplest possible integration, send logs directly via HTTP POST:

```bash
curl -X POST https://logwatch.yourdomain.com/api/v1/ingest/json \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lw_your_api_key" \
  -d '{
    "logs": [
      {
        "timestamp": "2026-05-11T14:30:00.000Z",
        "severity": "ERROR",
        "body": "Failed to connect to database: connection refused",
        "service": "my-service",
        "attributes": {
          "environment": "production",
          "version": "1.2.3",
          "request_id": "req-abc-123",
          "user_id": "user-456",
          "db.host": "postgres-primary",
          "db.port": "5432"
        }
      },
      {
        "timestamp": "2026-05-11T14:30:01.000Z",
        "severity": "INFO",
        "body": "Retrying database connection (attempt 2 of 5)",
        "service": "my-service",
        "attributes": {
          "environment": "production",
          "retry_attempt": "2"
        }
      }
    ]
  }'
```

**JSON payload reference**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | ISO 8601 string | No | Defaults to server receipt time if omitted |
| `severity` | string | No | DEBUG, INFO, WARN, ERROR, FATAL. Defaults to INFO |
| `body` | string | Yes | The log message text |
| `service` | string | Yes | Service name (used for anomaly detection baselines) |
| `attributes` | object | No | Arbitrary key-value metadata |
| `trace_id` | string | No | W3C trace ID (32-char hex) for log-to-trace correlation |
| `span_id` | string | No | W3C span ID (16-char hex) |

You can batch up to **1,000 log records** per request.

---

## OpenTelemetry Collector

The OTel Collector is the recommended way to send data to LogWatch. It decouples your applications from the backend, handles batching, retry, and backpressure, and supports processing pipelines.

### Standalone Collector

A minimal Collector that receives OTLP from your applications and exports to LogWatch:

```yaml
# otel-collector-config.yaml
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
    send_batch_size: 10000

  resource:
    attributes:
      - key: deployment.environment.name
        value: production
        action: upsert

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key"
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp]
    traces:
      receivers: [otlp]
      processors: [batch, resource]
      exporters: [otlphttp]
```

Run the Collector:

```bash
# Docker
docker run -v $(pwd)/otel-collector-config.yaml:/etc/otelcol/config.yaml \
  -p 4317:4317 -p 4318:4318 \
  otel/opentelemetry-collector-contrib:latest

# Binary
otelcol-contrib --config otel-collector-config.yaml
```

### Collector as Gateway

For larger deployments, run the Collector as a central gateway that receives from multiple agent Collectors:

```yaml
# gateway-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:
    timeout: 2s
    send_batch_size: 20000

  memory_limiter:
    check_interval: 1s
    limit_mib: 2048
    spike_limit_mib: 512

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key"
    compression: gzip

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlphttp]
```

### Filtering and Processing

Add processors to filter, transform, or enrich telemetry before it reaches LogWatch:

```yaml
processors:
  # Drop debug-level logs in production
  filter/drop-debug:
    logs:
      log_record:
        - 'severity_number < 9'   # Drop TRACE and DEBUG

  # Add custom attributes to all records
  attributes/enrich:
    actions:
      - key: team
        value: platform
        action: upsert
      - key: region
        value: us-east-1
        action: upsert

  # Mask sensitive data before export
  transform/redact:
    log_statements:
      - context: log
        statements:
          - replace_pattern(body, "Bearer [A-Za-z0-9._-]+", "Bearer ***REDACTED***")

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [filter/drop-debug, attributes/enrich, transform/redact, batch]
      exporters: [otlphttp]
```

---

## Kubernetes

### Cluster-Wide Log Collection

Deploy the OTel Collector as a DaemonSet to collect logs from every pod in the cluster:

```yaml
# otel-collector-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: otel-collector
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      serviceAccountName: otel-collector
      containers:
        - name: collector
          image: otel/opentelemetry-collector-contrib:latest
          args: ["--config=/etc/otel/config.yaml"]
          volumeMounts:
            - name: config
              mountPath: /etc/otel
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: dockercontainers
              mountPath: /var/lib/docker/containers
              readOnly: true
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
        - name: varlog
          hostPath:
            path: /var/log
        - name: dockercontainers
          hostPath:
            path: /var/lib/docker/containers
```

With this ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
  namespace: monitoring
data:
  config.yaml: |
    receivers:
      filelog:
        include:
          - /var/log/pods/*/*/*.log
        operators:
          - type: container
            id: container-parser

      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318

    processors:
      batch:
        timeout: 2s
      k8sattributes:
        extract:
          metadata:
            - k8s.pod.name
            - k8s.namespace.name
            - k8s.deployment.name
            - k8s.node.name
            - k8s.container.name
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.uid

    exporters:
      otlphttp:
        endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
        headers:
          X-API-Key: "lw_your_api_key"

    service:
      pipelines:
        logs:
          receivers: [filelog, otlp]
          processors: [k8sattributes, batch]
          exporters: [otlphttp]
        traces:
          receivers: [otlp]
          processors: [k8sattributes, batch]
          exporters: [otlphttp]
```

### Helm-Based Collector Deployment

Use the official OpenTelemetry Helm chart:

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update

helm install otel-collector open-telemetry/opentelemetry-collector \
  --namespace monitoring --create-namespace \
  --set mode=daemonset \
  --set config.exporters.otlphttp.endpoint=https://logwatch.yourdomain.com/api/v1/ingest/otlp \
  --set config.exporters.otlphttp.headers.X-API-Key=lw_your_api_key
```

### Kubernetes Events

Collect Kubernetes cluster events (pod scheduling, scaling, failures) as log records:

```yaml
receivers:
  k8s_events:
    namespaces: []   # empty = all namespaces
```

Add `k8s_events` to your logs pipeline receivers. Kubernetes events will appear in LogWatch as log records with `service.name: k8s-events` and event details in the body and attributes.

### Pod Annotations for Selective Collection

Use annotations to control which pods are collected:

```yaml
# In your pod spec:
metadata:
  annotations:
    logwatch.dev/collect: "true"
    logwatch.dev/service-name: "payment-service"
    logwatch.dev/environment: "production"
```

Configure the filelog receiver to honour these annotations via the `k8sattributes` processor.

---

## Docker and Docker Compose

### Using the Fluent Bit Docker Log Driver

Configure Docker to send container logs to LogWatch via Fluent Bit:

```yaml
# docker-compose.yml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: fluentd
      options:
        fluentd-address: localhost:24224
        tag: "docker.{{.Name}}"

  fluent-bit:
    image: fluent/fluent-bit:latest
    volumes:
      - ./fluent-bit.conf:/fluent-bit/etc/fluent-bit.conf
    ports:
      - "24224:24224"
```

### Using the OTel Collector with Docker Logs

```yaml
receivers:
  docker_stats:
    endpoint: unix:///var/run/docker.sock
    collection_interval: 10s

  filelog:
    include:
      - /var/lib/docker/containers/*/*.log
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.time
          layout: '%Y-%m-%dT%H:%M:%S.%LZ'
```

---

## Fluent Bit

If you already use Fluent Bit for log collection, configure it to forward to LogWatch:

### HTTP Output (Recommended)

```ini
# fluent-bit.conf
[SERVICE]
    Flush        1
    Log_Level    info

[INPUT]
    Name         tail
    Path         /var/log/app/*.log
    Tag          app.*
    Parser       json

[INPUT]
    Name         systemd
    Tag          host.*
    Systemd_Filter  _SYSTEMD_UNIT=docker.service
    Systemd_Filter  _SYSTEMD_UNIT=nginx.service

[FILTER]
    Name         modify
    Match        *
    Add          service my-service
    Add          environment production

[OUTPUT]
    Name         http
    Match        *
    Host         logwatch.yourdomain.com
    Port         443
    URI          /api/v1/ingest/json
    Format       json_lines
    Header       X-API-Key lw_your_api_key
    Header       Content-Type application/json
    tls          On
    tls.verify   On
    Retry_Limit  5
```

### OpenTelemetry Output

Fluent Bit 2.x+ supports native OTLP output:

```ini
[OUTPUT]
    Name                 opentelemetry
    Match                *
    Host                 logwatch.yourdomain.com
    Port                 443
    Header               X-API-Key lw_your_api_key
    Logs_uri             /api/v1/ingest/otlp/v1/logs
    Tls                  On
    Tls.verify           On
```

---

## Syslog Sources

### Linux Servers (rsyslog)

Forward all syslog messages to LogWatch:

```bash
# /etc/rsyslog.d/99-logwatch.conf
*.* @@logwatch.yourdomain.com:1514;RSYSLOG_SyslogProtocol23Format
```

The `@@` prefix means TCP. The `RSYSLOG_SyslogProtocol23Format` template sends RFC 5424 formatted messages.

Restart rsyslog:

```bash
sudo systemctl restart rsyslog
```

### Linux Servers (syslog-ng)

```
# /etc/syslog-ng/conf.d/logwatch.conf
destination d_logwatch {
    syslog("logwatch.yourdomain.com"
        transport("tcp")
        port(1514)
    );
};

log {
    source(s_sys);
    destination(d_logwatch);
};
```

### Network Devices (Firewalls, Switches, Routers)

Most network devices can forward syslog to a remote server. Configure the device to send syslog to:

```
Server:   logwatch.yourdomain.com
Port:     1514
Protocol: TCP (preferred) or UDP
Format:   RFC 5424 (preferred) or RFC 3164
```

LogWatch normalises both RFC 5424 and RFC 3164 formats into its unified data model. The device hostname, application name, and facility code are preserved as log attributes.

---

## Web Servers

### Nginx

#### Option A: Pipe Logs to Fluent Bit

```nginx
# /etc/nginx/nginx.conf
access_log /var/log/nginx/access.log json_combined;
error_log  /var/log/nginx/error.log warn;

log_format json_combined escape=json
  '{"timestamp":"$time_iso8601",'
   '"severity":"INFO",'
   '"body":"$request_method $request_uri $status",'
   '"service":"nginx",'
   '"attributes":{'
     '"http.method":"$request_method",'
     '"http.url":"$request_uri",'
     '"http.status_code":"$status",'
     '"http.response_time_ms":"$request_time",'
     '"http.client_ip":"$remote_addr",'
     '"http.user_agent":"$http_user_agent",'
     '"http.bytes_sent":"$bytes_sent"'
   '}}';
```

Then configure Fluent Bit to tail `/var/log/nginx/access.log` with a `json` parser.

#### Option B: OTel Collector File Receiver

```yaml
receivers:
  filelog/nginx-access:
    include:
      - /var/log/nginx/access.log
    operators:
      - type: json_parser
      - type: severity_parser
        parse_from: attributes.severity

  filelog/nginx-error:
    include:
      - /var/log/nginx/error.log
    operators:
      - type: regex_parser
        regex: '^(?P<timestamp>\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(?P<severity>\w+)\] (?P<body>.*)'
```

### Apache

Configure Apache to emit JSON access logs:

```apache
LogFormat "{\"timestamp\":\"%{%Y-%m-%dT%H:%M:%S%z}t\",\"severity\":\"INFO\",\"body\":\"%r %s\",\"service\":\"apache\",\"attributes\":{\"http.method\":\"%m\",\"http.url\":\"%U\",\"http.status_code\":\"%s\",\"http.response_time_us\":\"%D\",\"http.client_ip\":\"%a\"}}" logwatch_json
CustomLog /var/log/apache2/access-json.log logwatch_json
```

### Caddy

Caddy natively produces structured JSON logs:

```json
// Caddyfile
{
    log {
        output file /var/log/caddy/access.log
        format json
    }
}
```

Use the OTel Collector `filelog` receiver with a `json_parser` operator.

---

## Databases

### PostgreSQL

Collect PostgreSQL server logs by configuring logging settings and tailing the log file:

```ini
# postgresql.conf
log_destination = 'csvlog'
logging_collector = on
log_directory = '/var/log/postgresql'
log_filename = 'postgresql-%Y-%m-%d.log'
log_min_messages = warning
log_min_error_statement = error
log_min_duration_statement = 1000    # Log queries taking >1s
log_connections = on
log_disconnections = on
log_lock_waits = on
log_statement = 'ddl'               # Log DDL statements
```

Then use the OTel Collector `filelog` receiver:

```yaml
receivers:
  filelog/postgres:
    include:
      - /var/log/postgresql/*.csv
    operators:
      - type: csv_parser
        header: "log_time,user_name,database_name,process_id,connection_from,session_id,session_line_num,command_tag,session_start_time,virtual_transaction_id,transaction_id,error_severity,sql_state_code,message,detail,hint,internal_query,internal_query_pos,context,query,query_pos,location,application_name,backend_type"
    resource:
      service.name: postgresql
```

### MySQL / MariaDB

```ini
# my.cnf
[mysqld]
general_log = 0
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow-query.log
long_query_time = 1
log_error = /var/log/mysql/error.log
log_error_verbosity = 2
```

Tail the error log and slow query log with the OTel Collector `filelog` receiver.

### MongoDB

```yaml
# mongod.conf
systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
  component:
    command:
      verbosity: 1
```

MongoDB emits structured JSON logs natively. Use the OTel Collector `filelog` receiver with `json_parser`.

### Redis

Redis logs to stdout by default (captured by Docker or systemd). For file-based logging:

```
# redis.conf
logfile /var/log/redis/redis-server.log
loglevel notice
```

---

## Message Queues

### RabbitMQ

RabbitMQ writes structured logs since 3.9+:

```ini
# rabbitmq.conf
log.file.level = info
log.dir = /var/log/rabbitmq
log.file = rabbit.log
log.file.formatter = json
```

### Apache Kafka

Kafka uses Log4j2. Configure a JSON appender:

```xml
<!-- log4j2.properties or log4j2.xml -->
<Appenders>
  <File name="json" fileName="/var/log/kafka/kafka.json.log">
    <JsonLayout compact="true" eventEol="true" />
  </File>
</Appenders>
```

---

## Cloud Providers

### AWS (CloudWatch Logs)

Use the OTel Collector with the `awscloudwatchlogs` receiver to pull logs from CloudWatch:

```yaml
receivers:
  awscloudwatchlogs:
    region: us-east-1
    logs:
      - log_group_name: /aws/lambda/my-function
      - log_group_name: /aws/rds/instance/my-db/error
      - log_group_name: /aws/ecs/my-cluster

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key"

service:
  pipelines:
    logs:
      receivers: [awscloudwatchlogs]
      exporters: [otlphttp]
```

Alternatively, use a CloudWatch Logs subscription filter to push logs to a Lambda function that forwards to LogWatch's HTTP JSON endpoint.

### Google Cloud (Cloud Logging)

Use a Pub/Sub log sink and the OTel Collector `googlecloudpubsub` receiver:

```bash
# Create a log sink that routes to Pub/Sub
gcloud logging sinks create logwatch-sink \
  pubsub.googleapis.com/projects/my-project/topics/logwatch-logs \
  --log-filter='resource.type="gce_instance" OR resource.type="cloud_run_revision"'
```

```yaml
receivers:
  googlecloudpubsub:
    project: my-project
    subscription: logwatch-logs-sub

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key"

service:
  pipelines:
    logs:
      receivers: [googlecloudpubsub]
      exporters: [otlphttp]
```

### Azure (Monitor Logs)

Use Azure Event Hubs with the OTel Collector `azureeventhub` receiver:

```bash
# Create an Event Hub for diagnostic logs
az monitor diagnostic-settings create \
  --name logwatch \
  --resource /subscriptions/.../resourceGroups/.../providers/... \
  --event-hub logwatch-logs \
  --event-hub-rule /subscriptions/.../providers/Microsoft.EventHub/namespaces/.../authorizationRules/RootManageSharedAccessKey \
  --logs '[{"categoryGroup":"allLogs","enabled":true}]'
```

```yaml
receivers:
  azureeventhub:
    connection: "Endpoint=sb://my-namespace.servicebus.windows.net/;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=logwatch-logs"

exporters:
  otlphttp:
    endpoint: https://logwatch.yourdomain.com/api/v1/ingest/otlp
    headers:
      X-API-Key: "lw_your_api_key"
```

---

## CI/CD Deployment Tracking

Register deployments with LogWatch so that root-cause analysis can correlate anomalies with recent releases.

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy
        run: |
          # ... your deployment steps ...

      - name: Register deployment with LogWatch
        if: success()
        run: |
          curl -X POST https://logwatch.yourdomain.com/api/v1/deployments \
            -H "Content-Type: application/json" \
            -H "X-API-Key: ${{ secrets.LOGWATCH_API_KEY }}" \
            -d '{
              "service": "${{ github.event.repository.name }}",
              "version": "${{ github.sha }}",
              "commit_sha": "${{ github.sha }}",
              "deployer": "github-actions/${{ github.actor }}",
              "changelog": "PR #${{ github.event.pull_request.number }}: ${{ github.event.pull_request.title }}"
            }'
```

### GitLab CI/CD

```yaml
# .gitlab-ci.yml
register_deployment:
  stage: post-deploy
  script:
    - |
      curl -X POST https://logwatch.yourdomain.com/api/v1/deployments \
        -H "Content-Type: application/json" \
        -H "X-API-Key: ${LOGWATCH_API_KEY}" \
        -d "{
          \"service\": \"${CI_PROJECT_NAME}\",
          \"version\": \"${CI_COMMIT_TAG:-${CI_COMMIT_SHORT_SHA}}\",
          \"commit_sha\": \"${CI_COMMIT_SHA}\",
          \"deployer\": \"gitlab-ci/${GITLAB_USER_LOGIN}\",
          \"changelog\": \"${CI_COMMIT_MESSAGE}\"
        }"
  only:
    - main
    - tags
```

### Jenkins

```groovy
// Jenkinsfile
pipeline {
    stages {
        stage('Deploy') {
            steps {
                // ... your deployment steps ...
            }
        }
        stage('Register Deployment') {
            steps {
                httpRequest(
                    url: "https://logwatch.yourdomain.com/api/v1/deployments",
                    httpMode: 'POST',
                    contentType: 'APPLICATION_JSON',
                    customHeaders: [[name: 'X-API-Key', value: "${LOGWATCH_API_KEY}"]],
                    requestBody: """{
                        "service": "${env.JOB_NAME}",
                        "version": "${env.BUILD_TAG}",
                        "commit_sha": "${env.GIT_COMMIT}",
                        "deployer": "jenkins/${env.BUILD_USER}",
                        "changelog": "${env.GIT_COMMIT_MESSAGE}"
                    }"""
                )
            }
        }
    }
}
```

### Generic Webhook

From any CI/CD system or script:

```bash
curl -X POST https://logwatch.yourdomain.com/api/v1/deployments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lw_your_api_key" \
  -d '{
    "service": "payment-service",
    "version": "v2.3.1",
    "commit_sha": "a7f3c2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
    "deployer": "deploy-script/phil",
    "changelog": "Updated Redis connection pool from 20 to 50 connections"
  }'
```

**Deployment payload reference**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `service` | string | Yes | Service name (must match the `service.name` in your telemetry) |
| `version` | string | Yes | Version string (semver, tag, or build number) |
| `commit_sha` | string | No | 40-char Git commit SHA |
| `deployer` | string | No | Who or what triggered the deployment |
| `changelog` | string | No | Description of changes (shown in RCA reports) |

---

## Custom Attributes and Resource Tags

LogWatch uses OTel resource attributes and log attributes to identify services, environments, and contextual information. Setting these consistently across all data sources enables powerful filtering and anomaly detection.

### Recommended Resource Attributes

Set these on every telemetry source (via OTel SDK, Collector `resource` processor, or JSON payload):

| Attribute | Example | Purpose |
|-----------|---------|---------|
| `service.name` | `payment-service` | Primary service identifier. Used for anomaly baselines. |
| `service.version` | `2.3.1` | Enables deployment correlation in RCA |
| `deployment.environment.name` | `production` | Separates prod/staging/dev data |
| `service.namespace` | `payments` | Groups related services |
| `host.name` | `worker-03` | Identifies the host |
| `k8s.pod.name` | `payment-abc-123` | Kubernetes pod identity |
| `k8s.namespace.name` | `default` | Kubernetes namespace |
| `k8s.deployment.name` | `payment-service` | Kubernetes deployment |

### Recommended Log Attributes

Add these to individual log records for richer context:

| Attribute | Example | Purpose |
|-----------|---------|---------|
| `request_id` | `req-abc-123` | Correlate logs within a single request |
| `user_id` | `user-456` | Identify affected users |
| `http.method` | `POST` | HTTP request context |
| `http.url` | `/api/v1/payments` | HTTP request context |
| `http.status_code` | `500` | HTTP response context |
| `db.system` | `postgresql` | Database operation context |
| `db.statement` | `SELECT ...` | Database query (be cautious with PII) |
| `error.type` | `ConnectionRefused` | Error classification |

---

## Verifying Your Integration

After configuring a data source, verify that logs are reaching LogWatch:

### 1. Check the API Health

```bash
curl https://logwatch.yourdomain.com/api/v1/health
# Expected: {"status":"ok","clickhouse":"ok","postgres":"ok","redis":"ok"}
```

### 2. Send a Test Log

```bash
curl -X POST https://logwatch.yourdomain.com/api/v1/ingest/json \
  -H "Content-Type: application/json" \
  -H "X-API-Key: lw_your_api_key" \
  -d '{
    "logs": [{
      "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
      "severity": "INFO",
      "body": "Integration test from '$HOSTNAME'",
      "service": "integration-test"
    }]
  }'
# Expected: 200 OK
```

### 3. Search for the Test Log

```bash
curl "https://logwatch.yourdomain.com/api/v1/logs?q=integration+test&from=$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ)" \
  -H "Authorization: Bearer <your-jwt>"
```

Or open the LogWatch web UI and search for "integration test".

### 4. Check Per-Service Discovery

Go to **Services** in the LogWatch dashboard. Your service should appear within 60 seconds of the first log record arriving. If it doesn't appear:

- Verify the `service` field (HTTP JSON) or `service.name` resource attribute (OTel) is set
- Check the API server logs for ingestion errors

### 5. Verify Trace Correlation

If you're sending traces, find a log record with a trace ID and click the link. The full trace should display in the trace viewer.

---

## Troubleshooting

### Logs not arriving

| Symptom | Check | Fix |
|---------|-------|-----|
| HTTP 401 Unauthorized | API key is invalid or missing | Regenerate key in Settings > API Keys |
| HTTP 403 Forbidden | API key does not have `ingest` scope | Create a new key with `ingest` scope |
| HTTP 429 Too Many Requests | LogWatch is under backpressure | Check Redis memory (`redis-cli info memory`). Increase `maxmemory` or add capacity. |
| HTTP 503 Service Unavailable | ClickHouse or Redis is down | Check `docker compose ps` or `kubectl get pods` |
| Connection refused | Wrong endpoint URL or port | Verify the URL and port match your deployment |
| OTel Collector shows export errors | Endpoint unreachable from Collector | Check network/firewall rules; test with `curl` from the Collector host |

### Partial data arriving

| Symptom | Check | Fix |
|---------|-------|-----|
| Logs arrive but traces don't | OTel pipeline only exports logs | Add a `traces` pipeline to the Collector config |
| Missing service name | `service.name` attribute not set | Add `resource` processor or set `OTEL_SERVICE_NAME` env var |
| Timestamps wrong | Clock skew or missing timestamp | Sync clocks with NTP; ensure log records include timestamps |
| Syslog messages garbled | Wrong RFC format | Try switching between RFC 5424 and RFC 3164 |
| Log body truncated | Body exceeds 64 KB limit | Reduce log message size or increase `max_body_size` in LogWatch config |

### OTel Collector issues

```bash
# Check Collector logs
docker logs otel-collector

# Verify Collector is receiving data
curl http://localhost:8888/metrics | grep otelcol_receiver_accepted_log_records

# Verify Collector is exporting data
curl http://localhost:8888/metrics | grep otelcol_exporter_sent_log_records

# If exported count < received count, check for export errors:
curl http://localhost:8888/metrics | grep otelcol_exporter_send_failed
```

### Fluent Bit issues

```bash
# Check Fluent Bit logs
fluent-bit -c fluent-bit.conf --verbose

# Common issue: TLS verification fails
# Fix: ensure tls.verify is On and the CA certificate is trusted
# Or for testing: set tls.verify Off (not for production)
```
