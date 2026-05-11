-- Migration 007: nl_queries — Stores natural language query history with translation and summarization results.
-- All tables use RLS with tenant isolation via app.current_tenant.

CREATE TABLE nl_queries (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    question          TEXT NOT NULL,  -- the natural language question
    translated_query  TEXT,  -- the generated ClickHouse SQL
    query_params      JSONB NOT NULL DEFAULT '{}',  -- parameters for the translated query
    status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'translating', 'executing', 'summarizing', 'completed', 'failed'
    error             TEXT,  -- error message if failed
    result_count      INT,  -- number of rows returned
    result_summary    TEXT,  -- AI-generated summary of results
    execution_time_ms INT,  -- how long the ClickHouse query took
    model_id          TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',  -- which LLM was used
    prompt_tokens     INT,  -- token usage tracking
    completion_tokens INT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_nl_queries_tenant ON nl_queries(tenant_id);
CREATE INDEX idx_nl_queries_tenant_user ON nl_queries(tenant_id, user_id);
CREATE INDEX idx_nl_queries_tenant_created ON nl_queries(tenant_id, created_at DESC);

ALTER TABLE nl_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON nl_queries
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
