"use client";

import { AlertTriangle, ArrowRight, Ban, CalendarClock, Eye, PlayCircle, ReceiptText, RotateCcw, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PaymentBadge } from "@/components/payment";
import { PageHeader, RequireContext } from "@/components/shell";
import { SourceTag } from "@/components/source";
import { Badge, Card, ErrorBox, Meter, Skeleton, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useAgent, useHealth, usePayments, useSession } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { fmtTime, lastUpdated, unresolvedOf } from "@/lib/present";
import { pctZat } from "@/lib/zat";

function Metric({ label, children, hint, testId, icon }: { label: string; children: ReactNode; hint?: ReactNode; testId?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">{icon}{label}</div>
      <div className="text-xl text-zinc-50">{children}</div>
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function PrimaryAction() {
  const m = useNetworkMode();
  const cls = "inline-flex items-center gap-2 rounded-lg bg-accent-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-accent-300";
  if (m.kind === "mock")
    return <Link href="/demo" className={cls} data-testid="primary-action"><PlayCircle size={15} aria-hidden /> Run guided demo</Link>;
  if (m.kind === "mainnet_readonly")
    return <Link href="/app/activity" className={cls} data-testid="primary-action"><Eye size={15} aria-hidden /> View observations</Link>;
  if (!m.canWrite) return null;
  return <Link href="/app/payments/new" className={cls} data-testid="primary-action"><ReceiptText size={15} aria-hidden /> Review an invoice</Link>;
}

function ModeCard() {
  const m = useNetworkMode();
  const { data: h } = useHealth();
  return (
    <Card testId="mode-card" className="!p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-zinc-50">{m.label}</div>
          <p className="mt-0.5 text-sm text-zinc-400">{m.detail}</p>
        </div>
        <PrimaryAction />
      </div>
      {h && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-zinc-800 pt-3 text-xs sm:grid-cols-4" data-testid="freshness">
          <div><dt className="text-zinc-500">Wallet-reported height</dt><dd className="font-mono text-zinc-200">{h.chainHeight != null ? h.chainHeight.toLocaleString("en-US") : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">Independent chain tip</dt><dd className="text-zinc-200">{h.chainWatcher.supported === false ? "Not available" : h.chainWatcher.lastBlockAt ? `block seen ${fmtTime(h.chainWatcher.lastBlockAt)}` : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">Reconciler</dt><dd className="text-zinc-200">{h.reconciler.lastRunAt ? fmtTime(h.reconciler.lastRunAt) : "Not run yet"}</dd></div>
          <div><dt className="text-zinc-500">Confirmations required</dt><dd className="font-mono text-zinc-200">{h.confirmationsRequired}</dd></div>
        </dl>
      )}
      <p className="mt-3 text-[11px] text-zinc-500">Heights are what the wallet reports. A single height is not shown as &ldquo;fully synced&rdquo;.</p>
    </Card>
  );
}

function attentionOf(p: Payment): { icon: ReactNode; text: string } | null {
  const u = unresolvedOf(p);
  if (u) return { icon: <Wrench size={14} className="text-orange-300" aria-hidden />, text: u.title };
  if (p.timeline.some((e) => e.kind === "reorg") && p.status !== "confirmed") return { icon: <RotateCcw size={14} className="text-amber-300" aria-hidden />, text: "Moved back by a reorg" };
  if (p.status === "rejected") return { icon: <Ban size={14} className="text-rose-400" aria-hidden />, text: "Blocked by policy · no transfer" };
  return null;
}

function Dashboard() {
  const { data: s } = useSession();
  const { data: a, isLoading, error } = useAgent(s?.agentId);
  const { data: list } = usePayments();
  const { data: h } = useHealth();
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading || !a) return <Skeleton className="h-72" />;
  const u = a.usage;
  const total = a.policy.totalBudgetZat;
  const spentPct = pctZat(u.spentZat, total);
  const resPct = Math.min(100 - spentPct, pctZat(u.reservedZat, total));
  const items = list?.items ?? [];
  const attention = items.map((p) => ({ p, a: attentionOf(p) })).filter((x) => x.a).slice(0, 5);
  return (
    <>
      <ModeCard />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Observed wallet balance" icon={<Wallet size={12} aria-hidden />} testId="metric-wallet"
          hint="Not provided by the current API. The wallet is unallocated/shared, so its balance is never shown as this agent's funds.">
          <span className="text-zinc-400" data-testid="wallet-unavailable">Unavailable</span>
        </Metric>
        <Metric label="Available policy budget" testId="metric-remaining" hint={<>of <Zec zat={total} /> total budget</>}>
          <Zec zat={u.remainingZat} testId="remaining" />
        </Metric>
        <Metric label="Reserved" testId="metric-reserved" hint={`${u.pendingCount} pending request${u.pendingCount === 1 ? "" : "s"}`}>
          <Zec zat={u.reservedZat} />
        </Metric>
        <Metric label="Spent" testId="metric-spent" hint={`${u.approvedCount} approved · ${u.rejectedCount} blocked`}>
          <Zec zat={u.spentZat} />
        </Metric>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Card title="Needs attention" testId="needs-attention" action={<SourceTag />}>
            {h?.chainWatcher.deepReorgAlert && (
              <p className="mb-3 flex items-center gap-2 text-sm text-rose-200"><AlertTriangle size={14} aria-hidden /> Deep reorg alert raised. An operator is reviewing.</p>
            )}
            {attention.length === 0 && !h?.chainWatcher.deepReorgAlert ? (
              <p className="text-sm text-zinc-500">Nothing needs attention in the loaded payments.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {attention.map(({ p, a: at }) => (
                  <li key={p.id}>
                    <Link href={`/app/payments/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-zinc-50">
                      <span className="flex min-w-0 items-center gap-2">{at!.icon}<span className="truncate text-zinc-200">{p.reference}</span><span className="hidden text-xs text-zinc-500 sm:inline">{at!.text}</span></span>
                      <Zec zat={p.amountZat} className="shrink-0 text-zinc-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent payments" testId="recent-payments" action={<Link href="/app/activity" className="inline-flex items-center gap-1 text-xs text-accent-300 hover:text-accent-200">All activity <ArrowRight size={12} aria-hidden /></Link>}>
            {items.length === 0 ? <p className="text-sm text-zinc-500">No payments yet.</p> : (
              <ul className="divide-y divide-zinc-800">
                {items.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <Link href={`/app/payments/${p.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:text-zinc-50">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-zinc-100">{p.reference}</span>
                        <span className="block text-xs text-zinc-500">{p.merchantName} · {fmtTime(lastUpdated(p))}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1"><Zec zat={p.amountZat} className="text-sm" /><PaymentBadge p={p} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card testId="agent-summary" title={<span className="flex items-center gap-2">{a.name}<Badge tone={a.status === "active" ? "success" : "warning"} testId="agent-status">{a.status}</Badge></span>}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-zinc-500">Per-payment cap</dt><dd><Zec zat={a.policy.perTxLimitZat} testId="cap" /></dd></div>
            <div><dt className="text-xs text-zinc-500">Total budget</dt><dd><Zec zat={total} /></dd></div>
            <div className="col-span-2"><dt className="flex items-center gap-1 text-xs text-zinc-500"><CalendarClock size={12} aria-hidden /> Daily allowance</dt><dd className="text-zinc-400" data-testid="daily-not-configured">Not configured · API pending</dd></div>
          </dl>
          <div className="mt-4">
            <Meter total={total} parts={[{ pct: spentPct, cls: "bg-emerald-500", label: "spent" }, { pct: resPct, cls: "bg-sky-500", label: "reserved" }]} />
            <p className="mt-2 text-xs text-zinc-500">Policy v{a.policy.version}. Spent, reserved and remaining come from the backend; the browser never sums them.</p>
          </div>
          <Link href="/app/policy" className="mt-4 inline-flex items-center gap-1 text-sm text-accent-300 hover:text-accent-200">Policy controls <ArrowRight size={13} aria-hidden /></Link>
        </Card>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="What the agent may do, what it actually did, and which evidence backs it." />
      <RequireContext ctx="customer">
        <Dashboard />
      </RequireContext>
    </>
  );
}
