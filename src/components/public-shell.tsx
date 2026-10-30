"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MockBanner } from "./source";
import { Logo } from "./shell";
import { RouteAnnouncements } from "./route-announcements";

/** Shell for the public landing and the guided demo: no operational sidebar. */
export function PublicShell({ children, banner = <MockBanner /> }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <div className="veilpay-app-shell min-h-screen bg-zinc-950 text-zinc-100">
      <div className="veilpay-top-strip" aria-hidden />
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-accent-400 focus:p-3 focus:text-zinc-950">Skip to main content</a>
      <RouteAnnouncements />
      {banner}
      <header className="border-b border-zinc-800 bg-zinc-950/55 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <Logo />
          <nav className="flex items-center gap-1 text-sm" aria-label="Site">
            <Link href="/demo" className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50">Demo</Link>
            <Link href="/app" className="rounded-lg px-3 py-1.5 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50">Open VeilPay</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="focus:outline-none">{children}</main>
      <footer className="mx-auto max-w-6xl border-t border-zinc-900 px-4 py-8 text-xs leading-relaxed text-zinc-500 lg:px-8">
        VeilPay is a Zecathon 2026 project. Sending on the main Zcash network is disabled; test-network payments are sent by an operator, never from your browser. Owner and merchant views are demo sessions, not real sign-in.
      </footer>
    </div>
  );
}
