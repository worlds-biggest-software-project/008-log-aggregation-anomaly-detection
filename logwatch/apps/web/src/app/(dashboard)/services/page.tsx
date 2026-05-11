'use client';

import { useState, useEffect, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Service {
  id: string;
  name: string;
  namespace: string;
  environment: string;
  language: string | null;
  owner_team: string | null;
  last_seen_at: string;
  first_seen_at: string;
}

interface ServicesResponse {
  data: Service[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

interface Dependency {
  target_service_name?: string;
  source_service_name?: string;
  dependency_type: string;
  call_count_24h: number;
  avg_duration_ms: number;
  error_rate_24h: number;
}

interface ServiceDependencies {
  outgoing: Dependency[];
  incoming: Dependency[];
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

const ENV_COLORS: Record<string, string> = {
  production: 'bg-green-900/50 text-green-400 border-green-800',
  staging: 'bg-amber-900/50 text-amber-400 border-amber-800',
  development: 'bg-blue-900/50 text-blue-400 border-blue-800',
  testing: 'bg-purple-900/50 text-purple-400 border-purple-800',
};

function envBadgeClass(env: string): string {
  return ENV_COLORS[env.toLowerCase()] ?? 'bg-gray-800 text-gray-400 border-gray-700';
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function ServicesPage() {
  /* ---- filter state ---- */
  const [envFilter, setEnvFilter] = useState('');
  const [nsSearch, setNsSearch] = useState('');

  /* ---- data state ---- */
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- selected service state ---- */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deps, setDeps] = useState<ServiceDependencies | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);

  /* ---- fetch services ---- */
  const fetchServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (envFilter) params.set('environment', envFilter);
      if (nsSearch) params.set('namespace', nsSearch);
      params.set('limit', '50');

      const res = await fetch(`/api/v1/services?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ServicesResponse = await res.json();
      setServices(json.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services');
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, [envFilter, nsSearch]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  /* ---- fetch dependencies ---- */
  const fetchDeps = useCallback(async (serviceId: string) => {
    setDepsLoading(true);
    setDeps(null);
    try {
      const res = await fetch(`/api/v1/services/${serviceId}/dependencies`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDeps(json);
    } catch {
      setDeps({ outgoing: [], incoming: [] });
    } finally {
      setDepsLoading(false);
    }
  }, []);

  /* ---- select a service card ---- */
  const handleSelect = (svc: Service) => {
    if (selectedId === svc.id) {
      setSelectedId(null);
      setDeps(null);
    } else {
      setSelectedId(svc.id);
      fetchDeps(svc.id);
    }
  };

  /* ---- render ---- */
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Service Registry</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          View all registered services, their metadata, and dependency relationships.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="svc-env" className="text-xs text-[var(--muted)]">
            Environment
          </label>
          <select
            id="svc-env"
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value)}
            className="w-40 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
          >
            <option value="">All environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
            <option value="testing">Testing</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="svc-ns" className="text-xs text-[var(--muted)]">
            Namespace
          </label>
          <input
            id="svc-ns"
            type="text"
            placeholder="Search namespace..."
            value={nsSearch}
            onChange={(e) => setNsSearch(e.target.value)}
            className="w-48 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3 text-[var(--muted)]">
            <LoadingSpinner />
            <span className="text-sm">Loading services...</span>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
          <p className="text-sm font-medium text-red-400">Error loading services</p>
          <p className="text-sm text-[var(--muted)]">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && services.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <span className="text-4xl select-none" aria-hidden="true">
            &#9881;
          </span>
          <p className="text-sm font-medium text-white">No services found</p>
          <p className="text-sm text-[var(--muted)] max-w-xs">
            Services are auto-registered when telemetry is ingested. Send some logs or traces to get started.
          </p>
        </div>
      )}

      {/* Service card grid */}
      {!loading && !error && services.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {services.map((svc) => {
            const isSelected = selectedId === svc.id;
            return (
              <button
                key={svc.id}
                type="button"
                onClick={() => handleSelect(svc)}
                className={`rounded-xl border bg-[var(--card-bg)] p-4 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                  isSelected
                    ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
                    : 'border-[var(--card-border)]'
                }`}
              >
                {/* Service name */}
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-white truncate">
                    {svc.name}
                  </h3>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${envBadgeClass(svc.environment)}`}
                  >
                    {svc.environment}
                  </span>
                </div>

                {/* Metadata rows */}
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--muted)] w-20 shrink-0">Namespace</span>
                    <span className="text-gray-300 truncate">{svc.namespace}</span>
                  </div>

                  {svc.language && (
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--muted)] w-20 shrink-0">Language</span>
                      <span className="text-gray-300">{svc.language}</span>
                    </div>
                  )}

                  {svc.owner_team && (
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--muted)] w-20 shrink-0">Owner</span>
                      <span className="text-gray-300">{svc.owner_team}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-[var(--muted)] w-20 shrink-0">Last seen</span>
                    <span className="text-gray-400">{relativeTime(svc.last_seen_at)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Dependencies panel */}
      {selectedId && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--card-border)] flex items-center justify-between">
            <h3 className="text-sm font-medium text-white">
              Dependencies &mdash;{' '}
              <span className="text-blue-400">
                {services.find((s) => s.id === selectedId)?.name}
              </span>
            </h3>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setDeps(null);
              }}
              className="text-[var(--muted)] hover:text-white text-sm transition-colors"
              aria-label="Close dependencies panel"
            >
              Close
            </button>
          </div>

          {depsLoading && (
            <div className="flex items-center gap-2 py-10 justify-center text-[var(--muted)]">
              <LoadingSpinner />
              <span className="text-sm">Loading dependencies...</span>
            </div>
          )}

          {!depsLoading && deps && (
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--card-border)]">
              {/* Calls (outgoing) */}
              <div className="p-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
                  Calls (outgoing)
                </h4>
                {deps.outgoing.length === 0 ? (
                  <p className="text-sm text-gray-500">No outgoing dependencies</p>
                ) : (
                  <div className="space-y-2">
                    {deps.outgoing.map((dep, i) => (
                      <DependencyRow key={i} dep={dep} />
                    ))}
                  </div>
                )}
              </div>

              {/* Called by (incoming) */}
              <div className="p-4">
                <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--muted)] mb-3">
                  Called by (incoming)
                </h4>
                {deps.incoming.length === 0 ? (
                  <p className="text-sm text-gray-500">No incoming dependencies</p>
                ) : (
                  <div className="space-y-2">
                    {deps.incoming.map((dep, i) => (
                      <DependencyRow key={i} dep={dep} />
                    ))}
                  </div>
                )}
              </div>
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

function DependencyRow({ dep }: { dep: Dependency }) {
  const errorRatePct = (dep.error_rate_24h * 100).toFixed(1);
  const isHighError = dep.error_rate_24h > 0.05;

  return (
    <div className="rounded-lg bg-gray-950 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-cyan-400">{dep.target_service_name ?? dep.source_service_name}</span>
        <span className="text-xs text-gray-500">{dep.dependency_type}</span>
      </div>
      <div className="flex items-center gap-4 mt-1.5 text-xs">
        <span className="text-gray-400">
          <span className="text-gray-500">calls:</span>{' '}
          <span className="font-mono text-gray-300">
            {dep.call_count_24h.toLocaleString()}
          </span>
        </span>
        <span className="text-gray-400">
          <span className="text-gray-500">avg:</span>{' '}
          <span className="font-mono text-gray-300">
            {dep.avg_duration_ms.toFixed(1)} ms
          </span>
        </span>
        <span className={isHighError ? 'text-red-400' : 'text-gray-400'}>
          <span className={isHighError ? 'text-red-500' : 'text-gray-500'}>err:</span>{' '}
          <span className="font-mono">{errorRatePct}%</span>
        </span>
      </div>
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
