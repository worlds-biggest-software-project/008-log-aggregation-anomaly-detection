'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Service {
  id: string;
  name: string;
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

interface ThresholdAdjustment {
  metric_name: string;
  current_threshold: number;
  recommended_threshold: number;
  adjustment_reason: string;
  confidence: number;
  explanation?: string;
}

/* ------------------------------------------------------------------ */
/*  Mock data (used until baselines-by-service endpoint is available)  */
/* ------------------------------------------------------------------ */
// TODO: Wire up when baselines-by-service endpoint is available

const MOCK_SERVICES: Service[] = [
  { id: 'svc-001', name: 'api-gateway' },
  { id: 'svc-002', name: 'auth-service' },
  { id: 'svc-003', name: 'payment-service' },
];

function generateMockHourlyPattern(): Record<string, number> {
  const pattern: Record<string, number> = {};
  for (let h = 0; h < 24; h++) {
    // Simulate a realistic traffic pattern: low overnight, peak during business hours
    let value: number;
    if (h >= 2 && h <= 5) value = 50 + Math.random() * 30;
    else if (h >= 9 && h <= 17) value = 300 + Math.random() * 150;
    else if (h >= 18 && h <= 22) value = 180 + Math.random() * 80;
    else value = 100 + Math.random() * 60;
    pattern[String(h)] = Math.round(value);
  }
  return pattern;
}

function generateMockDowPattern(): Record<string, number> {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pattern: Record<string, number> = {};
  days.forEach((_, i) => {
    // Weekdays higher, weekends lower
    pattern[String(i)] = i < 5 ? 200 + Math.random() * 100 : 80 + Math.random() * 60;
  });
  return pattern;
}

const MOCK_BASELINES: Record<string, AnomalyBaseline[]> = {
  'svc-001': [
    {
      metric_name: 'error_rate',
      baseline_mean: 0.023,
      baseline_stddev: 0.008,
      baseline_p50: 0.021,
      baseline_p95: 0.038,
      baseline_p99: 0.045,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 672,
      last_updated_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      metric_name: 'log_volume',
      baseline_mean: 4520,
      baseline_stddev: 1280,
      baseline_p50: 4200,
      baseline_p95: 6800,
      baseline_p99: 7500,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 672,
      last_updated_at: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      metric_name: 'latency_p99',
      baseline_mean: 245,
      baseline_stddev: 85,
      baseline_p50: 220,
      baseline_p95: 410,
      baseline_p99: 520,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 672,
      last_updated_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  'svc-002': [
    {
      metric_name: 'error_rate',
      baseline_mean: 0.005,
      baseline_stddev: 0.002,
      baseline_p50: 0.004,
      baseline_p95: 0.009,
      baseline_p99: 0.011,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 504,
      last_updated_at: new Date(Date.now() - 7200000).toISOString(),
    },
    {
      metric_name: 'log_volume',
      baseline_mean: 1200,
      baseline_stddev: 350,
      baseline_p50: 1100,
      baseline_p95: 1850,
      baseline_p99: 2100,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 504,
      last_updated_at: new Date(Date.now() - 7200000).toISOString(),
    },
  ],
  'svc-003': [
    {
      metric_name: 'error_rate',
      baseline_mean: 0.041,
      baseline_stddev: 0.019,
      baseline_p50: 0.037,
      baseline_p95: 0.072,
      baseline_p99: 0.088,
      hourly_pattern: generateMockHourlyPattern(),
      dow_pattern: generateMockDowPattern(),
      sample_count: 336,
      last_updated_at: new Date(Date.now() - 1800000).toISOString(),
    },
  ],
};

const MOCK_ADJUSTMENTS: ThresholdAdjustment[] = [
  {
    metric_name: 'error_rate',
    current_threshold: 3.0,
    recommended_threshold: 2.5,
    adjustment_reason:
      'Very stable metric (CV=0.035): lowered threshold to 2.5 for tighter anomaly detection.',
    confidence: 0.85,
    explanation:
      'Your error rate has been very consistent over the past 4 weeks. We recommend tightening the alert threshold so you catch smaller deviations sooner. This may result in a few more alerts, but they are more likely to be meaningful.',
  },
  {
    metric_name: 'log_volume',
    current_threshold: 3.0,
    recommended_threshold: 3.5,
    adjustment_reason:
      'Volatile metric (CV=0.283): raised threshold to 3.5 to reduce false positives from natural variance.',
    confidence: 0.72,
    explanation:
      'Log volume for this service fluctuates significantly throughout the day. Raising the threshold will reduce noisy alerts during peak hours without missing genuinely unusual spikes.',
  },
];

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
    hour12: false,
  });
}

