-- Migration 003: redaction_rules

CREATE TABLE redaction_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    rule_type   TEXT NOT NULL DEFAULT 'custom',
    pattern     TEXT NOT NULL,
    replacement TEXT NOT NULL DEFAULT '***REDACTED***',
    applies_to  TEXT NOT NULL DEFAULT 'all',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_redaction_rules_tenant ON redaction_rules(tenant_id, enabled) WHERE enabled = TRUE;

ALTER TABLE redaction_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON redaction_rules
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
