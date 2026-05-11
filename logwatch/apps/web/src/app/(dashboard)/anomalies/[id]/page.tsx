'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Anomaly {
  id: string;
  tenant_id: string;
  service_id: string | null;
  service_name?: string;
  model_id: string | null;
  anomaly_type: string;
  severity: string;
  score: number;
  title: string;
  description: string | null;
  detected_at: string;
  window_start: string;
  window_end: string;
  sample_log_ids: string[];
  related_trace_ids: string[];
  status: string;
  resolved_at: string | null;
  user_feedback: string | null;
  created_at: string;
}

interface AnomalyBaseline {
  metric_name: string;
  baseline_mean: number;
  baseline_stddev: number;
  baseline_p50: number | null;
  baseline_p95: number | null;
  baseline_p99: number | null;
  hourly_pattern: Record<string, number> | null;
  dow_pattern: Record<string, number> | null;
  sample_count: number;
  last_updated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

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

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'open':
      return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
    case 'acknowledged':
      return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    case 'resolved':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'false_positive':
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function statusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case 'false_positive':
      return 'False Positive';
    case 'acknowledged':
      return 'Acknowledged';
    case 'resolved':
      return 'Resolved';
    case 'open':
      return 'Open';
    default:
      return status;
  }
}

function anomalyTypeLabel(anomalyType: string): string {
  switch (anomalyType.toLowerCase()) {
    case 'volume_spike':
      return 'Volume Spike';
    case 'error_rate':
      return 'Error Rate';
    case 'novel_pattern':
      return 'Novel Pattern';
    case 'latency':
      return 'Latency';
    default:
      return anomalyType;
  }
}

