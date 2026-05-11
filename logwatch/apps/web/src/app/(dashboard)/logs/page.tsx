import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log Explorer",
};

export default function LogsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Log Explorer</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Search and filter log events across all services and environments.
        </p>
      </div>

      {/* Search bar */}
      <LogSearchBar />

      {/* Time range + filter row */}
      <div className="flex flex-wrap items-center gap-3">
        <TimeRangeSelector />
        <SeverityFilter />
        <ServiceFilter />
        <div className="ml-auto">
          <RefreshButton />
        </div>
      </div>

      {/* Results placeholder */}
      <LogResultsPlaceholder />
    </div>
  );
}

function LogSearchBar() {
  return (
    <form
      role="search"
      aria-label="Search logs"
      className="relative flex items-center"
    >
      <label htmlFor="log-search" className="sr-only">
        Search logs
      </label>
      <span
        className="absolute left-3 text-[var(--muted)] pointer-events-none"
        aria-hidden="true"
      >
        <SearchIcon />
      </span>
      <input
        id="log-search"
        type="search"
        name="q"
        placeholder='Search logs — try "error 502" or service:api level:error'
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] pl-10 pr-4 py-2.5 text-sm text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow"
      />
      <button
        type="submit"
        className="absolute right-2 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--accent-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Search
      </button>
    </form>
  );
}

function TimeRangeSelector() {
  return (
    <select
      aria-label="Time range"
      defaultValue="1h"
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
    >
      <option value="15m">Last 15 minutes</option>
      <option value="1h">Last 1 hour</option>
      <option value="6h">Last 6 hours</option>
      <option value="24h">Last 24 hours</option>
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
    </select>
  );
}

function SeverityFilter() {
  return (
    <select
      aria-label="Severity"
      defaultValue=""
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
    >
      <option value="">All severities</option>
      <option value="TRACE">TRACE</option>
      <option value="DEBUG">DEBUG</option>
      <option value="INFO">INFO</option>
      <option value="WARN">WARN</option>
      <option value="ERROR">ERROR</option>
      <option value="FATAL">FATAL</option>
    </select>
  );
}

function ServiceFilter() {
  return (
    <select
      aria-label="Service"
      defaultValue=""
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[var(--accent)] cursor-pointer"
    >
      <option value="">All services</option>
      {/* Populated dynamically at runtime */}
    </select>
  );
}

function RefreshButton() {
  return (
    <button
      type="button"
      aria-label="Refresh results"
      className="flex items-center gap-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-sm text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <RefreshIcon />
      Refresh
    </button>
  );
}

function LogResultsPlaceholder() {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[auto_120px_160px_1fr] gap-4 px-4 py-2.5 border-b border-[var(--card-border)] text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        <span>Severity</span>
        <span>Time</span>
        <span>Service</span>
        <span>Message</span>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <span className="text-4xl select-none" aria-hidden="true">
          &#128270;
        </span>
        <p className="text-sm font-medium text-white">No logs to display</p>
        <p className="text-sm text-[var(--muted)] max-w-xs">
          Run a search above or adjust the time range to explore your log data.
        </p>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
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
      <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 4.5 2.3" strokeLinecap="round" />
      <path d="M14 2v3h-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
