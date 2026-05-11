-- Migration 009: ingest_usage, sampling_recommendations
-- Tracks daily ingestion volumes per service and AI-generated sampling
-- recommendations to reduce cost on high-volume / low-signal log patterns.
-- Both tables use RLS with tenant isolation via app.current_tenant.

CREATE TABLE ingest_usage (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id        UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    date              DATE NOT NULL,
    log_count         BIGINT NOT NULL DEFAULT 0,
    log_bytes         BIGINT NOT NULL DEFAULT 0,
    trace_count       BIGINT NOT NULL DEFAULT 0,
    trace_bytes       BIGINT NOT NULL DEFAULT 0,
    estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, service_id, date)
);

CREATE INDEX idx_ingest_usage_tenant ON ingest_usage(tenant_id);
CREATE INDEX idx_ingest_usage_tenant_date ON ingest_usage(tenant_id, date);
CREATE INDEX idx_ingest_usage_tenant_service_date ON ingest_usage(tenant_id, service_id, date);

ALTER TABLE ingest_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ingest_usage
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE sampling_recommendations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id              UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    pattern                 TEXT NOT NULL,
    current_volume_daily    BIGINT NOT NULL,
    recommended_sample_rate DOUBLE PRECISION NOT NULL,
    estimated_savings_pct   DOUBLE PRECISION NOT NULL,
    reasoning               TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending',
    applied_at              TIMESTAMPTZ,
    applied_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, service_id, pattern)
);

CREATE INDEX idx_sampling_recommendations_tenant ON sampling_recommendations(tenant_id);
CREATE INDEX idx_sampling_recommendations_tenant_service ON sampling_recommendations(tenant_id, service_id);
CREATE INDEX idx_sampling_recommendations_tenant_status ON sampling_recommendations(tenant_id, status);

ALTER TABLE sampling_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sampling_recommendations
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
