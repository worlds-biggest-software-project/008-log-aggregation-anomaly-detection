'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Span {
  span_id: string;
  parent_span_id: string;
  service_name: string;
  operation_name: string;
  start_time: string;
  end_time: string;
  duration_ns: number;
  status_code: string;
  status_message: string;
  span_kind: string;
  span_attributes_string: Record<string, string>;
  span_attributes_number: Record<string, number>;
  span_attributes_bool: Record<string, boolean>;
  events_name: string[];
  events_timestamp: string[];
  events_attributes: Record<string, string>[];
  links_trace_id: string[];
  links_span_id: string[];
}

interface TraceDetail {
  trace_id: string;
  span_count: number;
  duration_ms: number;
  services: string[];
  spans: Span[];
}

interface CorrelatedLog {
  id: string;
  timestamp: string;
  severity_text: string;
  body: string;
  service_name: string;
  span_id: string;
}

interface SpanTreeNode {
  span: Span;
  children: SpanTreeNode[];
  depth: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const SERVICE_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-cyan-500',
  'bg-pink-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-lime-500',
];

const SERVICE_TEXT_COLORS = [
  'text-blue-400',
  'text-emerald-400',
  'text-amber-400',
  'text-purple-400',
  'text-cyan-400',
  'text-pink-400',
  'text-orange-400',
  'text-teal-400',
  'text-indigo-400',
  'text-lime-400',
];

