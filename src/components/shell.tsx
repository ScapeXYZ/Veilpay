"use client";

import clsx from "clsx";
import { AlertTriangle, Eye, LayoutDashboard, ListOrdered, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isMockClient } from "@/lib/api";
import { errorText, useApi, useHealth, useSession, useSwitchContext } from "@/lib/api/hooks";
import { fmtTime } from "@/lib/present";
import { MockBanner, SourceTag } from "./source";
import { Badge, Button, ErrorBox, Skeleton } from "./ui";
import { DemoGuide } from "./demo-guide";
import { MockControlsPanel } from "./mock-controls";
import { RouteAnnouncements } from "./route-announcements";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/policy", label: "Agent policy", icon: ShieldCheck },
  { href: "/payments", label: "Payments", icon: ListOrdered },
  { href: "/merchant", label: "Merchant", icon: Store },
  { href: "/privacy", label: "Privacy lens", icon: Eye },
];

export function HealthStrip() {
  const { data: h } = useHealth();
  if (!h) return null;
  return (
    <div className="flex flex-col gap-2">
      {h.chainWatcher.deepReorgAlert && (
        <div data-testid="deep-reorg-alert" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/60 px-4 py-2.5 text-sm text-rose-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <b>Deep reorg alert.</b> A reorg deeper than the {h.chainWatcher.watchDepth}-block watch depth was detected. Payments past that depth are not re-tracked automatically; an operator is reviewing.
          </span>
        </div>
      )}
      {h.wallet === "operator_required" && (
        <div data-testid="operator-required-strip" className="rounded-xl border border-violet-900 bg-violet-950/30 px-4 py-2 text-xs text-violet-200">
          Manual testnet mode: staged payments wait for operator confirmation in a separate terminal. This app never signs or broadcasts.
        </div>
      )}
      {h.chainWatcher.supported === false && (
        <div data-testid="no-header-watcher" className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-400">
          No independent chain header watcher: reorg information comes from wallet observations only.
        </div>
      )}
      {h.reconciler.unresolved > 0 && (
        <div data-testid="reconciler-strip" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          <span>
            <b>{h.reconciler.unresolved}</b> send{h.reconciler.unresolved === 1 ? "" : "s"} with unresolved outcome. Never resent automatically.
          </span>
          {h.reconciler.lastRunAt && <span className="text-amber-300/70">Reconciler last ran {fmtTime(h.reconciler.lastRunAt)}.</span>}
          <Badge tone="warning">Provisional</Badge>
        </div>
      )}
    </div>
  );
}

function ContextSwitch() {
  const { data: s } = useSession();
  const sw = useSwitchContext();
  return (
    <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1 ring-1 ring-zinc-800" role="group" aria-label="Demo context">
      {(["customer", "merchant"] as const).map((c) => (
        <button
          key={c}
          data-testid={`ctx-${c}`}
          onClick={() => s?.context !== c && sw.mutate(c)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-medium capitalize",
            s?.context === c ? "bg-amber-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100",
          )}
          aria-pressed={s?.context === c}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const api = useApi();
  const { data: h } = useHealth();
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-amber-400 focus:p-3 focus:text-zinc-950">Skip to main content</a>
      <RouteAnnouncements />
      <MockBanner />
      <header className="border-b border-zinc-900 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 font-black text-zinc-950">V</span>
            <span className="font-semibold tracking-tight">VeilPay</span>
            <span className="hidden text-xs text-zinc-500 sm:inline">shielded payments for AI agents</span>
          </Link>
          <div className="flex items-center gap-2">
            <SourceTag />
            {h && <Badge tone="neutral">{h.network}</Badge>}
            <ContextSwitch />
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? "page" : undefined}
              className={clsx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm",
                path === href ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              )}
            >
              <Icon size={15} aria-hidden /> {label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6">
        <HealthStrip />
        <DemoGuide />
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-zinc-600">
        Built against contracts/openapi.yaml. Testnet only. Demo sessions are role isolation, not authentication.
        {isMockClient(api) && <MockControlsPanel />}
      </footer>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <SourceTag />
      </div>
    </div>
  );
}

export function RequireContext({ ctx, children }: { ctx: "customer" | "merchant"; children: ReactNode }) {
  const { data: s, isLoading, error, refetch } = useSession();
  const sw = useSwitchContext();
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !s) return <ErrorBox>
    <p>Could not load your session. {errorText(error)}</p>
    <Button variant="secondary" onClick={() => refetch()}>Try again</Button>
  </ErrorBox>;
  if (s.context !== ctx)
    return (
      <div data-testid="wrong-context" className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-300">
        <p className="mb-3">
          This view needs the <b>{ctx}</b> demo context. Contexts are isolated: the {s.context} session cannot read {ctx} data.
        </p>
        <Button onClick={() => sw.mutate(ctx)} busy={sw.isPending}>
          Switch to {ctx} context
        </Button>
      </div>
    );
  return <>{children}</>;
}
