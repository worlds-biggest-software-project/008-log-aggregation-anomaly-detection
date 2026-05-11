-- Migration 006: notification_channels, alert_rules, alert_events
-- Defines alerting infrastructure: where to send notifications, under what
-- conditions alerts fire, and a log of every alert event and its delivery results.
-- All tables use RLS with tenant isolation via app.current_tenant.

CREATE TABLE notification_channels (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    channel_type  TEXT NOT NULL,  -- 'slack', 'pagerduty', 'email', 'webhook'
    config        JSONB NOT NULL DEFAULT '{}',
    is_verified   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_channels_tenant ON notification_channels(tenant_id);
CREATE INDEX idx_notification_channels_tenant_type ON notification_channels(tenant_id, channel_type);

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON notification_channels
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE alert_rules (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                        TEXT NOT NULL,
    description                 TEXT,
    enabled                     BOOLEAN NOT NULL DEFAULT true,
    rule_type                   TEXT NOT NULL,  -- 'anomaly', 'log_pattern', 'metric_threshold', 'log_absence'
    condition                   JSONB NOT NULL DEFAULT '{}',
    notification_channel_ids    UUID[] NOT NULL DEFAULT '{}',
    severity                    TEXT NOT NULL DEFAULT 'warning',  -- critical, warning, info
    evaluation_interval_seconds INT NOT NULL DEFAULT 300,
    cooldown_minutes            INT NOT NULL DEFAULT 60,
    mute_until                  TIMESTAMPTZ,
    last_evaluated_at           TIMESTAMPTZ,
    last_fired_at               TIMESTAMPTZ,
    created_by                  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_rules_tenant ON alert_rules(tenant_id);
CREATE INDEX idx_alert_rules_tenant_enabled ON alert_rules(tenant_id, enabled);
CREATE INDEX idx_alert_rules_tenant_type ON alert_rules(tenant_id, rule_type);

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON alert_rules
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE alert_events (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_rule_id         UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    anomaly_id            UUID REFERENCES anomalies(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'firing',  -- 'firing', 'resolved'
    fired_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at           TIMESTAMPTZ,
    notification_results  JSONB NOT NULL DEFAULT '[]',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_events_tenant ON alert_events(tenant_id);
CREATE INDEX idx_alert_events_tenant_rule ON alert_events(tenant_id, alert_rule_id);
CREATE INDEX idx_alert_events_tenant_fired ON alert_events(tenant_id, fired_at DESC);

ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON alert_events
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