function anomalyTypeBadgeClass(anomalyType: string): string {
  switch (anomalyType.toLowerCase()) {
    case 'volume_spike':
      return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
    case 'error_rate':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    case 'novel_pattern':
      return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30';
    case 'latency':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function scoreBarColor(score: number): string {
  if (score >= 0.8) return 'bg-red-500';
  if (score >= 0.5) return 'bg-amber-500';
  return 'bg-blue-500';
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function AnomalyDetailPage() {
  const params = useParams();
  const anomalyId = params.id as string;

  /* ---- data state ---- */
  const [anomaly, setAnomaly] = useState<Anomaly | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [baselines, setBaselines] = useState<AnomalyBaseline[]>([]);
  const [baselinesLoading, setBaselinesLoading] = useState(false);

  const [patching, setPatching] = useState(false);

  /* ---- fetch anomaly ---- */
  const fetchAnomaly = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/anomalies/${anomalyId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: Anomaly = await res.json();
      setAnomaly(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load anomaly');
    } finally {
      setLoading(false);
    }
  }, [anomalyId]);

  /* ---- fetch baselines ---- */
  const fetchBaselines = useCallback(async () => {
    setBaselinesLoading(true);
    try {
      const res = await fetch(`/api/v1/anomalies/${anomalyId}/baselines`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setBaselines(json.baselines ?? []);
    } catch {
      setBaselines([]);
    } finally {
      setBaselinesLoading(false);
    }
  }, [anomalyId]);

  /* ---- load on mount ---- */
  useEffect(() => {
    fetchAnomaly();
    fetchBaselines();
  }, [fetchAnomaly, fetchBaselines]);

  /* ---- PATCH helpers ---- */
  const patchAnomaly = async (body: Record<string, string>) => {
    setPatching(true);
    try {
      const res = await fetch(`/api/v1/anomalies/${anomalyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Refetch to update state
      await fetchAnomaly();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update anomaly');
    } finally {
      setPatching(false);
    }
  };

  const handleAcknowledge = () => patchAnomaly({ status: 'acknowledged' });
  const handleResolve = () => patchAnomaly({ status: 'resolved' });
  const handleFalsePositive = () => patchAnomaly({ status: 'false_positive' });
  const handleFeedback = (feedback: string) => patchAnomaly({ user_feedback: feedback });

  /* ---- render: loading ---- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading anomaly...</span>
        </div>
      </div>
    );
  }

  /* ---- render: error ---- */
  if (error && !anomaly) {
    return (
      <div className="space-y-4">
        <Link
          href="/anomalies"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          &larr; Back to anomalies
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Failed to load anomaly</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  if (!anomaly) return null;

  const currentStatus = anomaly.status.toLowerCase();
  const isTerminal = currentStatus === 'resolved' || currentStatus === 'false_positive';

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/anomalies"
        className="inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        &larr; Back to anomalies
      </Link>

      {/* Header card */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-white leading-snug">
              {anomaly.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${severityBadgeClass(anomaly.severity)}`}
              >
                {anomaly.severity}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(anomaly.status)}`}
              >
                {statusLabel(anomaly.status)}
              </span>
              <span
                className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${anomalyTypeBadgeClass(anomaly.anomaly_type)}`}
              >
                {anomalyTypeLabel(anomaly.anomaly_type)}
              </span>
            </div>
          </div>

          {/* Score */}
          <div className="shrink-0 text-right">
            <span className="text-xs text-[var(--muted)]">Score</span>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="w-20 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${scoreBarColor(anomaly.score)}`}
                  style={{ width: `${Math.min(anomaly.score * 100, 100)}%` }}
                />
              </div>
              <span className="font-mono text-sm text-white font-semibold">
                {anomaly.score.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Metadata grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-[var(--card-border)]">
          <InfoField
            label="Service"
            value={anomaly.service_name ?? anomaly.service_id ?? 'Unknown'}
          />
          <InfoField
            label="Detected at"
            value={formatTimestamp(anomaly.detected_at)}
          />
          <InfoField
            label="Window start"
            value={formatTimestamp(anomaly.window_start)}
          />
          <InfoField
            label="Window end"
            value={formatTimestamp(anomaly.window_end)}
          />
        </div>
      </div>

      {/* Description */}
      {anomaly.description && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
            Description
          </h2>
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {anomaly.description}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Actions
        </h2>

        {/* Error banner */}
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {/* Status actions */}
          <button
            type="button"
            disabled={patching || currentStatus === 'acknowledged' || isTerminal}
            onClick={handleAcknowledge}
            className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Acknowledge
          </button>
          <button
            type="button"
            disabled={patching || currentStatus === 'resolved' || currentStatus === 'false_positive'}
            onClick={handleResolve}
            className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Resolve
          </button>
          <button
            type="button"
            disabled={patching || currentStatus === 'false_positive' || currentStatus === 'resolved'}
            onClick={handleFalsePositive}
            className="rounded-lg border border-gray-500/30 bg-gray-500/10 px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-500/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            False Positive
          </button>

          {/* Separator */}
          <div className="w-px h-8 bg-[var(--card-border)] self-center" />

          {/* Feedback */}
          <button
            type="button"
            disabled={patching || anomaly.user_feedback === 'helpful'}
            onClick={() => handleFeedback('helpful')}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              anomaly.user_feedback === 'helpful'
                ? 'border-green-500/50 bg-green-500/20 text-green-400'
                : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--muted)] hover:text-white hover:bg-white/5 disabled:opacity-40'
            }`}
          >
            Helpful
          </button>
          <button
            type="button"
            disabled={patching || anomaly.user_feedback === 'not_helpful'}
            onClick={() => handleFeedback('not_helpful')}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              anomaly.user_feedback === 'not_helpful'
                ? 'border-red-500/50 bg-red-500/20 text-red-400'
                : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--muted)] hover:text-white hover:bg-white/5 disabled:opacity-40'
            }`}
          >
            Not Helpful
          </button>
        </div>

        {anomaly.user_feedback && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Feedback recorded: <span className="text-white">{anomaly.user_feedback === 'not_helpful' ? 'Not Helpful' : 'Helpful'}</span>
          </p>
        )}
      </div>

      {/* Sample Logs */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Sample Logs
        </h2>
        {anomaly.sample_log_ids.length === 0 ? (
          <p className="text-sm text-gray-500">No sample logs</p>
        ) : (
          <div className="space-y-1.5">
            {anomaly.sample_log_ids.map((logId) => (
              <div key={logId} className="flex items-center">
                <Link
                  href={`/logs?id=${logId}`}
                  className="font-mono text-sm text-blue-400 hover:text-blue-300 transition-colors truncate"
                >
                  {logId}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Correlated Traces */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Correlated Traces
        </h2>
        {anomaly.related_trace_ids.length === 0 ? (
          <p className="text-sm text-gray-500">No correlated traces</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {anomaly.related_trace_ids.map((traceId) => (
              <Link
                key={traceId}
                href={`/traces/${traceId}`}
                className="inline-flex items-center rounded-lg bg-gray-950 px-3 py-1.5 font-mono text-sm text-blue-400 hover:text-blue-300 hover:bg-gray-900 transition-colors"
              >
                {traceId.slice(0, 8)}...
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Baselines */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Baselines
        </h2>

        {baselinesLoading && (
          <div className="flex items-center gap-2 py-8 justify-center text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading baselines...</span>
          </div>
        )}

        {!baselinesLoading && baselines.length === 0 && (
          <p className="text-sm text-gray-500">No baseline data available</p>
        )}

        {!baselinesLoading && baselines.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {baselines.map((baseline) => (
              <BaselineCard key={baseline.metric_name} baseline={baseline} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <p className="text-sm text-white mt-0.5 truncate">{value}</p>
    </div>
  );
}

function BaselineCard({ baseline }: { baseline: AnomalyBaseline }) {
  const hasHourlyPattern =
    baseline.hourly_pattern && Object.keys(baseline.hourly_pattern).length > 0;

  // Compute max value for the hourly bar chart
  let hourlyMax = 1;
  let hourlyEntries: [string, number][] = [];
  if (hasHourlyPattern && baseline.hourly_pattern) {
    hourlyEntries = Object.entries(baseline.hourly_pattern).sort(
      ([a], [b]) => Number(a) - Number(b),
    );
    hourlyMax = Math.max(...hourlyEntries.map(([, v]) => v), 1);
  }

  return (
    <div className="rounded-lg bg-gray-950 border border-gray-800 p-4">
      {/* Metric name */}
      <h3 className="text-sm font-semibold text-white mb-3">{baseline.metric_name}</h3>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <span className="text-[var(--muted)]">Mean</span>
          <p className="font-mono text-gray-300">
            {baseline.baseline_mean.toFixed(2)} &plusmn; {baseline.baseline_stddev.toFixed(2)}
          </p>
        </div>
        <div>
          <span className="text-[var(--muted)]">Sample count</span>
          <p className="font-mono text-gray-300">{baseline.sample_count.toLocaleString()}</p>
        </div>
        {baseline.baseline_p50 !== null && (
          <div>
            <span className="text-[var(--muted)]">p50</span>
            <p className="font-mono text-gray-300">{baseline.baseline_p50.toFixed(2)}</p>
          </div>
        )}
        {baseline.baseline_p95 !== null && (
          <div>
            <span className="text-[var(--muted)]">p95</span>
            <p className="font-mono text-gray-300">{baseline.baseline_p95.toFixed(2)}</p>
          </div>
        )}
        {baseline.baseline_p99 !== null && (
          <div>
            <span className="text-[var(--muted)]">p99</span>
            <p className="font-mono text-gray-300">{baseline.baseline_p99.toFixed(2)}</p>
          </div>
        )}
      </div>

      {/* Hourly pattern bar chart */}
      {hasHourlyPattern && (
        <div className="mt-4">
          <span className="text-xs text-[var(--muted)]">Hourly pattern</span>
          <div className="flex items-end gap-px mt-2 h-16">
            {hourlyEntries.map(([hour, value]) => {
              const heightPct = Math.max((value / hourlyMax) * 100, 2);
              return (
                <div
                  key={hour}
                  className="flex-1 group relative"
                  title={`Hour ${hour}: ${value.toFixed(1)}`}
                >
                  <div
                    className="w-full rounded-t-sm bg-[var(--accent)] opacity-70 group-hover:opacity-100 transition-opacity"
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-600">
            <span>0h</span>
            <span>6h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
        </div>
      )}
    </div>
  );
}

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
