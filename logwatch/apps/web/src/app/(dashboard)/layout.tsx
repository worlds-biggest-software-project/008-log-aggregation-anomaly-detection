import Link from "next/link";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { href: "/logs", label: "Logs", icon: <LogsIcon /> },
  { href: "/traces", label: "Traces", icon: <TracesIcon /> },
  { href: "/anomalies", label: "Anomalies", icon: <AnomaliesIcon /> },
  { href: "/alerts", label: "Alerts", icon: <AlertsIcon /> },
  { href: "/services", label: "Services", icon: <ServicesIcon /> },
  { href: "/cost", label: "Cost", icon: <CostIcon /> },
  { href: "/settings", label: "Settings", icon: <SettingsIcon /> },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-screen">
      {/* Sidebar */}
      <aside
        className="flex flex-col w-56 shrink-0 border-r border-[var(--sidebar-border)] bg-[var(--sidebar-bg)]"
        aria-label="Main navigation"
      >
        {/* Wordmark */}
        <div className="flex items-center gap-2 h-14 px-4 border-b border-[var(--sidebar-border)]">
          <span className="text-lg select-none" aria-hidden="true">
            &#9711;
          </span>
          <span className="text-base font-bold tracking-tight text-white">
            LogWatch
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul role="list" className="space-y-0.5 px-2">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--muted)] hover:bg-white/5 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="w-4 h-4 shrink-0" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* User section */}
        <div className="border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            {/* Avatar placeholder */}
            <div
              className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center text-xs font-semibold text-white shrink-0"
              aria-hidden="true"
            >
              U
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">
                User Name
              </p>
              <p className="text-xs text-[var(--muted)] truncate">
                user@example.com
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="flex items-center justify-between h-14 px-6 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-bg)] shrink-0">
          <div className="flex items-center gap-2">
            {/* Breadcrumb / page title injected by child pages via layout slots or metadata */}
            <span className="text-sm text-[var(--muted)]">LogWatch</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Notification bell placeholder */}
            <button
              type="button"
              className="relative p-1.5 rounded-lg text-[var(--muted)] hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="Notifications"
            >
              <BellIcon />
            </button>
            {/* User avatar in header */}
            <div
              className="w-7 h-7 rounded-full bg-[var(--accent)] flex items-center justify-center text-xs font-semibold text-white cursor-pointer"
              aria-label="User menu"
            >
              U
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--background)]">
          {children}
        </main>
      </div>
    </div>
  );
}

// --- Icon components (inline SVGs to avoid additional icon library dependency) ---

function LogsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 4h12M2 8h8M2 12h10" strokeLinecap="round" />
    </svg>
  );
}

function TracesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="13" cy="4" r="1.5" />
      <circle cx="13" cy="12" r="1.5" />
      <path d="M4.5 8 11.5 4M4.5 8l7 4" strokeLinecap="round" />
    </svg>
  );
}

function AnomaliesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 2v1M8 13v1M2 8H1M15 8h-1M4.1 4.1l-.7-.7M12.6 12.6l-.7-.7M11.9 4.1l.7-.7M3.4 12.6l-.7-.7" strokeLinecap="round" />
      <circle cx="8" cy="8" r="3" />
    </svg>
  );
}

function AlertsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M8 1l7 13H1L8 1z" strokeLinejoin="round" />
      <path d="M8 6v3M8 11v.5" strokeLinecap="round" />
    </svg>
  );
}

function ServicesIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function CostIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="8" cy="8" r="7" />
      <path d="M8 4v1.5M8 10.5V12M5.5 9.5c0 1.1.9 1.5 2.5 1.5s2.5-.5 2.5-1.5S9.5 8 8 8s-2.5-.9-2.5-2 .9-1.5 2.5-1.5 2.5.5 2.5 1.5" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M8 1.5A4.5 4.5 0 0 0 3.5 6v3L2 11h12l-1.5-2V6A4.5 4.5 0 0 0 8 1.5zM6.5 11.5a1.5 1.5 0 0 0 3 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
