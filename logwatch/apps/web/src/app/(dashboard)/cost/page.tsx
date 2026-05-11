'use client';

import { useState, useCallback, useEffect } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface UsageRow {
  id: string;
  tenant_id: string;
  service_id: string;
  service_name: string;
  date: string;
  log_count: number;
  log_bytes: number;
  trace_count: number;
  trace_bytes: number;
  estimated_cost_usd: number;
}

interface UsageResponse {
  data: UsageRow[];
}

interface ServiceAggregate {
  service_name: string;
  log_count: number;
  trace_count: number;
  total_bytes: number;
  cost: number;
}

interface DailyAggregate {
  date: string;
  total_bytes: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(2)} TB`;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(2)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function aggregateByService(rows: UsageRow[]): ServiceAggregate[] {
  const map = new Map<string, ServiceAggregate>();
  for (const row of rows) {
    const existing = map.get(row.service_name);
    if (existing) {
      existing.log_count += row.log_count;
      existing.trace_count += row.trace_count;
      existing.total_bytes += row.log_bytes + row.trace_bytes;
      existing.cost += row.estimated_cost_usd;
    } else {
      map.set(row.service_name, {
        service_name: row.service_name,
        log_count: row.log_count,
        trace_count: row.trace_count,
        total_bytes: row.log_bytes + row.trace_bytes,
        cost: row.estimated_cost_usd,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.cost - a.cost);
}

function aggregateByDate(rows: UsageRow[]): DailyAggregate[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const existing = map.get(row.date) ?? 0;
    map.set(row.date, existing + row.log_bytes + row.trace_bytes);
  }
  return Array.from(map.entries())
    .map(([date, total_bytes]) => ({ date, total_bytes }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function CostPage() {
  /* ---- filter state ---- */
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  /* ---- data state ---- */
  const [usageData, setUsageData] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- fetch usage ---- */
  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);

      const res = await fetch(`/api/v1/cost/usage?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: UsageResponse = await res.json();
      setUsageData(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch usage data');
      setUsageData([]);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  /* ---- computed values ---- */
  const totalLogs = usageData.reduce((sum, r) => sum + r.log_count, 0);
  const totalTraces = usageData.reduce((sum, r) => sum + r.trace_count, 0);
  const totalBytes = usageData.reduce((sum, r) => sum + r.log_bytes + r.trace_bytes, 0);
  const totalCost = usageData.reduce((sum, r) => sum + r.estimated_cost_usd, 0);

  const serviceBreakdown = aggregateByService(usageData);
  const dailyVolume = aggregateByDate(usageData);
  const maxDailyBytes = Math.max(...dailyVolume.map((d) => d.total_bytes), 1);

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header with date range picker */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Cost Management</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Track log and trace volume, data ingestion, and estimated costs.
          </p>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="cost-from" className="text-xs text-[var(--muted)]">
              From
            </label>
            <input
              id="cost-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cost-to" className="text-xs text-[var(--muted)]">
              To
            </label>
            <input
              id="cost-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-[var(--card-border)] bg-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading usage data...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading usage data</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && usageData.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">
            &#128200;
          </span>
          <p className="text-sm font-medium text-white">No usage data available</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Usage statistics are updated hourly.
          </p>
        </div>
      )}

      {/* Main content */}
      {!loading && !error && usageData.length > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <SummaryCard label="Total Log Volume" value={formatCount(totalLogs)} />
            <SummaryCard label="Total Trace Volume" value={formatCount(totalTraces)} />
            <SummaryCard label="Total Data Ingested" value={formatBytes(totalBytes)} />
            <SummaryCard label="Estimated Cost" value={formatCost(totalCost)} highlight />
          </div>

          {/* Per-service breakdown table */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="text-sm font-medium text-white">Per-Service Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--card-border)] text-[var(--muted)]">
                    <th className="px-4 py-2.5 text-left font-medium">Service</th>
                    <th className="px-4 py-2.5 text-right font-medium">Logs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Traces</th>
                    <th className="px-4 py-2.5 text-right font-medium">Data</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                    <th className="px-4 py-2.5 text-right font-medium">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {serviceBreakdown.map((svc, i) => {
                    const pct = totalCost > 0 ? ((svc.cost / totalCost) * 100).toFixed(1) : '0.0';
                    return (
                      <tr
                        key={svc.service_name}
                        className={`border-b border-[var(--card-border)] last:border-b-0 ${
                          i % 2 === 1 ? 'bg-gray-800/50' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 text-white font-medium">{svc.service_name}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300 font-mono">
                          {formatCount(svc.log_count)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300 font-mono">
                          {formatCount(svc.trace_count)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300 font-mono">
                          {formatBytes(svc.total_bytes)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-white font-mono">
                          {formatCost(svc.cost)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--muted)] font-mono">
                          {pct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily volume chart */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="text-sm font-medium text-white">Daily Volume</h2>
            </div>
            <div className="p-4">
              <div className="flex items-end gap-1" style={{ height: '200px' }}>
                {dailyVolume.map((day) => {
                  const heightPct = (day.total_bytes / maxDailyBytes) * 100;
                  return (
                    <div
                      key={day.date}
                      className="flex-1 flex flex-col items-center justify-end gap-1 group relative"
                      style={{ height: '100%' }}
                    >
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-10">
                        <div className="rounded-lg bg-gray-900 border border-[var(--card-border)] px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg">
                          <p className="text-white font-medium">{day.date}</p>
                          <p className="text-[var(--muted)]">{formatBytes(day.total_bytes)}</p>
                        </div>
                      </div>
                      {/* Bar */}
                      <div
                        className="w-full rounded-t bg-[var(--accent)] hover:bg-[var(--accent-hover)] transition-colors min-h-[2px]"
                        style={{ height: `${Math.max(heightPct, 1)}%` }}
                      />
                    </div>
                  );
                })}
              </div>
              {/* Date labels */}
              <div className="flex gap-1 mt-2">
                {dailyVolume.map((day, i) => {
                  // Show label for first, last, and every ~7th bar
                  const showLabel =
                    i === 0 || i === dailyVolume.length - 1 || i % 7 === 0;
                  return (
                    <div key={day.date} className="flex-1 text-center">
                      {showLabel && (
                        <span className="text-[10px] text-[var(--muted)]">
                          {day.date.slice(5)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function SummaryCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          highlight ? 'text-[var(--accent)]' : 'text-white'
        }`}
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
