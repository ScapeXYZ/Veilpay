"use client";

import clsx from "clsx";
import { Activity, AlertTriangle, Eye, Home, LayoutDashboard, LifeBuoy, ListOrdered, Loader2, Lock, MoreHorizontal, PlayCircle, Shield, ShieldCheck, Store, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useHealth, useSession, useSwitchContext } from "@/lib/api/hooks";
import { fmtTime } from "@/lib/present";
import { MockBanner, SourceTag } from "./source";
import { Badge, Button, ErrorBox, Skeleton } from "./ui";
import { RouteAnnouncements } from "./route-announcements";
import { Term } from "./term";

export function HealthStrip() {
  const { data: h } = useHealth();
  if (!h) return null;
  return (
    <div className="flex flex-col gap-2">
      {h.chainWatcher.deepReorgAlert && (
        <div data-testid="deep-reorg-alert" role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/60 px-4 py-2.5 text-sm text-rose-100">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <b>Network correction alert.</b> The network replaced more than {h.chainWatcher.watchDepth} recent blocks (the watch depth), a deep <Term k="reorg">reorg</Term>. Older payments are not re-checked automatically; an operator is reviewing.
          </span>
        </div>
      )}
      {h.wallet === "operator_required" && (
        <div data-testid="operator-required-strip" className="rounded-xl border border-violet-900 bg-violet-950/30 px-4 py-2 text-xs text-violet-200">
          Payments are sent by an <Term k="operator">operator</Term> from a separate terminal. This app never signs or sends.
        </div>
      )}
      {h.chainWatcher.supported === false && (
        <div data-testid="no-header-watcher" className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2 text-xs text-zinc-400">
          No independent block check: network corrections are only seen through the wallet.
        </div>
      )}
      {h.reconciler.unresolved > 0 && (
        <div data-testid="reconciler-strip" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-900 bg-amber-950/30 px-4 py-2 text-xs text-amber-200">
          <span>
            <b>{h.reconciler.unresolved}</b> {h.reconciler.unresolved === 1 ? "payment has" : "payments have"} an <Term k="outcomeUnknown">unknown outcome</Term>. VeilPay never resends them automatically.
          </span>
          {h.reconciler.lastRunAt && <span className="text-amber-300/70">Last <Term k="safetyCheck">safety check</Term> {fmtTime(h.reconciler.lastRunAt)}.</span>}
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
    <div className="flex items-center gap-1 rounded-lg bg-zinc-900 p-1 ring-1 ring-zinc-800" role="group" aria-label="View as">
      <span className="hidden px-1.5 text-[11px] text-zinc-500 sm:inline">View as</span>
      {(["customer", "merchant"] as const).map((c) => (
        <button
          key={c}
          data-testid={`ctx-${c}`}
          onClick={() => s?.context !== c && sw.mutate(c)}
          className={clsx(
            "rounded-md px-2.5 py-1 text-xs font-medium",
            s?.context === c ? "bg-accent-400 text-zinc-950" : "text-zinc-400 hover:text-zinc-100",
          )}
          aria-pressed={s?.context === c}
        >
          {c === "customer" ? "Owner" : "Merchant"}
        </button>
      ))}
    </div>
  );
}

const NAV = [
  { href: "/app", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { href: "/app/spending-rules", label: "Spending rules", short: "Rules", icon: ShieldCheck },
  { href: "/app/payments", label: "Payments", short: "Payments", icon: ListOrdered },
  { href: "/app/merchant", label: "Merchant", short: "Merchant", icon: Store },
  { href: "/app/help", label: "Help & demo", short: "Help", icon: LifeBuoy },
] as const;
/** Secondary areas: reachable from More and from contextual links, never in the main nav. */
const MORE = [
  { href: "/app/activity", label: "Activity", icon: Activity },
  { href: "/app/privacy", label: "Privacy", icon: Eye },
] as const;

function isActive(path: string, href: string) {
  return href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`);
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="VeilPay home">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-400 text-zinc-950" aria-hidden>
        <Shield size={17} strokeWidth={2.4} />
      </span>
      <span className="font-semibold tracking-tight text-zinc-50">VeilPay</span>
      {!compact && <span className="hidden text-xs text-zinc-500 xl:inline">safe spending for AI agents</span>}
    </Link>
  );
}

const WALLET_WORD: Record<string, string> = { ready: "ready", syncing: "catching up", unavailable: "unavailable", broadcast_disabled: "sending off", operator_required: "operator sends" };

function StatusStrip() {
  const m = useNetworkMode();
  const { data: h } = useHealth();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400" data-testid="status-strip">
      <SourceTag />
      {h && (
        <span className="tabular">
          {h.network === "testnet" ? <Term k="testnet">Test network</Term> : h.network === "mainnet" ? <Term k="mainnet">Main network</Term> : h.network} · wallet {WALLET_WORD[h.wallet]}
          {h.chainHeight != null && <> · block <span className="tabular-nums text-zinc-300">{h.chainHeight.toLocaleString("en-US")}</span></>}
        </span>
      )}
      {!m.canWrite && <span className="inline-flex items-center gap-1 text-accent-200"><Lock size={11} aria-hidden /> read-only</span>}
    </div>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const path = usePathname();
  return (
    <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="More navigation">
      <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-800 bg-zinc-900 p-4 pb-8">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">More</span>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800"><X size={16} /></button>
        </div>
        <nav className="grid grid-cols-2 gap-2" aria-label="More">
          {[NAV[4], ...MORE, { href: "/demo", label: "Guided demo", icon: PlayCircle }, { href: "/", label: "Home", icon: Home }].map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={onClose} aria-current={isActive(path, href) ? "page" : undefined}
              className={clsx("flex items-center gap-2 rounded-xl px-3 py-3 text-sm", isActive(path, href) ? "bg-accent-950 text-accent-200 ring-1 ring-accent-900" : "bg-zinc-950 text-zinc-300 ring-1 ring-zinc-800")}>
              <Icon size={16} aria-hidden /> {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

function RailLink({ href, active, small, children }: { href: string; active: boolean; small?: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 transition-colors duration-150", small ? "py-1.5 text-[13px]" : "py-2 text-sm",
        active ? "bg-accent-950 text-accent-200 ring-1 ring-inset ring-accent-900" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100")}>
      {children}
    </Link>
  );
}

/** Operational shell for /app/*: 224px rail on desktop, top bar + bottom nav with More on mobile. */
export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [more, setMore] = useState(false);
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-accent-400 focus:p-3 focus:text-zinc-950">Skip to main content</a>
      <RouteAnnouncements />
      <MockBanner />
      <div className="lg:flex">
        <aside className="hidden lg:sticky lg:top-8 lg:flex lg:h-[calc(100vh-2rem)] lg:w-56 lg:shrink-0 lg:flex-col lg:border-r lg:border-zinc-900 lg:px-3 lg:py-5">
          <div className="px-2"><Logo /></div>
          <nav className="mt-7 flex flex-col gap-0.5" aria-label="Main">
            {NAV.map(({ href, label, icon: Icon }) => (
              <RailLink key={href} href={href} active={isActive(path, href)}><Icon size={16} aria-hidden /> {label}</RailLink>
            ))}
          </nav>
          <div className="mt-6 px-2.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600" id="more-heading">More</div>
          <nav className="mt-1.5 flex flex-col gap-0.5" aria-labelledby="more-heading" data-testid="rail-more">
            {MORE.map(({ href, label, icon: Icon }) => (
              <RailLink key={href} href={href} active={isActive(path, href)} small><Icon size={15} aria-hidden /> {label}</RailLink>
            ))}
          </nav>
          <div className="mt-auto flex flex-col gap-3 px-2">
            <p className="text-[11px] leading-relaxed text-zinc-500">Owner and merchant views are separate demo sessions, not real sign-in.</p>
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="sticky top-8 z-40 border-b border-zinc-900 bg-zinc-950/85 backdrop-blur lg:top-8">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
              <div className="lg:hidden"><Logo compact /></div>
              <div className="hidden lg:block"><StatusStrip /></div>
              <ContextSwitch />
            </div>
            <div className="border-t border-zinc-900 px-4 py-1.5 lg:hidden"><StatusStrip /></div>
          </header>
          <main id="main-content" tabIndex={-1} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 pb-28 pt-6 lg:px-8 lg:pb-12">
            <HealthStrip />
            {children}
          </main>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-zinc-800 bg-zinc-950/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Main">
        {NAV.slice(0, 4).map(({ href, short, icon: Icon }) => (
          <Link key={href} href={href} aria-current={isActive(path, href) ? "page" : undefined}
            className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", isActive(path, href) ? "text-accent-300" : "text-zinc-400")}>
            <Icon size={18} aria-hidden /> {short}
          </Link>
        ))}
        <button onClick={() => setMore(true)} className={clsx("flex flex-col items-center gap-0.5 py-2 text-[11px]", [NAV[4], ...MORE].some((n) => isActive(path, n.href)) ? "text-accent-300" : "text-zinc-400")} aria-haspopup="dialog" data-testid="nav-more">
          <MoreHorizontal size={18} aria-hidden /> More
        </button>
      </nav>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <SourceTag />
      </div>
    </div>
  );
}

/**
 * Owner-only or merchant-only pages switch the demo session to the right role by themselves
 * (once, no loop), instead of parking the user behind a "switch context" button. The sessions stay
 * isolated server-side: the merchant session still cannot read the owner's data.
 */
export function RequireContext({ ctx, children }: { ctx: "customer" | "merchant"; children: ReactNode }) {
  const { data: s, isLoading, error, refetch } = useSession();
  const sw = useSwitchContext();
  const { mutate, isPending, isError } = sw;
  const wrong = !!s && s.context !== ctx;
  useEffect(() => {
    if (wrong && !isPending && !isError) mutate(ctx);
  }, [wrong, isPending, isError, mutate, ctx]);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !s) return <ErrorBox>
    <p>Could not load your session. {errorText(error)}</p>
    <Button variant="secondary" onClick={() => refetch()}>Try again</Button>
  </ErrorBox>;
  const role = ctx === "customer" ? "owner" : "merchant";
  if (wrong)
    return (
      <div data-testid="wrong-context" className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-300">
        {isError ? (
          <>
            <ErrorBox>Could not open the {role} view. {errorText(sw.error)}</ErrorBox>
            <div className="mt-3"><Button variant="secondary" onClick={() => mutate(ctx)}>Try again</Button></div>
          </>
        ) : (
          <p role="status" className="flex items-center gap-2"><Loader2 size={15} className="animate-spin text-zinc-500" aria-hidden /> Opening the {role} view…</p>
        )}
      </div>
    );
  return <>{children}</>;
}
