-- Migration 002: services, service_dependencies

CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    namespace       TEXT NOT NULL DEFAULT 'default',
    environment     TEXT NOT NULL DEFAULT 'production',
    language        TEXT,
    owner_team      TEXT,
    repository_url  TEXT,
    tags            JSONB NOT NULL DEFAULT '{}',
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, name, namespace, environment)
);

CREATE INDEX idx_services_tenant ON services(tenant_id);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON services
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE TABLE service_dependencies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    dependency_type   TEXT NOT NULL DEFAULT 'calls',
    discovered_from   TEXT NOT NULL DEFAULT 'traces',
    call_count_24h    BIGINT NOT NULL DEFAULT 0,
    avg_duration_ms   DOUBLE PRECISION,
    error_rate_24h    REAL NOT NULL DEFAULT 0.0,
    last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, source_service_id, target_service_id, dependency_type)
);

CREATE INDEX idx_svc_deps_source ON service_dependencies(source_service_id);
CREATE INDEX idx_svc_deps_target ON service_dependencies(target_service_id);

ALTER TABLE service_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON service_dependencies
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
