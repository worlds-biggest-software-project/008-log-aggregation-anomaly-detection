'use client';

import { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type ChannelType = 'slack' | 'pagerduty' | 'email' | 'webhook';

interface NotificationChannel {
  id: string;
  tenant_id: string;
  name: string;
  channel_type: ChannelType;
  config: Record<string, unknown>;
  is_verified: boolean;
  created_at: string;
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

function channelTypeBadgeClass(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'pagerduty':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'email':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'webhook':
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function channelTypeLabel(type: ChannelType): string {
  switch (type) {
    case 'slack':
      return 'Slack';
    case 'pagerduty':
      return 'PagerDuty';
    case 'email':
      return 'Email';
    case 'webhook':
      return 'Webhook';
    default:
      return type;
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function NotificationChannelsPage() {
  /* ---- data state ---- */
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- form state ---- */
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ChannelType>('slack');
  const [formWebhookUrl, setFormWebhookUrl] = useState('');
  const [formIntegrationKey, setFormIntegrationKey] = useState('');
  const [formRecipients, setFormRecipients] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formHeaders, setFormHeaders] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /* ---- test / delete state ---- */
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  /* ---- fetch channels ---- */
  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/notifications/channels');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setChannels(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch channels');
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- create channel ---- */
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSubmitting(true);
    setFormError(null);

    let config: Record<string, unknown> = {};
    switch (formType) {
      case 'slack':
        config = { webhook_url: formWebhookUrl };
        break;
      case 'pagerduty':
        config = { integration_key: formIntegrationKey };
        break;
      case 'email':
        config = { recipients: formRecipients.split(',').map((r) => r.trim()).filter(Boolean) };
        break;
      case 'webhook':
        config = { url: formUrl };
        try {
          if (formHeaders.trim()) {
            config.headers = JSON.parse(formHeaders);
          }
        } catch {
          setFormError('Headers must be valid JSON');
          setFormSubmitting(false);
          return;
        }
        break;
    }

    try {
      const res = await fetch('/api/v1/notifications/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName, channel_type: formType, config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Reset form
      setFormName('');
      setFormType('slack');
      setFormWebhookUrl('');
      setFormIntegrationKey('');
      setFormRecipients('');
      setFormUrl('');
      setFormHeaders('');
      setShowForm(false);
      await fetchChannels();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setFormSubmitting(false);
    }
  };

  /* ---- test channel ---- */
  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/v1/notifications/channels/${id}/test`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTestResult({ id, success: json.success, message: json.message });
    } catch (err: unknown) {
      setTestResult({ id, success: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setTestingId(null);
    }
  };

  /* ---- delete channel ---- */
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/v1/notifications/channels/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmDeleteId(null);
      await fetchChannels();
    } catch {
      // silently fail, user can retry
    } finally {
      setDeletingId(null);
    }
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Notification Channels</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Configure where alert notifications are delivered.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showForm ? 'Cancel' : 'Add Channel'}
        </button>
      </div>

      {/* Add channel form */}
      {showForm && (
        <form
          onSubmit={handleCreate}
          className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-6 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">New Notification Channel</h2>

          {formError && (
            <p className="text-sm text-red-400">{formError}</p>
          )}

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="channel-name" className="text-xs text-[var(--muted)]">Name</label>
            <input
              id="channel-name"
              type="text"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="e.g. Production Slack"
              className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Channel type */}
          <div className="flex flex-col gap-1">
            <label htmlFor="channel-type" className="text-xs text-[var(--muted)]">Channel Type</label>
            <select
              id="channel-type"
              value={formType}
              onChange={(e) => setFormType(e.target.value as ChannelType)}
              className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
            >
              <option value="slack">Slack</option>
              <option value="pagerduty">PagerDuty</option>
              <option value="email">Email</option>
              <option value="webhook">Webhook</option>
            </select>
          </div>

          {/* Dynamic config fields */}
          {formType === 'slack' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="slack-webhook" className="text-xs text-[var(--muted)]">Webhook URL</label>
              <input
                id="slack-webhook"
                type="url"
                required
                value={formWebhookUrl}
                onChange={(e) => setFormWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          )}

          {formType === 'pagerduty' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="pd-key" className="text-xs text-[var(--muted)]">Integration Key</label>
              <input
                id="pd-key"
                type="text"
                required
                value={formIntegrationKey}
                onChange={(e) => setFormIntegrationKey(e.target.value)}
                placeholder="PagerDuty integration key"
                className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          )}

          {formType === 'email' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="email-recipients" className="text-xs text-[var(--muted)]">Recipients (comma-separated)</label>
              <textarea
                id="email-recipients"
                required
                rows={3}
                value={formRecipients}
                onChange={(e) => setFormRecipients(e.target.value)}
                placeholder="alice@example.com, bob@example.com"
                className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
              />
            </div>
          )}

          {formType === 'webhook' && (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor="webhook-url" className="text-xs text-[var(--muted)]">URL</label>
                <input
                  id="webhook-url"
                  type="url"
                  required
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="webhook-headers" className="text-xs text-[var(--muted)]">Headers (JSON, optional)</label>
                <textarea
                  id="webhook-headers"
                  rows={3}
                  value={formHeaders}
                  onChange={(e) => setFormHeaders(e.target.value)}
                  placeholder='{"Authorization": "Bearer ..."}'
                  className="w-full max-w-md rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y font-mono text-xs"
                />
              </div>
            </>
          )}

          {/* Submit */}
          <div>
            <button
              type="submit"
              disabled={formSubmitting}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {formSubmitting ? 'Creating...' : 'Create Channel'}
            </button>
          </div>
        </form>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading channels...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading channels</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && channels.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">&#9711;</span>
          <p className="text-sm font-medium text-white">No notification channels configured</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Add a channel to start receiving alerts.
          </p>
        </div>
      )}

      {/* Channel cards */}
      {!loading && !error && channels.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3"
            >
              {/* Top row: type badge + verified indicator */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${channelTypeBadgeClass(channel.channel_type)}`}
                >
                  {channelTypeLabel(channel.channel_type)}
                </span>
                {channel.is_verified ? (
                  <span className="inline-flex items-center gap-1 text-xs text-green-400">
                    <VerifiedIcon />
                    Verified
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">Unverified</span>
                )}
              </div>

              {/* Channel name */}
              <h3 className="text-sm font-bold text-white leading-snug">{channel.name}</h3>

              {/* Created date */}
              <p className="text-xs text-gray-500">Created {relativeTime(channel.created_at)}</p>

              {/* Test result banner */}
              {testResult && testResult.id === channel.id && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    testResult.success
                      ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                      : 'bg-red-500/10 text-red-400 border border-red-500/30'
                  }`}
                >
                  {testResult.message}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={testingId === channel.id}
                  onClick={() => handleTest(channel.id)}
                  className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-xs text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {testingId === channel.id ? 'Testing...' : 'Test'}
                </button>

                {confirmDeleteId === channel.id ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={deletingId === channel.id}
                      onClick={() => handleDelete(channel.id)}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    >
                      {deletingId === channel.id ? 'Deleting...' : 'Confirm'}
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
                    onClick={() => setConfirmDeleteId(channel.id)}
                    className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    Delete
                  </button>
                )}
              </div>
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

function VerifiedIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.03 5.03a.75.75 0 0 0-1.06-1.06L7 7.94 5.53 6.47a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5z" />
    </svg>
  );
}
