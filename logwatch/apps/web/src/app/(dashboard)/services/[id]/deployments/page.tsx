'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Deployment {
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

interface DeploymentsResponse {
  data: Deployment[];
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

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function DeploymentsPage() {
  const params = useParams();
  const serviceId = params.id as string;

  /* ---- data state ---- */
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(50);

  /* ---- changelog collapse state ---- */
  const [expandedChangelogs, setExpandedChangelogs] = useState<Set<string>>(new Set());

  /* ---- fetch deployments ---- */
  const fetchDeployments = useCallback(
    async (newOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('service_id', serviceId);
        params.set('limit', String(limit));
        params.set('offset', String(newOffset));

        const res = await fetch(`/api/v1/deployments?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: DeploymentsResponse = await res.json();

        setDeployments(json.data);
        setTotal(json.pagination.total);
        setHasMore(json.pagination.has_more);
        setOffset(newOffset);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch deployments');
        setDeployments([]);
      } finally {
        setLoading(false);
      }
    },
    [serviceId, limit],
  );

  useEffect(() => {
    fetchDeployments(0);
  }, [fetchDeployments]);

  /* ---- handlers ---- */
  const handlePrev = () => {
    if (offset >= limit) fetchDeployments(offset - limit);
  };

  const handleNext = () => {
    if (hasMore) fetchDeployments(offset + limit);
  };

  const toggleChangelog = (id: string) => {
    setExpandedChangelogs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/services"
          className="inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors mb-3"
        >
          &larr; Back to services
        </Link>
        <h1 className="text-xl font-semibold text-white">Deployments</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Deployment history for service <span className="font-mono text-gray-300">{serviceId}</span>.
        </p>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading deployments...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading deployments</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && deployments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">&#9881;</span>
          <p className="text-sm font-medium text-white">No deployments recorded for this service.</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Deployments will appear here once they are recorded via the API.
          </p>
        </div>
      )}

      {/* Deployment timeline */}
      {!loading && !error && deployments.length > 0 && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-700" />

          <div className="space-y-4">
            {deployments.map((deployment) => (
              <div key={deployment.id} className="relative pl-10">
                {/* Timeline dot */}
                <div className="absolute left-2.5 top-4 h-3 w-3 rounded-full border-2 border-gray-900 bg-blue-500" />

                {/* Deployment card */}
                <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3">
                  {/* Top row: version badge + timestamp */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/20 px-3 py-1 text-sm font-bold text-blue-400">
                      {deployment.version}
                    </span>
                    <span className="text-xs text-gray-500">
                      {relativeTime(deployment.deployed_at)}
                    </span>
                  </div>

                  {/* Deployed at */}
                  <p className="text-xs text-gray-400">
                    Deployed: {formatTimestamp(deployment.deployed_at)}
                  </p>

                  {/* Deployer + commit */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {deployment.deployer && (
                      <span className="text-gray-400">
                        <span className="text-gray-500">Deployer:</span>{' '}
                        <span className="text-gray-300">{deployment.deployer}</span>
                      </span>
                    )}
                    {deployment.commit_sha && (
                      <span className="text-gray-400">
                        <span className="text-gray-500">Commit:</span>{' '}
                        <span className="font-mono text-gray-300">
                          {deployment.commit_sha.slice(0, 7)}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Changelog (collapsible) */}
                  {deployment.changelog && (
                    <div>
                      <button
                        type="button"
                        onClick={() => toggleChangelog(deployment.id)}
                        className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
                      >
                        <ChevronIcon open={expandedChangelogs.has(deployment.id)} />
                        Changelog
                      </button>
                      {expandedChangelogs.has(deployment.id) && (
                        <div className="mt-2 rounded-lg bg-gray-950 border border-gray-800 p-3">
                          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                            {deployment.changelog}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && deployments.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            Showing {offset + 1}&ndash;{offset + deployments.length} of {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={handlePrev}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              Previous
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
/*  Sub-components                                                    */
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06z" />
    </svg>
  );
}
