export type UserRole = 'viewer' | 'editor' | 'admin';
export type PlanTier = 'free' | 'pro' | 'enterprise';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  settings: Record<string, unknown>;
  retention_config: RetentionConfig;
  max_ingest_gb_month: number | null;
  created_at: string;
  updated_at: string;
}

export interface RetentionConfig {
  logs_days: number;
  traces_days: number;
  metrics_days: number;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  identity_provider: string | null;
  external_id: string | null;
  role: UserRole;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  created_by: string | null;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

export type ApiKeyScope = 'ingest' | 'query' | 'alerts' | 'admin';

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  namespace: string;
  environment: string;
  language: string | null;
  owner_team: string | null;
  repository_url: string | null;
  tags: Record<string, string>;
  first_seen_at: string;
  last_seen_at: string;
}

export interface ServiceDependency {
  id: string;
  tenant_id: string;
  source_service_id: string;
  target_service_id: string;
  dependency_type: string;
  discovered_from: 'traces' | 'manual' | 'config';
  call_count_24h: number;
  avg_duration_ms: number | null;
  error_rate_24h: number;
  last_seen_at: string;
}

export interface Deployment {
  id: string;
  tenant_id: string;
  service_id: string;
  version: string;
  commit_sha: string | null;
  deployer: string | null;
  changelog: string | null;
  deployed_at: string;
  created_at: string;
}

export interface RedactionRule {
  id: string;
  tenant_id: string;
  name: string;
  rule_type: 'custom' | 'builtin';
  pattern: string;
  replacement: string;
  applies_to: 'body' | 'attributes' | 'all';
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