function buildSpanTree(spans: Span[]): SpanTreeNode[] {
  const spanMap = new Map<string, SpanTreeNode>();
  const roots: SpanTreeNode[] = [];

  // Create nodes
  for (const span of spans) {
    spanMap.set(span.span_id, { span, children: [], depth: 0 });
  }

  // Build tree
  for (const span of spans) {
    const node = spanMap.get(span.span_id)!;
    if (span.parent_span_id && spanMap.has(span.parent_span_id)) {
      const parent = spanMap.get(span.parent_span_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set depths
  function setDepth(node: SpanTreeNode, depth: number) {
    node.depth = depth;
    // Sort children by start_time
    node.children.sort(
      (a, b) => new Date(a.span.start_time).getTime() - new Date(b.span.start_time).getTime(),
    );
    for (const child of node.children) {
      setDepth(child, depth + 1);
    }
  }

  roots.sort(
    (a, b) => new Date(a.span.start_time).getTime() - new Date(b.span.start_time).getTime(),
  );
  for (const root of roots) {
    setDepth(root, 0);
  }

  return roots;
}

function flattenTree(roots: SpanTreeNode[]): SpanTreeNode[] {
  const result: SpanTreeNode[] = [];
  function walk(node: SpanTreeNode) {
    result.push(node);
    for (const child of node.children) {
      walk(child);
    }
  }
  for (const root of roots) {
    walk(root);
  }
  return result;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  });
}

function severityColor(severity: string): string {
  switch (severity?.toUpperCase()) {
    case 'TRACE':
      return 'text-gray-400';
    case 'DEBUG':
      return 'text-blue-400';
    case 'INFO':
      return 'text-green-400';
    case 'WARN':
      return 'text-yellow-400';
    case 'ERROR':
      return 'text-red-400';
    case 'FATAL':
      return 'text-red-600';
    default:
      return 'text-gray-400';
  }
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function TraceDetailPage() {
  const params = useParams();
  const traceId = params.traceId as string;

  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [activeTab, setActiveTab] = useState<'detail' | 'logs'>('detail');
  const [logs, setLogs] = useState<CorrelatedLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  /* ---- fetch trace detail ---- */
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/v1/traces/${traceId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: TraceDetail = await res.json();
        setTrace(json);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load trace');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [traceId]);

  /* ---- fetch correlated logs ---- */
  const fetchLogs = useCallback(async () => {
    if (logsLoading) return;
    setLogsLoading(true);
    try {
      const res = await fetch(`/api/v1/traces/${traceId}/logs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setLogs(json.data ?? json);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, [traceId, logsLoading]);

  /* ---- load logs when switching to logs tab ---- */
  useEffect(() => {
    if (activeTab === 'logs' && logs.length === 0 && !logsLoading) {
      fetchLogs();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- build service color map ---- */
  const serviceColorMap = useMemo(() => {
    if (!trace) return new Map<string, number>();
    const map = new Map<string, number>();
    trace.services.forEach((s, i) => map.set(s, i % SERVICE_COLORS.length));
    return map;
  }, [trace]);

  /* ---- build span tree + flat list ---- */
  const flatSpans = useMemo(() => {
    if (!trace) return [];
    const roots = buildSpanTree(trace.spans);
    return flattenTree(roots);
  }, [trace]);

  /* ---- timeline calculations ---- */
  const { traceStart, traceTotal } = useMemo(() => {
    if (!trace || trace.spans.length === 0) return { traceStart: 0, traceTotal: 1 };
    const starts = trace.spans.map((s) => new Date(s.start_time).getTime());
    const ends = trace.spans.map((s) => new Date(s.end_time).getTime());
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    return { traceStart: start, traceTotal: Math.max(end - start, 1) };
  }, [trace]);

  /* ---- render ---- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="flex items-center gap-3 text-[var(--muted)]">
          <LoadingSpinner />
          <span className="text-sm">Loading trace...</span>
        </div>
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="space-y-4">
        <Link
          href="/traces"
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          &larr; Back to traces
        </Link>
        <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Failed to load trace</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/traces"
        className="inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        &larr; Back to traces
      </Link>

      {/* Header */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-white">Trace Detail</h1>
            <p className="mt-1 font-mono text-sm text-blue-400">{trace.trace_id}</p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-[var(--muted)]">Duration</span>
              <p className="font-mono text-white">{trace.duration_ms.toLocaleString()} ms</p>
            </div>
            <div>
              <span className="text-[var(--muted)]">Spans</span>
              <p className="font-mono text-white">{trace.span_count}</p>
            </div>
            <div>
              <span className="text-[var(--muted)]">Services</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {trace.services.map((svc) => {
                  const idx = serviceColorMap.get(svc) ?? 0;
                  return (
                    <span
                      key={svc}
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${SERVICE_TEXT_COLORS[idx]} bg-white/5`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${SERVICE_COLORS[idx]}`} />
                      {svc}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Waterfall timeline */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
        {/* Timeline header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--card-border)]">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
            Waterfall Timeline
          </span>
          <span className="text-xs text-[var(--muted)] font-mono">
            {trace.duration_ms.toLocaleString()} ms total
          </span>
        </div>

        {/* Span rows */}
        <div className="divide-y divide-[var(--card-border)]">
          {flatSpans.map(({ span, depth }) => {
            const spanStart = new Date(span.start_time).getTime();
            const spanDurationMs = span.duration_ns / 1_000_000;
            const leftPct = ((spanStart - traceStart) / traceTotal) * 100;
            const widthPct = Math.max(
              (spanDurationMs / (traceTotal)) * 100,
              0.3,
            );
            const colorIdx = serviceColorMap.get(span.service_name) ?? 0;
            const isSelected = selectedSpan?.span_id === span.span_id;
            const isError = span.status_code?.toUpperCase() === 'ERROR';

            return (
              <button
                key={span.span_id}
                type="button"
                onClick={() => {
                  setSelectedSpan(isSelected ? null : span);
                  setActiveTab('detail');
                }}
                className={`flex items-center w-full text-left px-4 py-2 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  isSelected ? 'bg-white/5' : ''
                }`}
              >
                {/* Label section */}
                <div
                  className="shrink-0 min-w-0 w-56"
                  style={{ paddingLeft: `${depth * 16}px` }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${SERVICE_COLORS[colorIdx]}`}
                    />
                    <span
                      className={`text-xs truncate ${SERVICE_TEXT_COLORS[colorIdx]}`}
                    >
                      {span.service_name}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5 pl-3">
                    {span.operation_name}
                  </p>
                </div>

                {/* Bar section */}
                <div className="flex-1 relative h-6 ml-3">
                  <div
                    className={`absolute top-1 h-4 rounded-sm ${SERVICE_COLORS[colorIdx]} ${
                      isError ? 'ring-1 ring-red-500' : ''
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: '2px',
                    }}
                  />
                </div>

                {/* Duration */}
                <div className="shrink-0 w-20 text-right">
                  <span className="text-xs font-mono text-gray-400">
                    {Math.round(span.duration_ns / 1_000_000).toLocaleString()} ms
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Span detail / logs tabs */}
      {selectedSpan && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--card-border)]">
            <button
              type="button"
              onClick={() => setActiveTab('detail')}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                activeTab === 'detail'
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--muted)] hover:text-white'
              }`}
            >
              Span Detail
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                activeTab === 'logs'
                  ? 'bg-white/10 text-white'
                  : 'text-[var(--muted)] hover:text-white'
              }`}
            >
              Logs
            </button>
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => setSelectedSpan(null)}
                className="text-[var(--muted)] hover:text-white text-sm transition-colors"
                aria-label="Close detail panel"
              >
                Close
              </button>
            </div>
          </div>

          {/* Span detail tab */}
          {activeTab === 'detail' && (
            <div className="p-4 space-y-4">
              {/* Core info */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <InfoField label="Span ID" value={selectedSpan.span_id} mono />
                <InfoField
                  label="Parent Span ID"
                  value={selectedSpan.parent_span_id || '(root)'}
                  mono
                />
                <InfoField label="Service" value={selectedSpan.service_name} />
                <InfoField label="Operation" value={selectedSpan.operation_name} />
                <InfoField label="Kind" value={selectedSpan.span_kind || '--'} />
                <InfoField
                  label="Status"
                  value={selectedSpan.status_code || 'UNSET'}
                  statusColor={
                    selectedSpan.status_code?.toUpperCase() === 'ERROR'
                      ? 'text-red-400'
                      : selectedSpan.status_code?.toUpperCase() === 'OK'
                        ? 'text-green-400'
                        : 'text-gray-400'
                  }
                />
                <InfoField
                  label="Start Time"
                  value={formatTimestamp(selectedSpan.start_time)}
                />
                <InfoField
                  label="End Time"
                  value={formatTimestamp(selectedSpan.end_time)}
                />
                <InfoField
                  label="Duration"
                  value={`${Math.round(selectedSpan.duration_ns / 1_000_000).toLocaleString()} ms`}
                  mono
                />
              </div>

              {/* Status message */}
              {selectedSpan.status_message && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-1">
                    Status Message
                  </h4>
                  <p className="font-mono text-sm text-red-400 bg-gray-950 rounded p-2">
                    {selectedSpan.status_message}
                  </p>
                </div>
              )}

              {/* Attributes */}
              {(Object.keys(selectedSpan.span_attributes_string ?? {}).length > 0 ||
                Object.keys(selectedSpan.span_attributes_number ?? {}).length > 0 ||
                Object.keys(selectedSpan.span_attributes_bool ?? {}).length > 0) && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
                    Attributes
                  </h4>
                  <div className="bg-gray-950 rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800">
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
                            Key
                          </th>
                          <th className="text-left px-3 py-1.5 text-xs font-medium text-[var(--muted)]">
                            Value
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-mono text-xs">
                        {Object.entries(selectedSpan.span_attributes_string ?? {}).map(
                          ([k, v]) => (
                            <tr key={`s-${k}`} className="border-b border-gray-900">
                              <td className="px-3 py-1.5 text-cyan-400">{k}</td>
                              <td className="px-3 py-1.5 text-gray-300">{v}</td>
                            </tr>
                          ),
                        )}
                        {Object.entries(selectedSpan.span_attributes_number ?? {}).map(
                          ([k, v]) => (
                            <tr key={`n-${k}`} className="border-b border-gray-900">
                              <td className="px-3 py-1.5 text-cyan-400">{k}</td>
                              <td className="px-3 py-1.5 text-amber-400">{String(v)}</td>
                            </tr>
                          ),
                        )}
                        {Object.entries(selectedSpan.span_attributes_bool ?? {}).map(
                          ([k, v]) => (
                            <tr key={`b-${k}`} className="border-b border-gray-900">
                              <td className="px-3 py-1.5 text-cyan-400">{k}</td>
                              <td className="px-3 py-1.5 text-purple-400">
                                {String(v)}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Events */}
              {selectedSpan.events_name && selectedSpan.events_name.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
                    Events ({selectedSpan.events_name.length})
                  </h4>
                  <div className="space-y-2">
                    {selectedSpan.events_name.map((name, i) => (
                      <div
                        key={i}
                        className="bg-gray-950 rounded p-3 text-sm"
                      >
                        <div className="flex items-center gap-3 mb-1">
                          <span className="font-medium text-white">
                            {name}
                          </span>
                          <span className="text-xs text-gray-500 font-mono">
                            {formatTimestamp(selectedSpan.events_timestamp[i] ?? '')}
                          </span>
                        </div>
                        {selectedSpan.events_attributes[i] && Object.keys(selectedSpan.events_attributes[i]).length > 0 && (
                          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap mt-1">
                            {JSON.stringify(selectedSpan.events_attributes[i], null, 2)}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Links */}
              {selectedSpan.links_trace_id && selectedSpan.links_trace_id.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-2">
                    Links
                  </h4>
                  <div className="space-y-1">
                    {selectedSpan.links_trace_id.map((linkTraceId, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Link
                          href={`/traces/${linkTraceId}`}
                          className="font-mono text-blue-400 hover:text-blue-300"
                        >
                          {linkTraceId.slice(0, 8)}...
                        </Link>
                        <span className="text-gray-500 font-mono text-xs">
                          span: {(selectedSpan.links_span_id[i] ?? '').slice(0, 8)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Logs tab */}
          {activeTab === 'logs' && (
            <div className="p-4">
              {logsLoading && (
                <div className="flex items-center gap-2 py-8 justify-center text-[var(--muted)]">
                  <LoadingSpinner />
                  <span className="text-sm">Loading correlated logs...</span>
                </div>
              )}

              {!logsLoading && logs.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm text-[var(--muted)]">
                    No logs found for this trace.
                  </p>
                </div>
              )}

              {!logsLoading && logs.length > 0 && (
                <div className="space-y-0 bg-gray-950 rounded overflow-hidden font-mono text-xs">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex gap-3 px-3 py-1.5 hover:bg-gray-900 border-b border-gray-900"
                    >
                      <span className="text-gray-600 shrink-0">
                        {new Date(log.timestamp).toISOString().slice(11, 23)}
                      </span>
                      <span
                        className={`shrink-0 w-12 ${severityColor(log.severity_text)}`}
                      >
                        {log.severity_text}
                      </span>
                      <span className="text-cyan-400 shrink-0 w-28 truncate">
                        {log.service_name}
                      </span>
                      <span className="text-gray-300 break-all">{log.body}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function InfoField({
  label,
  value,
  mono,
  statusColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  statusColor?: string;
}) {
  return (
    <div>
      <span className="text-xs text-[var(--muted)]">{label}</span>
      <p
        className={`text-sm mt-0.5 ${statusColor ?? 'text-white'} ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </p>
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
