'use client';

import { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ChannelType = 'slack' | 'pagerduty' | 'email' | 'webhook';
type RuleType = 'anomaly' | 'log_pattern' | 'metric_threshold' | 'log_absence';

interface AlertRule {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rule_type: RuleType;
  condition: AlertCondition;
  notification_channel_ids: string[];
  severity: string;
  evaluation_interval_seconds: number;
  cooldown_minutes: number;
  mute_until: string | null;
  last_evaluated_at: string | null;
  last_fired_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface AlertCondition {
  anomaly_type?: string;
  severity_gte?: string;
  query_type?: string;
  query?: string;
  operator?: string;
  threshold?: number;
  pattern?: string;
  absence_window_minutes?: number;
}

interface NotificationChannel {
  id: string;
  name: string;
  channel_type: ChannelType;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function severityBadgeClass(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'critical':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'warning':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'info':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function ruleTypeBadgeClass(ruleType: string): string {
  switch (ruleType) {
    case 'anomaly':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'log_pattern':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'metric_threshold':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    case 'log_absence':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function ruleTypeLabel(ruleType: string): string {
  switch (ruleType) {
    case 'anomaly':
      return 'Anomaly';
    case 'log_pattern':
      return 'Log Pattern';
    case 'metric_threshold':
      return 'Metric Threshold';
    case 'log_absence':
      return 'Log Absence';
    default:
      return ruleType;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/* ------------------------------------------------------------------ */
/*  Mute duration options                                             */
/* ------------------------------------------------------------------ */

const MUTE_DURATIONS = [
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
  { label: '4 hours', minutes: 240 },
  { label: '24 hours', minutes: 1440 },
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function AlertRulesPage() {
  /* ---- data state ---- */
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- filter state ---- */
  const [ruleTypeFilter, setRuleTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'' | 'true' | 'false'>('');

  /* ---- form state ---- */
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formRuleType, setFormRuleType] = useState<RuleType>('anomaly');
  const [formSeverity, setFormSeverity] = useState('warning');
  const [formAnomalyType, setFormAnomalyType] = useState('');
  const [formSeverityGte, setFormSeverityGte] = useState('warning');
  const [formConditionJson, setFormConditionJson] = useState('');
  const [formChannelIds, setFormChannelIds] = useState<string[]>([]);
  const [formEvalInterval, setFormEvalInterval] = useState(60);
  const [formCooldown, setFormCooldown] = useState(15);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ---- mute state ---- */
  const [muteRuleId, setMuteRuleId] = useState<string | null>(null);
  const [customMuteMinutes, setCustomMuteMinutes] = useState(60);

  /* ---- delete state ---- */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* ---- fetch rules ---- */
  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/alerts/rules');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRules(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch rules');
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ---- fetch channels for form multi-select ---- */
  const fetchChannels = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/notifications/channels');
      if (!res.ok) return;
      const json = await res.json();
      setChannels(json.data);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchChannels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- create rule ---- */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    let condition: AlertCondition = {};
    if (formRuleType === 'anomaly') {
      condition = {
        anomaly_type: formAnomalyType || undefined,
        severity_gte: formSeverityGte,
      };
    } else {
      try {
        condition = formConditionJson.trim() ? JSON.parse(formConditionJson) : {};
      } catch {
        setFormError('Condition must be valid JSON');
        setFormSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/v1/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          description: formDescription || null,
          rule_type: formRuleType,
          condition,
          notification_channel_ids: formChannelIds,
          severity: formSeverity,
          evaluation_interval_seconds: formEvalInterval,
          cooldown_minutes: formCooldown,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFormName('');
      setFormDescription('');
      setFormRuleType('anomaly');
      setFormSeverity('warning');
      setFormAnomalyType('');
      setFormSeverityGte('warning');
      setFormConditionJson('');
      setFormChannelIds([]);
      setFormEvalInterval(60);
      setFormCooldown(15);
      setShowForm(false);
      await fetchRules();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create rule');
    } finally {
      setFormSubmitting(false);
    }
  };

  /* ---- toggle enabled ---- */
  const handleToggleEnabled = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/v1/alerts/rules/${rule.id}`, {
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

  /* ---- mute rule ---- */
  const handleMute = async (ruleId: string, durationMinutes: number) => {
    try {
      const res = await fetch(`/api/v1/alerts/rules/${ruleId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: durationMinutes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMuteRuleId(null);
      await fetchRules();
    } catch {
      // user can retry
    }
  };

  /* ---- unmute rule ---- */
  const handleUnmute = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/v1/alerts/rules/${ruleId}/mute`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchRules();
    } catch {
      // user can retry
    }
  };

  /* ---- delete rule ---- */
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/alerts/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      await fetchRules();
    } catch {
      // user can retry
    } finally {
      setDeletingId(null);
    }
  };

  /* ---- toggle channel selection in form ---- */
  const toggleChannelId = (id: string) => {
    setFormChannelIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  /* ---- filtered rules ---- */
  const filteredRules = rules.filter((r) => {
    if (ruleTypeFilter && r.rule_type !== ruleTypeFilter) return false;
    if (severityFilter && r.severity !== severityFilter) return false;
    if (enabledFilter === 'true' && !r.enabled) return false;
    if (enabledFilter === 'false' && r.enabled) return false;
    return true;
  });

  /* ---- is rule currently muted? ---- */
  const isMuted = (rule: AlertRule): boolean => {
    if (!rule.mute_until) return false;
    return new Date(rule.mute_until).getTime() > Date.now();
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Alert Rules</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Define rules that trigger alert notifications.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showForm ? 'Cancel' : 'Create Rule'}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="rule-type-filter" className="text-xs text-[var(--muted)]">Rule Type</label>
          <select
            id="rule-type-filter"
            value={ruleTypeFilter}
            onChange={(e) => setRuleTypeFilter(e.target.value)}
            className="w-44 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">All Types</option>
            <option value="anomaly">Anomaly</option>
            <option value="log_pattern">Log Pattern</option>
            <option value="metric_threshold">Metric Threshold</option>
            <option value="log_absence">Log Absence</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="severity-filter" className="text-xs text-[var(--muted)]">Severity</label>
          <select
            id="severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="w-36 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="enabled-filter" className="text-xs text-[var(--muted)]">Status</label>
          <select
            id="enabled-filter"
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value as '' | 'true' | 'false')}
            className="w-36 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">All</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </div>
      </div>

      {/* Create rule form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">New Alert Rule</h2>

          {formError && (
            <p className="text-sm text-red-400">{formError}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-name" className="text-xs text-[var(--muted)]">Name</label>
              <input
                id="rule-name"
                type="text"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. High error rate alert"
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            {/* Rule type */}
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-type" className="text-xs text-[var(--muted)]">Rule Type</label>
              <select
                id="rule-type"
                value={formRuleType}
                onChange={(e) => setFormRuleType(e.target.value as RuleType)}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
              >
                <option value="anomaly">Anomaly</option>
                <option value="log_pattern">Log Pattern</option>
                <option value="metric_threshold">Metric Threshold</option>
                <option value="log_absence">Log Absence</option>
              </select>
            </div>

            {/* Severity */}
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-severity" className="text-xs text-[var(--muted)]">Severity</label>
              <select
                id="rule-severity"
                value={formSeverity}
                onChange={(e) => setFormSeverity(e.target.value)}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </div>

            {/* Evaluation interval */}
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-eval-interval" className="text-xs text-[var(--muted)]">Evaluation Interval (seconds)</label>
              <input
                id="rule-eval-interval"
                type="number"
                min={10}
                required
                value={formEvalInterval}
                onChange={(e) => setFormEvalInterval(Number(e.target.value))}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>

            {/* Cooldown */}
            <div className="flex flex-col gap-1">
              <label htmlFor="rule-cooldown" className="text-xs text-[var(--muted)]">Cooldown (minutes)</label>
              <input
                id="rule-cooldown"
                type="number"
                min={1}
                required
                value={formCooldown}
                onChange={(e) => setFormCooldown(Number(e.target.value))}
                className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1">
            <label htmlFor="rule-description" className="text-xs text-[var(--muted)]">Description (optional)</label>
            <textarea
              id="rule-description"
              rows={2}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder="Describe what this rule monitors..."
              className="w-full rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
            />
          </div>

          {/* Condition config */}
          {formRuleType === 'anomaly' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="anomaly-type-cond" className="text-xs text-[var(--muted)]">Anomaly Type (optional)</label>
                <select
                  id="anomaly-type-cond"
                  value={formAnomalyType}
                  onChange={(e) => setFormAnomalyType(e.target.value)}
                  className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
                >
                  <option value="">Any</option>
                  <option value="volume_spike">Volume Spike</option>
                  <option value="error_rate">Error Rate</option>
                  <option value="novel_pattern">Novel Pattern</option>
                  <option value="latency">Latency</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="severity-gte-cond" className="text-xs text-[var(--muted)]">Minimum Severity</label>
                <select
                  id="severity-gte-cond"
                  value={formSeverityGte}
                  onChange={(e) => setFormSeverityGte(e.target.value)}
                  className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label htmlFor="condition-json" className="text-xs text-[var(--muted)]">Condition (JSON)</label>
              <textarea
                id="condition-json"
                rows={4}
                value={formConditionJson}
                onChange={(e) => setFormConditionJson(e.target.value)}
                placeholder='{"pattern": "OutOfMemory", "threshold": 5}'
                className="w-full rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y font-mono text-xs"
              />
            </div>
          )}

          {/* Notification channels multi-select */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-[var(--muted)]">Notification Channels</span>
            {channels.length === 0 ? (
              <p className="text-xs text-gray-500">No channels configured. Create a channel first.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {channels.map((ch) => (
                  <label
                    key={ch.id}
                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer transition-colors ${
                      formChannelIds.includes(ch.id)
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                        : 'border-[var(--card-border)] bg-gray-700 text-[var(--muted)] hover:bg-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={formChannelIds.includes(ch.id)}
                      onChange={() => toggleChannelId(ch.id)}
                      className="sr-only"
                    />
                    <span>{ch.name}</span>
                    <span className="opacity-60">({ch.channel_type})</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Submit */}
          <div>
            <button
              type="submit"
              disabled={formSubmitting}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {formSubmitting ? 'Creating...' : 'Create Rule'}
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading rules...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading rules</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredRules.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">&#9711;</span>
          <p className="text-sm font-medium text-white">No alert rules configured</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Create a rule to start monitoring.
          </p>
        </div>
      )}

      {/* Rule cards */}
      {!loading && !error && filteredRules.length > 0 && (
        <div className="space-y-4">
          {filteredRules.map((rule) => (
            <div
              key={rule.id}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3"
            >
              {/* Top row: badges + enabled toggle */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${ruleTypeBadgeClass(rule.rule_type)}`}
                  >
                    {ruleTypeLabel(rule.rule_type)}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${severityBadgeClass(rule.severity)}`}
                  >
                    {rule.severity}
                  </span>
                  {isMuted(rule) ? (
                    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                      Muted until {formatDate(rule.mute_until!)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs text-green-400">
                      Active
                    </span>
                  )}
                </div>
                {/* Enabled toggle */}
                <button
                  type="button"
                  onClick={() => handleToggleEnabled(rule)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                    rule.enabled ? 'bg-[var(--accent)]' : 'bg-gray-600'
                  }`}
                  aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      rule.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Rule name */}
              <h3 className="text-sm font-bold text-white leading-snug">{rule.name}</h3>

              {/* Description */}
              {rule.description && (
                <p className="text-xs text-[var(--muted)]">{rule.description}</p>
              )}

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>{rule.cooldown_minutes} min cooldown</span>
                <span>Notifies {rule.notification_channel_ids.length} channel(s)</span>
                {rule.last_evaluated_at && (
                  <span>Last evaluated {relativeTime(rule.last_evaluated_at)}</span>
                )}
                {rule.last_fired_at && (
                  <span>Last fired {relativeTime(rule.last_fired_at)}</span>
                )}
              </div>

              {/* Actions row */}
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  type="button"
                  disabled
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--muted)] opacity-50 cursor-not-allowed"
                >
                  Edit
                </button>

                {isMuted(rule) ? (
                  <button
                    type="button"
                    onClick={() => handleUnmute(rule.id)}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    Unmute
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMuteRuleId(muteRuleId === rule.id ? null : rule.id)}
                    className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Mute
                  </button>
                )}

                {confirmDeleteId === rule.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={deletingId === rule.id}
                      onClick={() => handleDelete(rule.id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {deletingId === rule.id ? 'Deleting...' : 'Confirm'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(rule.id)}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Delete
                  </button>
                )}
              </div>

              {/* Mute duration picker */}
              {muteRuleId === rule.id && (
                <div className="rounded-lg border border-[var(--card-border)] bg-gray-800 p-3 space-y-2">
                  <p className="text-xs text-[var(--muted)]">Mute for:</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {MUTE_DURATIONS.map((opt) => (
                      <button
                        key={opt.minutes}
                        type="button"
                        onClick={() => handleMute(rule.id, opt.minutes)}
                        className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        {opt.label}
                      </button>
                    ))}
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={customMuteMinutes}
                        onChange={(e) => setCustomMuteMinutes(Number(e.target.value))}
                        className="w-20 rounded-lg border border-[var(--card-border)] bg-gray-700 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      />
                      <span className="text-xs text-[var(--muted)]">min</span>
                      <button
                        type="button"
                        onClick={() => handleMute(rule.id, customMuteMinutes)}
                        className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline icons                                                      */
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
