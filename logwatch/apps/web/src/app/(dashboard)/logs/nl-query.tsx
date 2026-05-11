'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface QueryResult {
  id: string;
  question: string;
  translated_query: string;
  explanation: string;
  results: Record<string, unknown>[];
  result_count: number;
  result_summary: string;
  execution_time_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}

interface HistoryEntry {
  id: string;
  question: string;
  translated_query: string;
  status: string;
  result_count: number;
  result_summary: string;
  execution_time_ms: number;
  created_at: string;
  completed_at: string;
}

interface HistoryResponse {
  data: HistoryEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

type LoadingStep = 'translating' | 'executing' | 'summarizing';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const EXAMPLE_QUESTIONS = [
  'Show error logs from the last hour',
  'Which services have the most fatal errors today?',
  "Find logs containing 'timeout' from the payment service",
  'Show me a breakdown of log volume by service',
];

const MAX_DISPLAY_ROWS = 100;
const TRUNCATE_LENGTH = 80;

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

function statusBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case 'completed':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'failed':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
    case 'pending':
    case 'processing':
      return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    default:
      return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + '...' : value;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function NLQueryPanel() {
  /* ---- state ---- */
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('translating');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [showExplanation, setShowExplanation] = useState(false);
  const [showSQL, setShowSQL] = useState(false);
  const [copied, setCopied] = useState(false);

  /* ---- fetch history ---- */
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch('/api/v1/ai/query/history?limit=20&offset=0');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: HistoryResponse = await res.json();
      setHistory(json.data);
    } catch {
      // silently fail — history is supplementary
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  /* ---- submit query ---- */
  const submitQuery = useCallback(
    async (question: string) => {
      if (!question.trim()) return;

      setLoading(true);
      setError(null);
      setResult(null);
      setShowExplanation(false);
      setShowSQL(false);
      setLoadingStep('translating');

      // Simulate step progression for UX feedback
      const stepTimer1 = setTimeout(() => setLoadingStep('executing'), 1500);
      const stepTimer2 = setTimeout(() => setLoadingStep('summarizing'), 3500);

      try {
        const res = await fetch('/api/v1/ai/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: question.trim() }),
        });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `HTTP ${res.status}`);
        }

        const json: QueryResult = await res.json();
        setResult(json);
        // Refresh history after successful query
        fetchHistory();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to execute query');
      } finally {
        clearTimeout(stepTimer1);
        clearTimeout(stepTimer2);
        setLoading(false);
      }
    },
    [fetchHistory],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitQuery(query);
  };

  const handleExampleClick = (question: string) => {
    setQuery(question);
    submitQuery(question);
  };

  const handleHistoryClick = (entry: HistoryEntry) => {
    setQuery(entry.question);
    setShowHistory(false);
    submitQuery(entry.question);
  };

  const handleCopySQL = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.translated_query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API not available
    }
  };

  const handleRetry = () => {
    submitQuery(query);
  };

  /* ---- derived data ---- */
  const resultColumns =
    result && result.results.length > 0
      ? Object.keys(result.results[0])
      : [];
  const displayRows = result
    ? result.results.slice(0, MAX_DISPLAY_ROWS)
    : [];
  const hasResults = result !== null;
  const showExamples = !hasResults && !loading && !error;

  const loadingStepText: Record<LoadingStep, string> = {
    translating: 'Translating question...',
    executing: 'Executing query...',
    summarizing: 'Summarizing results...',
  };

  /* ---- render ---- */
  return (
    <div className="space-y-4">
      {/* Header row with history toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Natural Language Query</h2>
          <p className="text-sm text-[var(--muted)]">
            Ask questions about your logs in plain English.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <HistoryIcon />
          History
        </button>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3">
          <h3 className="text-sm font-medium text-white">Recent Queries</h3>
          {historyLoading && (
            <div className="flex items-center gap-2 py-4 justify-center text-[var(--muted)]">
              <LoadingSpinner />
              <span className="text-sm">Loading history...</span>
            </div>
          )}
          {!historyLoading && history.length === 0 && (
            <p className="text-sm text-[var(--muted)] py-4 text-center">
              No query history yet.
            </p>
          )}
          {!historyLoading && history.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleHistoryClick(entry)}
                  className="w-full text-left rounded-lg px-3 py-2 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-white truncate max-w-[60%] group-hover:text-[var(--accent)]">
                      {truncate(entry.question, 60)}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(entry.status)}`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                    <span>{entry.result_count} results</span>
                    <span>{entry.execution_time_ms}ms</span>
                    <span>{relativeTime(entry.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Query input form */}
      <form onSubmit={handleSubmit}>
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 space-y-3">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question about your logs... e.g., 'Show me error logs from the auth service in the last hour'"
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitQuery(query);
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Press Ctrl+Enter to submit
            </span>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {loading ? 'Processing...' : 'Ask'}
            </button>
          </div>
        </div>
      </form>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">{loadingStepText[loadingStep]}</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ErrorIcon />
            <span className="text-sm font-medium text-red-400">Query failed</span>
          </div>
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* Example questions */}
      {showExamples && (
        <div className="space-y-3">
          <p className="text-sm text-[var(--muted)]">Try one of these questions:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => handleExampleClick(question)}
                className="rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1.5 text-sm text-[var(--muted)] hover:text-white hover:border-[var(--accent)]/50 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <SparklesIcon />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-blue-200 leading-relaxed">
                  {result.result_summary}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-blue-300/70">
              <span>
                {result.result_count} result{result.result_count !== 1 ? 's' : ''}
              </span>
              <span>{result.execution_time_ms}ms</span>
              <span>
                {result.prompt_tokens + result.completion_tokens} tokens
                ({result.prompt_tokens} prompt + {result.completion_tokens} completion)
              </span>
            </div>
          </div>

          {/* Explanation collapsible */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowExplanation(!showExplanation)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="text-sm font-medium text-white">
                How this was translated
              </span>
              <ChevronIcon open={showExplanation} />
            </button>
            {showExplanation && (
              <div className="px-4 pb-4 border-t border-[var(--card-border)]">
                <p className="text-sm text-[var(--muted)] leading-relaxed pt-3">
                  {result.explanation}
                </p>
              </div>
            )}
          </div>

          {/* Generated SQL collapsible */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSQL(!showSQL)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="text-sm font-medium text-white">
                Generated ClickHouse Query
              </span>
              <ChevronIcon open={showSQL} />
            </button>
            {showSQL && (
              <div className="px-4 pb-4 border-t border-[var(--card-border)]">
                <div className="relative mt-3">
                  <pre className="rounded-lg bg-gray-800 p-3 font-mono text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
                    {result.translated_query}
                  </pre>
                  <button
                    type="button"
                    onClick={handleCopySQL}
                    className="absolute top-2 right-2 rounded-md border border-gray-600 bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:text-white hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Results table */}
          {result.results.length === 0 ? (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
              <p className="text-sm font-medium text-white">No results found</p>
              <p className="text-sm text-[var(--muted)] mt-1">
                The query executed successfully but returned no matching rows.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--card-border)]">
                <span className="text-sm font-medium text-white">Results</span>
                <span className="text-xs text-gray-500">
                  Showing {displayRows.length} of {result.result_count} row{result.result_count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--card-border)]">
                      {resultColumns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left font-medium uppercase tracking-wider text-[var(--muted)] whitespace-nowrap"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, idx) => (
                      <tr
                        key={idx}
                        className={`border-b border-[var(--card-border)] last:border-b-0 ${
                          idx % 2 === 1 ? 'bg-gray-800/50' : ''
                        }`}
                      >
                        {resultColumns.map((col) => {
                          const cellValue = formatCellValue(row[col]);
                          const isTruncated = cellValue.length > TRUNCATE_LENGTH;
                          return (
                            <td
                              key={col}
                              className="px-3 py-1.5 text-gray-300 whitespace-nowrap"
                              title={isTruncated ? cellValue : undefined}
                            >
                              {isTruncated
                                ? truncate(cellValue, TRUNCATE_LENGTH)
                                : cellValue}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Icons                                                      */
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

function HistoryIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className="text-red-400"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 5v3.5M8 10.5v.5" strokeLinecap="round" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className="text-blue-400 shrink-0 mt-0.5"
    >
      <path
        d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
