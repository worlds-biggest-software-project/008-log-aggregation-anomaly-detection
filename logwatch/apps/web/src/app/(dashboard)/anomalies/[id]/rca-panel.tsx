'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface EvidenceItem {
  type: string;
  source: string;
  description: string;
  timestamp: string | null;
  relevance: number | null;
}

interface RCAReport {
  id: string;
  anomaly_id: string;
  status: 'generating' | 'completed' | 'failed';
  narrative: string | null;
  probable_cause: string | null;
  confidence: number | null;
  evidence_summary: EvidenceItem[];
  user_feedback: string | null;
  feedback_comment: string | null;
  generated_at: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

type FeedbackValue = 'helpful' | 'not_helpful' | 'inaccurate';

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

function confidenceColor(confidence: number): string {
  if (confidence >= 80) return 'bg-green-500';
  if (confidence >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function feedbackLabel(fb: FeedbackValue): string {
  switch (fb) {
    case 'helpful':
      return 'Helpful';
    case 'not_helpful':
      return 'Not Helpful';
    case 'inaccurate':
      return 'Inaccurate';
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function RCAPanel({ anomalyId }: { anomalyId: string }) {
  const [report, setReport] = useState<RCAReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  /* ---- feedback state ---- */
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackValue | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  /* ---- evidence collapse ---- */
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  /* ---- fetch RCA report ---- */
  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/v1/anomalies/${anomalyId}/rca`);
      if (res.status === 404) {
        setNotFound(true);
        setReport(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RCAReport = await res.json();
      setReport(json);

      // Pre-fill feedback state if already submitted
      if (json.user_feedback) {
        setSelectedFeedback(json.user_feedback as FeedbackValue);
        setFeedbackComment(json.feedback_comment ?? '');
        setFeedbackSubmitted(true);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load RCA report');
    } finally {
      setLoading(false);
    }
  }, [anomalyId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  /* ---- poll while generating ---- */
  useEffect(() => {
    if (!report || report.status !== 'generating') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/anomalies/${anomalyId}/rca`);
        if (!res.ok) return;
        const json: RCAReport = await res.json();
        setReport(json);
        if (json.status !== 'generating') {
          setGenerating(false);
          if (json.user_feedback) {
            setSelectedFeedback(json.user_feedback as FeedbackValue);
            setFeedbackComment(json.feedback_comment ?? '');
            setFeedbackSubmitted(true);
          }
        }
      } catch {
        // silently retry on next interval
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [report, anomalyId]);

  /* ---- generate RCA ---- */
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setNotFound(false);
    try {
      const res = await fetch(`/api/v1/anomalies/${anomalyId}/rca`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: RCAReport = await res.json();
      setReport(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate RCA report');
      setGenerating(false);
    }
  };

  /* ---- submit feedback ---- */
  const handleSubmitFeedback = async () => {
    if (!selectedFeedback) return;
    setSubmittingFeedback(true);
    try {
      const body: { feedback: FeedbackValue; comment?: string } = {
        feedback: selectedFeedback,
      };
      if (feedbackComment.trim()) {
        body.comment = feedbackComment.trim();
      }
      const res = await fetch(`/api/v1/anomalies/${anomalyId}/rca/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFeedbackSubmitted(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  /* ---- render: loading ---- */
  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Root-Cause Analysis
        </h2>
        <div className="flex items-center gap-3 py-8 justify-center text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading RCA report...</span>
        </div>
      </div>
    );
  }

  /* ---- render: generate button (no report exists) ---- */
  if (notFound && !generating) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Root-Cause Analysis
        </h2>
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-sm text-gray-400">
            No root-cause analysis has been generated for this anomaly yet.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Generate Root-Cause Analysis
          </button>
        </div>
      </div>
    );
  }

  /* ---- render: generating / polling ---- */
  if (generating || (report && report.status === 'generating')) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Root-Cause Analysis
        </h2>
        <div className="flex items-center gap-3 py-12 justify-center text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Analyzing evidence and generating report...</span>
        </div>
      </div>
    );
  }

  /* ---- render: failed ---- */
  if (report && report.status === 'failed') {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Root-Cause Analysis
        </h2>
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-sm font-medium text-red-400">
            Root-cause analysis generation failed.
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Retry Generation
          </button>
        </div>
      </div>
    );
  }

  /* ---- render: error (no report) ---- */
  if (error && !report) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Root-Cause Analysis
        </h2>
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <p className="text-sm font-medium text-red-400">Failed to load RCA report</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  /* ---- render: completed report ---- */
  if (!report) return null;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-5">
      <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        Root-Cause Analysis
      </h2>

      {/* Probable Cause card */}
      {report.probable_cause && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-medium uppercase tracking-wider text-amber-400 mb-2">
                Probable Cause
              </h3>
              <p className="text-sm text-white leading-relaxed">
                {report.probable_cause}
              </p>
            </div>

            {/* Confidence bar */}
            {report.confidence !== null && (
              <div className="shrink-0 text-right">
                <span className="text-xs text-[var(--muted)]">Confidence</span>
                <div className="flex items-center gap-2 mt-1">
                  <div className="w-20 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${confidenceColor(report.confidence)}`}
                      style={{ width: `${Math.min(report.confidence, 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm text-white font-semibold">
                    {report.confidence}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Narrative */}
      {report.narrative && (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
            Analysis
          </h3>
          <div className="space-y-2">
            {report.narrative.split('\n').filter(Boolean).map((paragraph, idx) => (
              <p key={idx} className="text-sm text-gray-300 leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Evidence chain (collapsible) */}
      {report.evidence_summary.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setEvidenceOpen(!evidenceOpen)}
            className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--muted)] hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
          >
            <ChevronIcon open={evidenceOpen} />
            Evidence Chain ({report.evidence_summary.length} items)
          </button>

          {evidenceOpen && (
            <div className="relative mt-3 ml-2">
              {/* Timeline line */}
              <div className="absolute left-1.5 top-0 bottom-0 w-px bg-gray-700" />

              <div className="space-y-3">
                {report.evidence_summary.map((item, idx) => (
                  <div key={idx} className="relative pl-7">
                    {/* Timeline dot */}
                    <div className="absolute left-0 top-2 h-3 w-3 rounded-full border-2 border-gray-900 bg-blue-500" />

                    <div className="rounded-lg bg-gray-950 border border-gray-800 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-blue-400 uppercase">
                          {item.type}
                        </span>
                        {item.relevance !== null && (
                          <span className="text-xs text-gray-500">
                            relevance: {(item.relevance * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300">{item.description}</p>
                      <div className="flex flex-wrap gap-x-4 mt-1.5 text-xs text-gray-500">
                        <span>Source: {item.source}</span>
                        {item.timestamp && (
                          <span>{formatTimestamp(item.timestamp)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 pt-2 border-t border-[var(--card-border)]">
        {report.generated_at && (
          <span>Generated: {formatTimestamp(report.generated_at)}</span>
        )}
        {report.prompt_tokens !== null && report.completion_tokens !== null && (
          <span>
            Tokens: {report.prompt_tokens.toLocaleString()} prompt / {report.completion_tokens.toLocaleString()} completion
          </span>
        )}
      </div>

      {/* Feedback section */}
      <div className="pt-3 border-t border-[var(--card-border)]">
        <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
          Was this analysis helpful?
        </h3>

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Feedback submitted confirmation */}
        {feedbackSubmitted && selectedFeedback && (
          <p className="text-xs text-[var(--muted)] mb-3">
            Feedback recorded: <span className="text-white">{feedbackLabel(selectedFeedback)}</span>
            {feedbackComment && (
              <span className="text-gray-500"> &mdash; &ldquo;{feedbackComment}&rdquo;</span>
            )}
          </p>
        )}

        {!feedbackSubmitted && (
          <div className="space-y-3">
            {/* Feedback buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedFeedback('helpful')}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  selectedFeedback === 'helpful'
                    ? 'border-green-500/50 bg-green-500/20 text-green-400'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--muted)] hover:text-white hover:bg-white/5'
                }`}
              >
                Helpful
              </button>
              <button
                type="button"
                onClick={() => setSelectedFeedback('not_helpful')}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  selectedFeedback === 'not_helpful'
                    ? 'border-gray-500/50 bg-gray-500/20 text-gray-300'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--muted)] hover:text-white hover:bg-white/5'
                }`}
              >
                Not Helpful
              </button>
              <button
                type="button"
                onClick={() => setSelectedFeedback('inaccurate')}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  selectedFeedback === 'inaccurate'
                    ? 'border-red-500/50 bg-red-500/20 text-red-400'
                    : 'border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--muted)] hover:text-white hover:bg-white/5'
                }`}
              >
                Inaccurate
              </button>
            </div>

            {/* Comment textarea (shown after selecting feedback) */}
            {selectedFeedback && (
              <>
                <textarea
                  placeholder="Optional: Add a comment about this analysis..."
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[var(--card-border)] bg-gray-950 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                />
                <button
                  type="button"
                  disabled={submittingFeedback}
                  onClick={handleSubmitFeedback}
                  className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  {submittingFeedback ? 'Submitting...' : 'Submit Feedback'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
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
