-- Migration 008: deployments, rca_reports
-- Tracks service deployments and AI-generated root-cause analysis reports
-- linked to detected anomalies. Both tables use RLS with tenant isolation
-- via app.current_tenant.

CREATE TABLE deployments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    version       TEXT NOT NULL,
    commit_sha    TEXT,
    deployer      TEXT,
    changelog     TEXT,
    deployed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deployments_tenant ON deployments(tenant_id);
CREATE INDEX idx_deployments_tenant_service ON deployments(tenant_id, service_id);
CREATE INDEX idx_deployments_tenant_deployed ON deployments(tenant_id, deployed_at DESC);

ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON deployments
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE rca_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    anomaly_id        UUID NOT NULL REFERENCES anomalies(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'generating',  -- generating, completed, failed
    narrative         TEXT,  -- the AI-generated root-cause narrative
    probable_cause    TEXT,  -- one-line probable cause
    confidence        DOUBLE PRECISION,  -- 0.0-1.0
    evidence_summary  JSONB NOT NULL DEFAULT '[]',  -- list of evidence items
    model_id          TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    prompt_tokens     INT,
    completion_tokens INT,
    user_feedback     TEXT,  -- helpful, not_helpful, inaccurate
    feedback_comment  TEXT,
    generated_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, anomaly_id)  -- one report per anomaly
);

CREATE INDEX idx_rca_reports_tenant ON rca_reports(tenant_id);
CREATE INDEX idx_rca_reports_tenant_anomaly ON rca_reports(tenant_id, anomaly_id);

ALTER TABLE rca_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON rca_reports
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
