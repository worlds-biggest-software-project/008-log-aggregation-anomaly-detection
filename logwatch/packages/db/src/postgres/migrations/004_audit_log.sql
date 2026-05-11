-- Migration 004: audit_log (range-partitioned by created_at)
-- New monthly partitions must be created before each month begins.
-- The initial partition covers the current month at migration time.

CREATE TABLE audit_log (
    id            UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    actor_id      UUID,
    actor_type    TEXT NOT NULL,
    action        TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id   UUID,
    changes       JSONB,
    ip_address    INET,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Composite PK must include the partition key (created_at).
ALTER TABLE audit_log ADD PRIMARY KEY (id, created_at);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- Initial partition: current calendar month.
-- Uses date_trunc so the migration is idempotent regardless of run day.
DO $$
DECLARE
    month_start  TIMESTAMPTZ := date_trunc('month', now());
    month_end    TIMESTAMPTZ := date_trunc('month', now()) + INTERVAL '1 month';
    part_name    TEXT        := 'audit_log_' || to_char(now(), 'YYYY_MM');
BEGIN
    EXECUTE format(
        'CREATE TABLE %I PARTITION OF audit_log FOR VALUES FROM (%L) TO (%L)',
        part_name, month_start, month_end
    );
END;
$$;
