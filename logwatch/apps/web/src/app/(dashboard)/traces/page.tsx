'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  duration_ms: number;
  span_count: number;
  has_error: boolean;
  start_time: string;
}

interface TracesResponse {
  data: TraceSummary[];
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

function oneHourAgo(): string {
  const d = new Date(Date.now() - 60 * 60 * 1000);
  // datetime-local expects YYYY-MM-DDTHH:MM
  return d.toISOString().slice(0, 16);
}

function nowLocal(): string {
  return new Date().toISOString().slice(0, 16);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
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

export default function TracesPage() {
  const router = useRouter();

  /* ---- filter state ---- */
  const [service, setService] = useState('');
  const [operation, setOperation] = useState('');
  const [status, setStatus] = useState('');
  const [minDuration, setMinDuration] = useState('');
  const [maxDuration, setMaxDuration] = useState('');
  const [from, setFrom] = useState(oneHourAgo);
  const [to, setTo] = useState('');

  /* ---- result state ---- */
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  /* ---- fetch ---- */
  const fetchTraces = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (from) params.set('from', new Date(from).toISOString());
        if (to) params.set('to', new Date(to).toISOString());
        if (service) params.set('service', service);
        if (operation) params.set('operation', operation);
        if (status) params.set('status', status);
        if (minDuration) params.set('min_duration_ms', minDuration);
        if (maxDuration) params.set('max_duration_ms', maxDuration);
        params.set('limit', String(LIMIT));
        params.set('offset', String(newOffset));

        const res = await fetch(`/api/v1/traces?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TracesResponse = await res.json();

        setTraces(json.data);
        setHasMore(json.pagination.has_more);
        setOffset(newOffset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch traces');
        setTraces([]);
      } finally {
        setLoading(false);
      }
    },
    [from, to, service, operation, status, minDuration, maxDuration],
  );

  /* ---- handlers ---- */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTraces(0);
  };

  const handlePrev = () => {
    if (offset >= LIMIT) fetchTraces(offset - LIMIT);
  };

  const handleNext = () => {
    if (hasMore) fetchTraces(offset + LIMIT);
  };

  /* ---- status dot color ---- */
  const statusDot = (hasError: boolean) => hasError ? 'bg-red-500' : 'bg-green-500';

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Traces</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Search and explore distributed traces across all services.
        </p>
      </div>

      {/* Search / filter bar */}
      <form onSubmit={handleSearch} className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {/* Service */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-service" className="text-xs text-[var(--muted)]">
              Service
            </label>
            <input
              id="trace-service"
              type="text"
              placeholder="e.g. api-gateway"
              value={service}
              onChange={(e) => setService(e.target.value)}
              className="w-44 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Operation */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-operation" className="text-xs text-[var(--muted)]">
              Operation
            </label>
            <input
              id="trace-operation"
              type="text"
              placeholder="e.g. POST /checkout"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              className="w-44 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-status" className="text-xs text-[var(--muted)]">
              Status
            </label>
            <select
              id="trace-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-32 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
            >
              <option value="">All</option>
              <option value="OK">OK</option>
              <option value="ERROR">ERROR</option>
              <option value="UNSET">UNSET</option>
            </select>
          </div>

          {/* Min duration */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-min-dur" className="text-xs text-[var(--muted)]">
              Min (ms)
            </label>
            <input
              id="trace-min-dur"
              type="number"
              min={0}
              placeholder="0"
              value={minDuration}
              onChange={(e) => setMinDuration(e.target.value)}
              className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* Max duration */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-max-dur" className="text-xs text-[var(--muted)]">
              Max (ms)
            </label>
            <input
              id="trace-max-dur"
              type="number"
              min={0}
              placeholder="--"
              value={maxDuration}
              onChange={(e) => setMaxDuration(e.target.value)}
              className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>

        {/* Second row: time range + search button */}
        <div className="flex flex-wrap items-end gap-3">
          {/* From */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-from" className="text-xs text-[var(--muted)]">
              From
            </label>
            <input
              id="trace-from"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>

          {/* To */}
          <div className="flex flex-col gap-1">
            <label htmlFor="trace-to" className="text-xs text-[var(--muted)]">
              To
            </label>
            <input
              id="trace-to"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="now"
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

      {/* Results table */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[120px_140px_180px_90px_80px_70px_160px] gap-4 px-4 py-2.5 border-b border-[var(--card-border)] text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
          <span>Trace ID</span>
          <span>Root Service</span>
          <span>Root Operation</span>
          <span>Duration</span>
          <span>Spans</span>
          <span>Status</span>
          <span>Start Time</span>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="flex items-center gap-3 text-[var(--muted)]">
              <LoadingSpinner />
              <span className="text-sm">Loading traces...</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-sm font-medium text-red-400">Error loading traces</p>
            <p className="text-sm text-[var(--muted)]">{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && traces.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
            <span className="text-4xl select-none" aria-hidden="true">
              &#128269;
            </span>
            <p className="text-sm font-medium text-white">No traces to display</p>
            <p className="text-sm text-[var(--muted)] max-w-xs">
              Adjust your filters and click Search to explore distributed traces.
            </p>
          </div>
        )}

        {/* Rows */}
        {!loading &&
          !error &&
          traces.map((trace) => (
            <button
              key={trace.trace_id}
              type="button"
              onClick={() => router.push(`/traces/${trace.trace_id}`)}
              className="grid grid-cols-[120px_140px_180px_90px_80px_70px_160px] gap-4 px-4 py-2.5 border-b border-[var(--card-border)] text-sm text-left w-full hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] cursor-pointer"
            >
              <span className="font-mono text-blue-400 truncate">
                {trace.trace_id.slice(0, 8)}
              </span>
              <span className="text-cyan-400 truncate">{trace.root_service}</span>
              <span className="text-gray-300 truncate">{trace.root_operation}</span>
              <span className="font-mono text-gray-200">
                {trace.duration_ms.toLocaleString()} ms
              </span>
              <span className="font-mono text-gray-400">{trace.span_count}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${statusDot(trace.has_error)}`}
                />
                <span className="text-xs text-gray-400 uppercase">
                  {trace.has_error ? 'ERROR' : 'OK'}
                </span>
              </span>
              <span className="text-gray-500 text-xs">{formatTime(trace.start_time)}</span>
            </button>
          ))}
      </div>

      {/* Pagination */}
      {!loading && traces.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            Showing {offset + 1}&ndash;{offset + traces.length}
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
