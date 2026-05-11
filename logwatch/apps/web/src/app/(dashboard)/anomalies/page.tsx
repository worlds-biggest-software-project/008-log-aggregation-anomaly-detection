'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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

interface AnomaliesResponse {
  data: Anomaly[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function twentyFourHoursAgo(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

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

/* ---- severity badge ---- */

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

/* ---- status badge ---- */

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

/* ---- anomaly type badge ---- */

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

/* ---- score bar color ---- */

function scoreBarColor(score: number): string {
  if (score >= 0.8) return 'bg-red-500';
  if (score >= 0.5) return 'bg-amber-500';
  return 'bg-blue-500';
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function AnomaliesPage() {
  const router = useRouter();

  /* ---- filter state ---- */
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [from, setFrom] = useState(twentyFourHoursAgo);
  const [to, setTo] = useState('');

  /* ---- result state ---- */
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  /* ---- fetch ---- */
  const fetchAnomalies = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (severityFilter) params.set('severity', severityFilter);
        if (serviceFilter) params.set('service_id', serviceFilter);
        if (from) params.set('from', new Date(from).toISOString());
        if (to) params.set('to', new Date(to).toISOString());
        params.set('limit', String(LIMIT));
        params.set('offset', String(newOffset));

        const res = await fetch(`/api/v1/anomalies?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: AnomaliesResponse = await res.json();

        setAnomalies(json.data);
        setTotal(json.pagination.total);
        setHasMore(json.pagination.has_more);
        setOffset(newOffset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch anomalies');
        setAnomalies([]);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, severityFilter, serviceFilter, from, to],
  );

  /* ---- auto-load on mount ---- */
  useEffect(() => {
    fetchAnomalies(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- handlers ---- */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchAnomalies(0);
  };

  const handlePrev = () => {
    if (offset >= LIMIT) fetchAnomalies(offset - LIMIT);
  };

  const handleNext = () => {
    if (hasMore) fetchAnomalies(offset + LIMIT);
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Anomaly Detection</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Monitor and triage anomalies detected across your services.
        </p>
      </div>

      {/* Filter bar */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Status */}
          <div className="flex flex-col gap-1">
            <label htmlFor="anomaly-status" className="text-xs text-[var(--muted)]">
              Status
            </label>
            <select
              id="anomaly-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
            >
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
              <option value="false_positive">False Positive</option>
            </select>
          </div>

          {/* Severity */}
          <div className="flex flex-col gap-1">
            <label htmlFor="anomaly-severity" className="text-xs text-[var(--muted)]">
              Severity
            </label>
            <select
              id="anomaly-severity"
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

          {/* Service filter */}
          <div className="flex flex-col gap-1">
            <label htmlFor="anomaly-service" className="text-xs text-[var(--muted)]">
              Service
            </label>
            <input
              id="anomaly-service"
              type="text"
              placeholder="Service ID or name"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="w-48 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        {/* Second row: time range + search button */}
        <div className="flex flex-wrap items-end gap-3">
          {/* From */}
          <div className="flex flex-col gap-1">
            <label htmlFor="anomaly-from" className="text-xs text-[var(--muted)]">
              From
            </label>
            <input
              id="anomaly-from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* To */}
          <div className="flex flex-col gap-1">
            <label htmlFor="anomaly-to" className="text-xs text-[var(--muted)]">
              To
            </label>
            <input
              id="anomaly-to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Search */}
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Search
          </button>
        </div>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading anomalies...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading anomalies</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && anomalies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">
            &#9711;
          </span>
          <p className="text-sm font-medium text-white">No anomalies detected</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            No anomalies match your current filters. Adjust the time range or filters and try again.
          </p>
        </div>
      )}

      {/* Anomaly cards */}
      {!loading && !error && anomalies.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {anomalies.map((anomaly) => (
            <button
              key={anomaly.id}
              type="button"
              onClick={() => router.push(`/anomalies/${anomaly.id}`)}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-left transition-colors hover:bg-white/5 hover:border-[var(--accent)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer"
            >
              {/* Top row: severity + status badges */}
              <div className="flex items-center justify-between gap-2 mb-2">
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
              </div>

              {/* Title */}
              <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">
                {anomaly.title}
              </h3>

              {/* Anomaly type badge */}
              <div className="mt-2">
                <span
                  className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${anomalyTypeBadgeClass(anomaly.anomaly_type)}`}
                >
                  {anomalyTypeLabel(anomaly.anomaly_type)}
                </span>
              </div>

              {/* Score bar */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--muted)]">Score</span>
                  <span className="font-mono text-white">{anomaly.score.toFixed(2)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${scoreBarColor(anomaly.score)}`}
                    style={{ width: `${Math.min(anomaly.score * 100, 100)}%` }}
                  />
                </div>
              </div>

              {/* Metadata row */}
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-cyan-400 truncate max-w-[50%]">
                  {anomaly.service_name ?? anomaly.service_id ?? 'Unknown service'}
                </span>
                <span className="text-gray-500 shrink-0">
                  {relativeTime(anomaly.detected_at)}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && anomalies.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            Showing {offset + 1}&ndash;{offset + anomalies.length} of {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={handlePrev}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!hasMore}
              onClick={handleNext}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Next
            </button>
          </div>
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
