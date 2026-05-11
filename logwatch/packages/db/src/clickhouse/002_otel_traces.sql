CREATE TABLE otel_traces
(
    start_time     DateTime64(9) CODEC(DoubleDelta, LZ4),
    end_time       DateTime64(9) CODEC(DoubleDelta, LZ4),
    duration_ns    UInt64        CODEC(T64, LZ4),

    tenant_id      LowCardinality(String),
    trace_id       String        CODEC(ZSTD(1)),
    span_id        String        CODEC(ZSTD(1)),
    parent_span_id String        CODEC(ZSTD(1)),

    operation_name LowCardinality(String),
    service_name   LowCardinality(String),
    span_kind      LowCardinality(String),
    status_code    LowCardinality(String),
    status_message String        CODEC(ZSTD(1)),

    resource_string          Map(LowCardinality(String), String),
    span_attributes_string   Map(LowCardinality(String), String),
    span_attributes_number   Map(LowCardinality(String), Float64),
    span_attributes_bool     Map(LowCardinality(String), Bool),

    events_name       Array(LowCardinality(String)),
    events_timestamp  Array(DateTime64(9)),
    events_attributes Array(Map(LowCardinality(String), String)),

    links_trace_id Array(String),
    links_span_id  Array(String),

    -- Materialized column: true when status_code = 'ERROR'
    has_error Bool MATERIALIZED status_code = 'ERROR',

    INDEX idx_trace_id  trace_id    TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_span_id   span_id     TYPE bloom_filter(0.01)  GRANULARITY 1,
    INDEX idx_duration  duration_ns TYPE minmax              GRANULARITY 1,
    INDEX idx_status    status_code TYPE set(0)              GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY (tenant_id, toDate(start_time))
ORDER BY (tenant_id, service_name, operation_name, start_time)
TTL toDateTime(start_time) + INTERVAL 14 DAY DELETE
SETTINGS index_granularity = 8192,
         ttl_only_drop_parts = 1;
