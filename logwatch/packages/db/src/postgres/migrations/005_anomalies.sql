-- Migration 005: anomaly_models, anomalies, anomaly_baselines
-- Tracks ML models, detected anomaly events, and per-service statistical baselines.
-- All tables use RLS with tenant isolation via app.current_tenant.

CREATE TABLE anomaly_models (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id            UUID REFERENCES services(id) ON DELETE SET NULL,
    model_type            TEXT NOT NULL,  -- 'logbert', 'statistical_rcf', 'isolation_forest'
    model_version         TEXT NOT NULL DEFAULT '1.0',
    status                TEXT NOT NULL DEFAULT 'training',  -- training, ready, failed, retired
    config                JSONB NOT NULL DEFAULT '{}',
    artifact_path         TEXT,
    training_started_at   TIMESTAMPTZ,
    training_completed_at TIMESTAMPTZ,
    training_log_count    BIGINT,
    precision_score       DOUBLE PRECISION,
    recall_score          DOUBLE PRECISION,
    f1_score              DOUBLE PRECISION,
    false_positive_rate   DOUBLE PRECISION,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomaly_models_tenant ON anomaly_models(tenant_id);

ALTER TABLE anomaly_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON anomaly_models
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE anomalies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id        UUID REFERENCES services(id) ON DELETE SET NULL,
    model_id          UUID REFERENCES anomaly_models(id) ON DELETE SET NULL,
    anomaly_type      TEXT NOT NULL,  -- volume_spike, novel_pattern, error_rate, latency
    severity          TEXT NOT NULL DEFAULT 'info',  -- critical, warning, info
    score             DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    title             TEXT NOT NULL,
    description       TEXT,
    detected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_start      TIMESTAMPTZ NOT NULL,
    window_end        TIMESTAMPTZ NOT NULL,
    sample_log_ids    TEXT[] NOT NULL DEFAULT '{}',
    related_trace_ids TEXT[] NOT NULL DEFAULT '{}',
    status            TEXT NOT NULL DEFAULT 'open',  -- open, acknowledged, resolved, false_positive
    resolved_at       TIMESTAMPTZ,
    resolved_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    user_feedback     TEXT,  -- helpful, not_helpful, false_positive
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomalies_tenant ON anomalies(tenant_id);
CREATE INDEX idx_anomalies_tenant_status ON anomalies(tenant_id, status);
CREATE INDEX idx_anomalies_tenant_detected ON anomalies(tenant_id, detected_at);

ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON anomalies
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE anomaly_baselines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    metric_name     TEXT NOT NULL,  -- error_rate, log_volume, p95_latency
    baseline_mean   DOUBLE PRECISION NOT NULL,
    baseline_stddev DOUBLE PRECISION NOT NULL,
    baseline_p50    DOUBLE PRECISION,
    baseline_p95    DOUBLE PRECISION,
    baseline_p99    DOUBLE PRECISION,
    hourly_pattern  JSONB,  -- { "0": value, "1": value, ... "23": value }
    dow_pattern     JSONB,  -- { "0": Sunday, ... "6": Saturday }
    sample_count    BIGINT NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, service_id, metric_name)
);

CREATE INDEX idx_anomaly_baselines_tenant ON anomaly_baselines(tenant_id);

ALTER TABLE anomaly_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON anomaly_baselines
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
