"use client";

import type { Metadata } from "next";

// NOTE: signIn is imported from next-auth/react at runtime.
// It is typed here inline to avoid requiring auth.ts at scaffold stage.
// Replace with: import { signIn } from "@/auth" once auth.ts is configured.
async function signIn(provider: string) {
  const { signIn: nextAuthSignIn } = await import("next-auth/react");
  await nextAuthSignIn(provider, { callbackUrl: "/logs" });
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo / wordmark */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 mb-2">
            <span className="text-2xl select-none">&#9711;</span>
            <span className="text-2xl font-bold tracking-tight text-white">
              LogWatch
            </span>
          </div>
          <p className="text-sm text-[var(--muted)]">
            AI-native observability platform
          </p>
        </div>

        {/* Sign-in card */}
        <div className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-xl p-8 shadow-xl space-y-4">
          <h1 className="text-lg font-semibold text-white text-center">
            Sign in to your workspace
          </h1>

          {/* Google */}
          <button
            type="button"
            onClick={() => signIn("google")}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-[var(--card-border)] bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <GoogleIcon />
            Sign in with Google
          </button>

          {/* GitHub */}
          <button
            type="button"
            onClick={() => signIn("github")}
            className="w-full flex items-center justify-center gap-3 rounded-lg border border-[var(--card-border)] bg-white/5 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <GitHubIcon />
            Sign in with GitHub
          </button>
        </div>

        <p className="text-center text-xs text-[var(--muted)]">
          By signing in you agree to our{" "}
          <a href="/terms" className="underline hover:text-white">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="underline hover:text-white">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.216.694.825.576C20.565 21.795 24 17.298 24 12c0-6.63-5.37-12-12-12Z" />
    </svg>
  );
}
