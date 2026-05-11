'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type AlertEventStatus = 'firing' | 'resolved';
type ChannelType = 'slack' | 'pagerduty' | 'email' | 'webhook';

interface NotificationResult {
  channel_id: string;
  channel_type: ChannelType;
  success: boolean;
  error?: string;
  sent_at: string;
}

interface AlertEvent {
  id: string;
  tenant_id: string;
  alert_rule_id: string;
  rule_name?: string;
  anomaly_id: string | null;
  status: AlertEventStatus;
  fired_at: string;
  resolved_at: string | null;
  notification_results: NotificationResult[];
  created_at: string;
}

interface AlertEventsResponse {
  data: AlertEvent[];
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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
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

export default function AlertEventsPage() {
  /* ---- data state ---- */
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  /* ---- filter state ---- */
  const [statusFilter, setStatusFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [limit, setLimit] = useState(25);

  /* ---- fetch events ---- */
  const fetchEvents = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (statusFilter) params.set('status', statusFilter);
        if (fromDate) params.set('from', new Date(fromDate).toISOString());
        if (toDate) params.set('to', new Date(toDate).toISOString());
        params.set('limit', String(limit));
        params.set('offset', String(newOffset));

        const res = await fetch(`/api/v1/alerts/events?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: AlertEventsResponse = await res.json();

        setEvents(json.data);
        setTotal(json.pagination.total);
        setHasMore(json.pagination.has_more);
        setOffset(newOffset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch events');
        setEvents([]);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, fromDate, toDate, limit],
  );

  useEffect(() => {
    fetchEvents(0);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- handlers ---- */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEvents(0);
  };

  const handlePrev = () => {
    if (offset >= limit) fetchEvents(offset - limit);
  };

  const handleNext = () => {
    if (hasMore) fetchEvents(offset + limit);
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Alert Events</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Timeline of alert rule firings and resolutions.
        </p>
      </div>

      {/* Filter bar */}
      <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="event-status" className="text-xs text-[var(--muted)]">Status</label>
          <select
            id="event-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-36 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">All</option>
            <option value="firing">Firing</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="event-from" className="text-xs text-[var(--muted)]">From</label>
          <input
            id="event-from"
            type="datetime-local"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="event-to" className="text-xs text-[var(--muted)]">To</label>
          <input
            id="event-to"
            type="datetime-local"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="event-limit" className="text-xs text-[var(--muted)]">Limit</label>
          <select
            id="event-limit"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Search
        </button>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading events...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading events</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && events.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">&#9711;</span>
          <p className="text-sm font-medium text-white">No alert events yet</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Events will appear when alert rules fire.
          </p>
        </div>
      )}

      {/* Timeline */}
      {!loading && !error && events.length > 0 && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-700" />

          <div className="space-y-4">
            {events.map((event) => (
              <div key={event.id} className="relative pl-10">
                {/* Timeline dot */}
                <div
                  className={`absolute left-2.5 top-4 h-3 w-3 rounded-full border-2 border-gray-900 ${
                    event.status === 'firing' ? 'bg-red-500' : 'bg-green-500'
                  }`}
                />

                {/* Event card */}
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3">
                  {/* Top row: status + timestamp */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${
                        event.status === 'firing'
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : 'bg-green-500/20 text-green-400 border-green-500/30'
                      }`}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${
                          event.status === 'firing' ? 'bg-red-400' : 'bg-green-400'
                        }`}
                      />
                      {event.status === 'firing' ? 'FIRING' : 'RESOLVED'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {relativeTime(event.fired_at)}
                    </span>
                  </div>

                  {/* Rule name */}
                  {event.rule_name && (
                    <h3 className="text-sm font-bold text-white leading-snug">{event.rule_name}</h3>
                  )}
                  {!event.rule_name && (
                    <p className="text-xs text-[var(--muted)] font-mono">
                      Rule: {event.alert_rule_id}
                    </p>
                  )}

                  {/* Anomaly link */}
                  {event.anomaly_id && (
                    <Link
                      href={`/anomalies/${event.anomaly_id}`}
                      className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                    >
                      <LinkIcon />
                      View linked anomaly
                    </Link>
                  )}

                  {/* Timestamps */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Fired: {formatTimestamp(event.fired_at)}</span>
                    {event.resolved_at && (
                      <span>Resolved: {formatTimestamp(event.resolved_at)}</span>
                    )}
                  </div>

                  {/* Notification results */}
                  {event.notification_results.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {event.notification_results.map((result, idx) => (
                        <span
                          key={idx}
                          title={result.error || undefined}
                          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ${
                            result.success
                              ? 'bg-green-500/10 text-green-400 border-green-500/30'
                              : 'bg-red-500/10 text-red-400 border-red-500/30'
                          }`}
                        >
                          {result.success ? (
                            <CheckIcon />
                          ) : (
                            <XIcon />
                          )}
                          {channelTypeLabel(result.channel_type)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && events.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            Showing {offset + 1}&ndash;{offset + events.length} of {total}
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

function CheckIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
      <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M6.5 9.5L9.5 6.5M7 11l-1.15 1.15a2.12 2.12 0 0 1-3-3L4 8M9 5l1.15-1.15a2.12 2.12 0 0 1 3 3L12 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
