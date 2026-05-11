'use client';

import { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Recommendation {
  id: string;
  service_id: string;
  service_name: string;
  pattern: string;
  current_volume_daily: number;
  recommended_sample_rate: number;
  estimated_savings_pct: number;
  reasoning: string;
  status: string;
  applied_at: string | null;
  created_at: string;
}

interface RecommendationsResponse {
  data: Recommendation[];
}

interface GenerateResponse {
  data: Recommendation[];
  count: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatVolume(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ------------------------------------------------------------------ */
/*  Status filter tabs                                                */
/* ------------------------------------------------------------------ */

type StatusFilter = 'pending' | 'applied' | 'dismissed' | 'all';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function SamplingRecommendations() {
  /* ---- state ---- */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  /* ---- fetch recommendations ---- */
  const fetchRecommendations = useCallback(async (status: StatusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);

      const res = await fetch(`/api/v1/cost/recommendations?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RecommendationsResponse = await res.json();
      setRecommendations(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recommendations');
      setRecommendations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecommendations(statusFilter);
  }, [fetchRecommendations, statusFilter]);

  /* ---- generate new recommendations ---- */
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/cost/recommendations/generate', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: GenerateResponse = await res.json();
      // Refresh the list after generating — switch to pending to see results
      setStatusFilter('pending');
      setRecommendations(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate recommendations');
    } finally {
      setGenerating(false);
    }
  };

  /* ---- apply a recommendation ---- */
  const handleApply = async (id: string) => {
    setActionInProgress(id);
    try {
      const res = await fetch(`/api/v1/cost/recommendations/${id}/apply`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Recommendation = await res.json();
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? updated : r)),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to apply recommendation');
    } finally {
      setActionInProgress(null);
    }
  };

  /* ---- dismiss a recommendation ---- */
  const handleDismiss = async (id: string) => {
    setActionInProgress(id);
    try {
      const res = await fetch(`/api/v1/cost/recommendations/${id}/dismiss`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Recommendation = await res.json();
      setRecommendations((prev) =>
        prev.map((r) => (r.id === id ? updated : r)),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss recommendation');
    } finally {
      setActionInProgress(null);
    }
  };

  /* ---- render ---- */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-white">Sampling Recommendations</h2>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {generating ? 'Generating...' : 'Generate New'}
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-800/50 p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusFilter(tab.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              statusFilter === tab.key
                ? 'bg-gray-700 text-white'
                : 'text-[var(--muted)] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Generating state */}
      {generating && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Analyzing log patterns...</span>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && !generating && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading recommendations...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !generating && !error && recommendations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">
            &#128161;
          </span>
          <p className="text-sm font-medium text-white">No recommendations available</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Click &ldquo;Generate New&rdquo; to analyze your log patterns.
          </p>
        </div>
      )}

      {/* Recommendation cards */}
      {!loading && !generating && recommendations.length > 0 && (
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <RecommendationCard
              key={rec.id}
              rec={rec}
              actionInProgress={actionInProgress === rec.id}
              onApply={() => handleApply(rec.id)}
              onDismiss={() => handleDismiss(rec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function RecommendationCard({
  rec,
  actionInProgress,
  onApply,
  onDismiss,
}: {
  rec: Recommendation;
  actionInProgress: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const isApplied = rec.status === 'applied';
  const isDismissed = rec.status === 'dismissed';
  const keepPct = Math.round(rec.recommended_sample_rate * 100);

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3">
      {/* Top row: service badge + status */}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full bg-cyan-500/20 border border-cyan-500/30 px-2.5 py-0.5 text-xs font-medium text-cyan-400">
          {rec.service_name}
        </span>

        {isApplied && rec.applied_at && (
          <span className="inline-flex items-center rounded-full bg-green-500/20 border border-green-500/30 px-2.5 py-0.5 text-xs font-medium text-green-400">
            Applied on {formatDate(rec.applied_at)}
          </span>
        )}
        {isDismissed && (
          <span className="inline-flex items-center rounded-full bg-gray-500/20 border border-gray-500/30 px-2.5 py-0.5 text-xs font-medium text-gray-400">
            Dismissed
          </span>
        )}
      </div>

      {/* Pattern */}
      <p className="text-sm font-mono text-white truncate" title={rec.pattern}>
        {rec.pattern}
      </p>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-4 text-xs">
        {/* Volume */}
        <div>
          <span className="text-[var(--muted)]">Volume: </span>
          <span className="text-white font-mono">{formatVolume(rec.current_volume_daily)} logs/day</span>
        </div>

        {/* Sample rate with visual bar */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--muted)]">Keep: </span>
          <span className="text-white font-mono">{keepPct}%</span>
          <div className="w-16 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: `${keepPct}%` }}
            />
          </div>
        </div>

        {/* Estimated savings */}
        <div>
          <span className="text-[var(--muted)]">Savings: </span>
          <span className="text-green-400 font-mono">~{Math.round(rec.estimated_savings_pct)}% reduction</span>
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-xs text-[var(--muted)] leading-relaxed">{rec.reasoning}</p>

      {/* Action buttons (only for pending) */}
      {!isApplied && !isDismissed && (
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onApply}
            disabled={actionInProgress}
            className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {actionInProgress ? 'Applying...' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={actionInProgress}
            className="rounded-lg bg-gray-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Dismiss
          </button>
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
