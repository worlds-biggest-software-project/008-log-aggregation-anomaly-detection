'use client';

import { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type UserRole = 'viewer' | 'editor' | 'admin';
type ApiKeyScope = 'ingest' | 'query' | 'alerts' | 'admin';
type TabId = 'tenant' | 'users' | 'api-keys' | 'redaction';

interface TenantSettings {
  id: string;
  name: string;
  settings: Record<string, unknown>;
  retention_config: RetentionConfig;
  max_ingest_gb_month: number;
  created_at: string;
  updated_at: string;
}

interface RetentionConfig {
  logs_days: number;
  traces_days: number;
  metrics_days: number;
}

interface User {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ApiKey {
  id: string;
  tenant_id: string;
  created_by: string | null;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  raw_key?: string;
}

interface RedactionRule {
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}

function roleBadgeClass(role: UserRole): string {
  switch (role) {
    case 'admin':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'editor':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'viewer':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function scopeBadgeClass(scope: ApiKeyScope): string {
  switch (scope) {
    case 'admin':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'ingest':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'query':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'alerts':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function appliesToBadgeClass(appliesTo: string): string {
  switch (appliesTo) {
    case 'body':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'attributes':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'all':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

/* ------------------------------------------------------------------ */
/*  Tab definitions                                                   */
/* ------------------------------------------------------------------ */

const TABS: { id: TabId; label: string }[] = [
  { id: 'tenant', label: 'Tenant Settings' },
  { id: 'users', label: 'Users' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'redaction', label: 'Redaction Rules' },
];

const ALL_SCOPES: ApiKeyScope[] = ['ingest', 'query', 'alerts', 'admin'];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('tenant');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Manage tenant configuration, users, API keys, and redaction rules.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-[var(--card-border)]">
        <nav className="flex gap-0 -mb-px" aria-label="Settings tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                activeTab === tab.id
                  ? 'text-white border-b-2 border-[var(--accent)]'
                  : 'text-[var(--muted)] hover:text-white border-b-2 border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'tenant' && <TenantSettingsTab />}
      {activeTab === 'users' && <UsersTab />}
      {activeTab === 'api-keys' && <ApiKeysTab />}
      {activeTab === 'redaction' && <RedactionTab />}
    </div>
  );
}

/* ================================================================== */
/*  Tab 1: Tenant Settings                                            */
/* ================================================================== */

function TenantSettingsTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [logsDays, setLogsDays] = useState(30);
  const [tracesDays, setTracesDays] = useState(30);
  const [metricsDays, setMetricsDays] = useState(90);
  const [maxIngestGb, setMaxIngestGb] = useState(100);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TenantSettings = await res.json();
      setName(data.name ?? '');
      setLogsDays(data.retention_config?.logs_days ?? 30);
      setTracesDays(data.retention_config?.traces_days ?? 30);
      setMetricsDays(data.retention_config?.metrics_days ?? 90);
      setMaxIngestGb(data.max_ingest_gb_month ?? 100);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/v1/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          retention_config: {
            logs_days: logsDays,
            traces_days: tracesDays,
            metrics_days: metricsDays,
          },
          max_ingest_gb_month: maxIngestGb,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess('Settings saved successfully');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSave}
      className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-6 max-w-2xl"
    >
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-400">{success}</p>}

      {/* Tenant name */}
      <div className="flex flex-col gap-1">
        <label htmlFor="tenant-name" className="text-xs text-[var(--muted)]">Tenant Name</label>
        <input
          id="tenant-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </div>

      {/* Retention config */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-white">Retention Config</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="logs-days" className="text-xs text-[var(--muted)]">Logs (days)</label>
            <input
              id="logs-days"
              type="number"
              min={1}
              value={logsDays}
              onChange={(e) => setLogsDays(Number(e.target.value))}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="traces-days" className="text-xs text-[var(--muted)]">Traces (days)</label>
            <input
              id="traces-days"
              type="number"
              min={1}
              value={tracesDays}
              onChange={(e) => setTracesDays(Number(e.target.value))}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="metrics-days" className="text-xs text-[var(--muted)]">Metrics (days)</label>
            <input
              id="metrics-days"
              type="number"
              min={1}
              value={metricsDays}
              onChange={(e) => setMetricsDays(Number(e.target.value))}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Max ingest */}
      <div className="flex flex-col gap-1">
        <label htmlFor="max-ingest" className="text-xs text-[var(--muted)]">Max Ingest (GB/month)</label>
        <input
          id="max-ingest"
          type="number"
          min={1}
          value={maxIngestGb}
          onChange={(e) => setMaxIngestGb(Number(e.target.value))}
          className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] max-w-xs"
        />
      </div>

      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/* ================================================================== */
/*  Tab 2: Users                                                      */
/* ================================================================== */

function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* invite form */
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDisplayName, setInviteDisplayName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('viewer');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  /* delete state */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/users');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setUsers(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteSubmitting(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          display_name: inviteDisplayName || undefined,
          role: inviteRole,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInviteEmail('');
      setInviteDisplayName('');
      setInviteRole('viewer');
      setShowInvite(false);
      await fetchUsers();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchUsers();
    } catch {
      // user can retry
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/admin/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || `HTTP ${res.status}`);
      }
      setConfirmDeleteId(null);
      await fetchUsers();
    } catch {
      // user can retry
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading users...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-sm font-medium text-red-400">Error loading users</p>
        <p className="text-sm text-[var(--muted)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowInvite(!showInvite)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showInvite ? 'Cancel' : 'Invite User'}
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <form
          onSubmit={handleInvite}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">Invite User</h2>
          {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-email" className="text-xs text-[var(--muted)]">Email</label>
              <input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-name" className="text-xs text-[var(--muted)]">Display Name</label>
              <input
                id="invite-name"
                type="text"
                value={inviteDisplayName}
                onChange={(e) => setInviteDisplayName(e.target.value)}
                placeholder="Optional"
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-role" className="text-xs text-[var(--muted)]">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div>
            <button
              type="submit"
              disabled={inviteSubmitting}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {inviteSubmitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
                <th className="px-4 py-2.5 text-left font-medium">Email</th>
                <th className="px-4 py-2.5 text-left font-medium">Display Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Role</th>
                <th className="px-4 py-2.5 text-left font-medium">Last Login</th>
                <th className="px-4 py-2.5 text-left font-medium">Created</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <tr
                  key={user.id}
                  className={`border-b border-[var(--card-border)] last:border-b-0 ${
                    i % 2 === 1 ? 'bg-gray-800/50' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 text-white font-medium">{user.email}</td>
                  <td className="px-4 py-2.5 text-gray-300">{user.display_name ?? '--'}</td>
                  <td className="px-4 py-2.5">
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${roleBadgeClass(user.role)}`}
                    >
                      <option value="viewer">viewer</option>
                      <option value="editor">editor</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{formatDate(user.last_login_at)}</td>
                  <td className="px-4 py-2.5 text-gray-400">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {confirmDeleteId === user.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={deletingId === user.id}
                          onClick={() => handleDelete(user.id)}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === user.id ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(user.id)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {users.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-white">No users found</p>
          <p className="text-sm text-[var(--muted)]">Invite users to get started.</p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 3: API Keys                                                   */
/* ================================================================== */

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* create form */
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createScopes, setCreateScopes] = useState<ApiKeyScope[]>([]);
  const [createExpiry, setCreateExpiry] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* newly created key */
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [keyCopied, setKeyCopied] = useState(false);

  /* delete state */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/api-keys');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setKeys(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch API keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const toggleScope = (scope: ApiKeyScope) => {
    setCreateScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createScopes.length === 0) {
      setCreateError('Select at least one scope');
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/v1/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          scopes: createScopes,
          expires_at: createExpiry || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNewRawKey(data.raw_key);
      setKeyCopied(false);
      setCreateName('');
      setCreateScopes([]);
      setCreateExpiry('');
      setShowCreate(false);
      await fetchKeys();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleCopyKey = async () => {
    if (newRawKey) {
      await navigator.clipboard.writeText(newRawKey);
      setKeyCopied(true);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/admin/api-keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      await fetchKeys();
    } catch {
      // user can retry
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading API keys...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-sm font-medium text-red-400">Error loading API keys</p>
        <p className="text-sm text-[var(--muted)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Newly created key alert */}
      {newRawKey && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm font-medium text-amber-400">
            Save this key -- it won&apos;t be shown again
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-gray-900 border border-[var(--card-border)] px-3 py-2 text-xs text-white font-mono break-all select-all">
              {newRawKey}
            </code>
            <button
              type="button"
              onClick={handleCopyKey}
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors shrink-0"
            >
              {keyCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewRawKey(null)}
            className="text-xs text-[var(--muted)] hover:text-white transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showCreate ? 'Cancel' : 'Create Key'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">New API Key</h2>
          {createError && <p className="text-sm text-red-400">{createError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="key-name" className="text-xs text-[var(--muted)]">Name</label>
              <input
                id="key-name"
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Production ingest"
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="key-expiry" className="text-xs text-[var(--muted)]">Expires At (optional)</label>
              <input
                id="key-expiry"
                type="datetime-local"
                value={createExpiry}
                onChange={(e) => setCreateExpiry(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>

          {/* Scopes checkboxes */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-[var(--muted)]">Scopes</span>
            <div className="flex flex-wrap gap-2">
              {ALL_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${
                    createScopes.includes(scope)
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                      : 'border-[var(--card-border)] bg-gray-700 text-[var(--muted)] hover:bg-gray-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={createScopes.includes(scope)}
                    onChange={() => toggleScope(scope)}
                    className="sr-only"
                  />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={createSubmitting}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {createSubmitting ? 'Creating...' : 'Create Key'}
            </button>
          </div>
        </form>
      )}

      {/* Keys table */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Prefix</th>
                <th className="px-4 py-2.5 text-left font-medium">Scopes</th>
                <th className="px-4 py-2.5 text-left font-medium">Expires</th>
                <th className="px-4 py-2.5 text-left font-medium">Last Used</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key, i) => (
                <tr
                  key={key.id}
                  className={`border-b border-[var(--card-border)] last:border-b-0 ${
                    i % 2 === 1 ? 'bg-gray-800/50' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 text-white font-medium">{key.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs font-mono text-gray-300">{key.key_prefix}...</code>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span
                          key={scope}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${scopeBadgeClass(scope)}`}
                        >
                          {scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-400">{formatDate(key.expires_at)}</td>
                  <td className="px-4 py-2.5 text-gray-400">{formatDate(key.last_used_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {confirmDeleteId === key.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={deletingId === key.id}
                          onClick={() => handleDelete(key.id)}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === key.id ? 'Revoking...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(key.id)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {keys.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-white">No API keys</p>
          <p className="text-sm text-[var(--muted)]">Create an API key to start ingesting data.</p>
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 4: Redaction Rules                                            */
/* ================================================================== */

function RedactionTab() {
  const [rules, setRules] = useState<RedactionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* create form */
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPattern, setCreatePattern] = useState('');
  const [createReplacement, setCreateReplacement] = useState('[REDACTED]');
  const [createAppliesTo, setCreateAppliesTo] = useState<'body' | 'attributes' | 'all'>('all');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  /* delete state */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/admin/redaction-rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRules(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch redaction rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/v1/admin/redaction-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          pattern: createPattern,
          replacement: createReplacement,
          applies_to: createAppliesTo,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCreateName('');
      setCreatePattern('');
      setCreateReplacement('[REDACTED]');
      setCreateAppliesTo('all');
      setShowCreate(false);
      await fetchRules();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleToggleEnabled = async (rule: RedactionRule) => {
    try {
      const res = await fetch(`/api/v1/admin/redaction-rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRules();
    } catch {
      // user can retry
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/admin/redaction-rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      await fetchRules();
    } catch {
      // user can retry
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading redaction rules...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-sm font-medium text-red-400">Error loading redaction rules</p>
        <p className="text-sm text-[var(--muted)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showCreate ? 'Cancel' : 'Add Rule'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">New Redaction Rule</h2>
          {createError && <p className="text-sm text-red-400">{createError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="redact-name" className="text-xs text-[var(--muted)]">Name</label>
              <input
                id="redact-name"
                type="text"
                required
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Credit card numbers"
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="redact-applies" className="text-xs text-[var(--muted)]">Applies To</label>
              <select
                id="redact-applies"
                value={createAppliesTo}
                onChange={(e) => setCreateAppliesTo(e.target.value as 'body' | 'attributes' | 'all')}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
              >
                <option value="all">All</option>
                <option value="body">Body</option>
                <option value="attributes">Attributes</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="redact-pattern" className="text-xs text-[var(--muted)]">Regex Pattern</label>
            <input
              id="redact-pattern"
              type="text"
              required
              value={createPattern}
              onChange={(e) => setCreatePattern(e.target.value)}
              placeholder="e.g. \b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b"
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="redact-replacement" className="text-xs text-[var(--muted)]">Replacement</label>
            <input
              id="redact-replacement"
              type="text"
              required
              value={createReplacement}
              onChange={(e) => setCreateReplacement(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <button
              type="submit"
              disabled={createSubmitting}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {createSubmitting ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      )}

      {/* Rules table */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
                <th className="px-4 py-2.5 text-left font-medium">Name</th>
                <th className="px-4 py-2.5 text-left font-medium">Pattern</th>
                <th className="px-4 py-2.5 text-left font-medium">Replacement</th>
                <th className="px-4 py-2.5 text-left font-medium">Applies To</th>
                <th className="px-4 py-2.5 text-center font-medium">Enabled</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule, i) => (
                <tr
                  key={rule.id}
                  className={`border-b border-[var(--card-border)] last:border-b-0 ${
                    i % 2 === 1 ? 'bg-gray-800/50' : ''
                  }`}
                >
                  <td className="px-4 py-2.5 text-white font-medium">{rule.name}</td>
                  <td className="px-4 py-2.5">
                    <code className="text-xs font-mono text-gray-300 break-all">{rule.pattern}</code>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{rule.replacement}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${appliesToBadgeClass(rule.applies_to)}`}
                    >
                      {rule.applies_to}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleEnabled(rule)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        rule.enabled ? 'bg-[var(--accent)]' : 'bg-gray-600'
                      }`}
                      aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                          rule.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {confirmDeleteId === rule.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          disabled={deletingId === rule.id}
                          onClick={() => handleDelete(rule.id)}
                          className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {deletingId === rule.id ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(rule.id)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {rules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-white">No redaction rules configured</p>
          <p className="text-sm text-[var(--muted)]">Add rules to automatically redact sensitive data from logs.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared components                                                 */
/* ------------------------------------------------------------------ */

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}
