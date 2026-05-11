CREATE TABLE otel_logs
(
    timestamp            DateTime64(9) CODEC(DoubleDelta, LZ4),
    observed_timestamp   DateTime64(9) CODEC(DoubleDelta, LZ4),

    id                   UUID DEFAULT generateUUIDv4(),
    tenant_id            LowCardinality(String),

    -- W3C Trace Context correlation
    trace_id             String CODEC(ZSTD(1)),
    span_id              String CODEC(ZSTD(1)),
    trace_flags          UInt8,

    -- OTel severity (1–24)
    severity_text        LowCardinality(String),
    severity_number      UInt8,

    body                 String CODEC(ZSTD(3)),

    -- Resource attributes
    resource_fingerprint String CODEC(ZSTD(1)),
    resource_string      Map(LowCardinality(String), String),

    -- Log attributes (typed maps)
    attributes_string    Map(LowCardinality(String), String),
    attributes_number    Map(LowCardinality(String), Float64),
    attributes_bool      Map(LowCardinality(String), Bool),

    -- Syslog fields (RFC 5424; populated only for syslog sources)
    syslog_facility      UInt8          DEFAULT 0,
    syslog_hostname      LowCardinality(String) DEFAULT '',
    syslog_app_name      LowCardinality(String) DEFAULT '',

    source_type          LowCardinality(String),

    -- Anomaly scores populated asynchronously by the ML pipeline
    anomaly_score        Float32        DEFAULT 0.0,
    anomaly_detected     Bool           DEFAULT false,

    -- Materialized columns derived from resource_string at insert time
    service_name         String MATERIALIZED resource_string['service.name'],
    host_name            String MATERIALIZED resource_string['host.name'],

    INDEX idx_body      body             TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 1,
    INDEX idx_trace_id  trace_id         TYPE bloom_filter(0.01)      GRANULARITY 1,
    INDEX idx_span_id   span_id          TYPE bloom_filter(0.01)      GRANULARITY 1,
    INDEX idx_severity  severity_text    TYPE set(0)                  GRANULARITY 1,
    INDEX idx_source    source_type      TYPE set(0)                  GRANULARITY 1,
    INDEX idx_anomaly   anomaly_detected TYPE set(2)                  GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(timestamp))
ORDER BY (tenant_id, resource_fingerprint, severity_number, timestamp)
TTL toDateTime(timestamp) + INTERVAL 30 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;