function formatMetricValue(value: number | null | undefined): string {
  if (value == null) return '--';
  if (Math.abs(value) < 1) return value.toFixed(4);
  if (Math.abs(value) < 100) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-500';
  if (confidence >= 0.6) return 'bg-amber-500';
  return 'bg-red-500';
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function BaselinesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string>('');
  const [baselines, setBaselines] = useState<AnomalyBaseline[]>([]);
  const [adjustments, setAdjustments] = useState<ThresholdAdjustment[]>([]);
  const [loading, setLoading] = useState(false);

  /* ---- load services ---- */
  useEffect(() => {
    // TODO: Wire up when baselines-by-service endpoint is available
    // For now, use mock data
    setServices(MOCK_SERVICES);
    if (MOCK_SERVICES.length > 0) {
      setSelectedServiceId(MOCK_SERVICES[0].id);
    }
  }, []);

  /* ---- load baselines when service changes ---- */
  const loadBaselines = useCallback(async (serviceId: string) => {
    if (!serviceId) return;
    setLoading(true);
    try {
      // TODO: Wire up when baselines-by-service endpoint is available
      // const res = await fetch(`/api/v1/services/${serviceId}/baselines`);
      // if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // const json = await res.json();
      // setBaselines(json.baselines ?? []);

      // Mock data fallback
      await new Promise((r) => setTimeout(r, 300));
      setBaselines(MOCK_BASELINES[serviceId] ?? []);
      setAdjustments(MOCK_ADJUSTMENTS);
    } catch {
      setBaselines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedServiceId) {
      loadBaselines(selectedServiceId);
    }
  }, [selectedServiceId, loadBaselines]);

  const selectedService = services.find((s) => s.id === selectedServiceId);

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Anomaly Baselines &amp; Thresholds
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            View baseline metrics, temporal patterns, and adaptive threshold recommendations.
          </p>
        </div>
      </div>

      {/* Service selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="service-select" className="text-sm text-[var(--muted)]">
          Service
        </label>
        <select
          id="service-select"
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
          className="w-64 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
        >
          {services.map((svc) => (
            <option key={svc.id} value={svc.id}>
              {svc.name}
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading baselines...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && baselines.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">
            &#9711;
          </span>
          <p className="text-sm font-medium text-white">No baselines available</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Baselines are computed automatically after a service has been ingesting logs for at
            least 7 days.
          </p>
        </div>
      )}

      {/* Baseline cards */}
      {!loading && baselines.length > 0 && (
        <div className="space-y-6">
          {baselines.map((baseline) => (
            <BaselineCard key={baseline.metric_name} baseline={baseline} />
          ))}
        </div>
      )}

      {/* Threshold adjustments section */}
      {!loading && adjustments.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Threshold Adjustments</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              AI-recommended threshold changes for{' '}
              <span className="text-cyan-400">{selectedService?.name ?? 'this service'}</span>.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {adjustments.map((adj) => (
              <AdjustmentCard key={adj.metric_name} adjustment={adj} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Baseline card                                                     */
/* ------------------------------------------------------------------ */

function BaselineCard({ baseline }: { baseline: AnomalyBaseline }) {
  const hourlyPattern = baseline.hourly_pattern ?? {};
  const dowPattern = baseline.dow_pattern ?? {};
  const hourlyEntries = Object.entries(hourlyPattern)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const dowEntries = Object.entries(dowPattern)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  const maxHourly = hourlyEntries.length > 0 ? Math.max(...hourlyEntries.map((e) => e[1])) : 1;
  const maxDow = dowEntries.length > 0 ? Math.max(...dowEntries.map((e) => e[1])) : 1;

  // Threshold visualization: show mean +/- 1, 2, 3 stddev ranges
  const mean = baseline.baseline_mean;
  const stddev = baseline.baseline_stddev;
  const thresholdZ = 3.0;
  const maxRange = mean + thresholdZ * stddev;
  const minRange = Math.max(0, mean - thresholdZ * stddev);
  const totalRange = maxRange - minRange || 1;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-5">
      {/* Metric header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-white">{metricLabel(baseline.metric_name)}</h3>
          <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-xs text-[var(--muted)]">
            {baseline.sample_count} samples
          </span>
        </div>
        <span className="text-xs text-[var(--muted)]">
          Updated {formatTimestamp(baseline.last_updated_at)}
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-4">
        <StatBox label="Mean" value={formatMetricValue(baseline.baseline_mean)} />
        <StatBox label="Std Dev" value={formatMetricValue(baseline.baseline_stddev)} />
        <StatBox label="P50" value={formatMetricValue(baseline.baseline_p50)} />
        <StatBox label="P95" value={formatMetricValue(baseline.baseline_p95)} />
        <StatBox label="P99" value={formatMetricValue(baseline.baseline_p99)} />
      </div>

      {/* Threshold visualization */}
      <div>
        <p className="text-xs text-[var(--muted)] mb-2">
          Z-Score Threshold Position (default: 3.0)
        </p>
        <div className="relative h-8 rounded-lg bg-gray-800 overflow-hidden">
          {/* 1-sigma band */}
          <div
            className="absolute top-0 h-full bg-green-500/15"
            style={{
              left: `${((Math.max(0, mean - stddev) - minRange) / totalRange) * 100}%`,
              width: `${((2 * stddev) / totalRange) * 100}%`,
            }}
          />
          {/* 2-sigma band */}
          <div
            className="absolute top-0 h-full bg-amber-500/10"
            style={{
              left: `${((Math.max(0, mean - 2 * stddev) - minRange) / totalRange) * 100}%`,
              width: `${((4 * stddev) / totalRange) * 100}%`,
            }}
          />
          {/* Mean marker */}
          <div
            className="absolute top-0 h-full w-0.5 bg-white/60"
            style={{
              left: `${((mean - minRange) / totalRange) * 100}%`,
            }}
          />
          {/* Threshold markers */}
          <div
            className="absolute top-0 h-full w-0.5 bg-red-500"
            style={{
              left: `${((Math.min(mean + thresholdZ * stddev, maxRange) - minRange) / totalRange) * 100}%`,
            }}
          />
          {/* Labels */}
          <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] text-gray-400 pointer-events-none">
            <span>{formatMetricValue(minRange)}</span>
            <span className="text-white/70 font-medium">
              mean={formatMetricValue(mean)}
            </span>
            <span className="text-red-400">
              +3s={formatMetricValue(mean + thresholdZ * stddev)}
            </span>
          </div>
        </div>
        <div className="flex gap-4 mt-1.5 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500/30" /> 1 sigma
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500/20" /> 2 sigma
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500" /> threshold
          </span>
        </div>
      </div>

      {/* Pattern charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Hourly pattern */}
        <div>
          <p className="text-xs text-[var(--muted)] mb-2">Hourly Pattern (24h)</p>
          <div className="flex items-end gap-px h-24">
            {hourlyEntries.map(([hour, value]) => (
              <div
                key={hour}
                className="flex-1 group relative"
                title={`Hour ${hour}: ${formatMetricValue(value)}`}
              >
                <div
                  className="w-full rounded-t-sm bg-cyan-500/60 group-hover:bg-cyan-400 transition-colors"
                  style={{ height: `${(value / maxHourly) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            <span>0h</span>
            <span>6h</span>
            <span>12h</span>
            <span>18h</span>
            <span>23h</span>
          </div>
        </div>

        {/* Day-of-week pattern */}
        <div>
          <p className="text-xs text-[var(--muted)] mb-2">Day of Week Pattern</p>
          <div className="flex items-end gap-1.5 h-24">
            {dowEntries.map(([day, value]) => (
              <div
                key={day}
                className="flex-1 group relative"
                title={`${DOW_LABELS[day] ?? day}: ${formatMetricValue(value)}`}
              >
                <div
                  className="w-full rounded-t-sm bg-purple-500/60 group-hover:bg-purple-400 transition-colors"
                  style={{ height: `${(value / maxDow) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-500">
            {dowEntries.map(([day]) => (
              <span key={day}>{DOW_LABELS[day] ?? day}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat box                                                          */
/* ------------------------------------------------------------------ */

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-white/[0.02] p-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-1">{label}</p>
      <p className="text-sm font-mono font-semibold text-white">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Adjustment card                                                   */
/* ------------------------------------------------------------------ */

function AdjustmentCard({ adjustment }: { adjustment: ThresholdAdjustment }) {
  const direction =
    adjustment.recommended_threshold > adjustment.current_threshold ? 'increase' : 'decrease';
  const directionColor =
    direction === 'increase' ? 'text-amber-400' : 'text-cyan-400';
  const arrowSymbol = direction === 'increase' ? '↑' : '↓';

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">{metricLabel(adjustment.metric_name)}</h4>
        <span className={`text-sm font-mono font-semibold ${directionColor}`}>
          {arrowSymbol} {adjustment.recommended_threshold.toFixed(1)}
        </span>
      </div>

      {/* Threshold change */}
      <div className="flex items-center gap-3 text-sm">
        <span className="text-[var(--muted)]">Current</span>
        <span className="font-mono text-white">{adjustment.current_threshold.toFixed(1)}</span>
        <span className="text-[var(--muted)]">&rarr;</span>
        <span className="text-[var(--muted)]">Recommended</span>
        <span className={`font-mono font-semibold ${directionColor}`}>
          {adjustment.recommended_threshold.toFixed(1)}
        </span>
      </div>

      {/* Confidence bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-[var(--muted)]">Confidence</span>
          <span className="font-mono text-white">
            {(adjustment.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${confidenceColor(adjustment.confidence)}`}
            style={{ width: `${adjustment.confidence * 100}%` }}
          />
        </div>
      </div>

      {/* AI explanation */}
      {adjustment.explanation && (
        <div className="rounded-lg border border-[var(--card-border)] bg-white/[0.02] p-3">
          <p className="text-xs text-[var(--muted)] mb-1 uppercase tracking-wider">
            AI Explanation
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">{adjustment.explanation}</p>
        </div>
      )}

      {/* Action buttons (UI only, not wired up) */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Accept
        </button>
        <button
          type="button"
          className="rounded-lg border border-[var(--card-border)] bg-transparent px-4 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Metric label helper                                               */
/* ------------------------------------------------------------------ */

function metricLabel(name: string): string {
  switch (name) {
    case 'error_rate':
      return 'Error Rate';
    case 'log_volume':
      return 'Log Volume';
    case 'latency_p99':
      return 'Latency (P99)';
    case 'latency_p95':
      return 'Latency (P95)';
    default:
      return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
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
