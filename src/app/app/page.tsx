"use client";

import { AlertTriangle, ArrowRight, Ban, CalendarClock, Eye, PlayCircle, ReceiptText, RotateCcw, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PaymentBadge } from "@/components/payment";
import { AgentSummary } from "@/components/agent-summary";
import { PageHeader, RequireContext } from "@/components/shell";
import { SourceTag } from "@/components/source";
import { SpendingChart } from "@/components/spending-chart";
import { Badge, Card, ErrorBox, Meter, Notice, Skeleton, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useAgent, useHealth, usePayments, useSelectedAgent } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { fmtTime, lastUpdated, unresolvedOf } from "@/lib/present";
import { pctZat } from "@/lib/zat";
import { Term } from "@/components/term";
import { NoirWalletCard } from "@/components/noir-wallet-card";

function Metric({ label, children, hint, testId, icon }: { label: ReactNode; children: ReactNode; hint?: ReactNode; testId?: string; icon?: ReactNode }) {
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
    return <Link href="/demo" className={cls} data-testid="primary-action"><PlayCircle size={15} aria-hidden /> Try interactive demo</Link>;
  if (m.kind === "mainnet_readonly")
    return <Link href="/app/activity" className={cls} data-testid="primary-action"><Eye size={15} aria-hidden /> View observations</Link>;
  if (!m.canWrite) return null;
  return <Link href="/app/payments/new" className={cls} data-testid="primary-action"><ReceiptText size={15} aria-hidden /> New payment request</Link>;
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
          <div><dt className="text-zinc-500">Latest block (wallet)</dt><dd className="font-mono text-zinc-200">{h.chainHeight != null ? h.chainHeight.toLocaleString("en-US") : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">Independent block check</dt><dd className="text-zinc-200">{h.chainWatcher.supported === false ? "Not available" : h.chainWatcher.lastBlockAt ? `last block ${fmtTime(h.chainWatcher.lastBlockAt)}` : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500"><Term k="safetyCheck">Last safety check</Term></dt><dd className="text-zinc-200">{h.reconciler.lastRunAt ? fmtTime(h.reconciler.lastRunAt) : "Not run yet"}</dd></div>
          <div><dt className="text-zinc-500"><Term k="confirmations">Confirmations needed</Term></dt><dd className="tabular-nums text-zinc-200">{h.confirmationsRequired}</dd></div>
        </dl>
      )}
      <p className="mt-3 text-[11px] text-zinc-500">Block numbers are what the wallet reports. One number alone does not mean the wallet is fully up to date.</p>
    </Card>
  );
}

function attentionOf(p: Payment): { icon: ReactNode; text: string } | null {
  const u = unresolvedOf(p);
  if (u) return { icon: <Wrench size={14} className="text-orange-300" aria-hidden />, text: u.title };
  if (p.timeline.some((e) => e.kind === "reorg") && p.status !== "confirmed") return { icon: <RotateCcw size={14} className="text-amber-300" aria-hidden />, text: "Moved back by the network" };
  if (p.status === "rejected") return { icon: <Ban size={14} className="text-rose-400" aria-hidden />, text: "Blocked by a spending rule · no money moved" };
  return null;
}

function Dashboard() {
  const { agentId } = useSelectedAgent();
  const { data: a, isLoading, error } = useAgent(agentId);
  const { data: list } = usePayments();
  const { data: h } = useHealth();
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  // A live demo session deliberately starts without an agent. Reuse the existing,
  // backend-authoritative setup flow rather than leaving the overview in a skeleton.
  if (!agentId) return <><NoirWalletCard /><AgentSummary /></>;
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

      <NoirWalletCard />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Wallet balance" icon={<Wallet size={12} aria-hidden />} testId="metric-wallet"
          hint="Not shown. The wallet is shared, so its balance is not this agent's money.">
          <span className="text-zinc-400" data-testid="wallet-unavailable">Unavailable</span>
        </Metric>
        <Metric label="Left to spend" testId="metric-remaining" hint={<>of a <Zec zat={total} /> total budget</>}>
          <Zec zat={u.remainingZat} testId="remaining" />
        </Metric>
        <Metric label={<Term k="reserved">Set aside</Term>} testId="metric-reserved" hint={`${u.pendingCount} approved, not sent yet`}>
          <Zec zat={u.reservedZat} />
        </Metric>
        <Metric label="Spent" testId="metric-spent" hint={`${u.approvedCount} approved · ${u.rejectedCount} blocked by rules`}>
          <Zec zat={u.spentZat} />
        </Metric>
      </div>

      <SpendingChart agentId={agentId} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Card title="Needs attention" testId="needs-attention" action={<SourceTag />}>
            {h?.chainWatcher.deepReorgAlert && (
              <p className="mb-3 flex items-center gap-2 text-sm text-rose-200"><AlertTriangle size={14} aria-hidden /> The network replaced many recent blocks. An operator is reviewing.</p>
            )}
            {attention.length === 0 && !h?.chainWatcher.deepReorgAlert ? (
              <p className="text-sm text-zinc-500">All clear. Nothing needs your attention.</p>
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
            <div><dt className="text-xs text-zinc-500">Max per payment</dt><dd><Zec zat={a.policy.perTxLimitZat} testId="cap" /></dd></div>
            <div><dt className="text-xs text-zinc-500">Total budget</dt><dd><Zec zat={total} /></dd></div>
            <div className="col-span-2"><dt className="flex items-center gap-1 text-xs text-zinc-500"><CalendarClock size={12} aria-hidden /> Daily limit</dt><dd className="text-zinc-400" data-testid="daily-not-configured">Not available yet</dd></div>
          </dl>
          <div className="mt-4">
            <Meter total={total} parts={[{ pct: spentPct, cls: "bg-emerald-500", label: "spent" }, { pct: resPct, cls: "bg-sky-500", label: "reserved" }]} />
            <p className="mt-2 text-xs text-zinc-500">Rules version {a.policy.version}. These totals come from the VeilPay server, not from this page.</p>
          </div>
          <Link href="/app/spending-rules" className="mt-4 inline-flex items-center gap-1 text-sm text-accent-300 hover:text-accent-200">Spending rules <ArrowRight size={13} aria-hidden /></Link>
        </Card>
      </div>
    </>
  );
}

/**
 * Mainnet deliberately has no demo session: the wallet extension can be used
 * read-only without creating a mock customer/merchant session. Keep this
 * surface independent from the demo dashboard and its simulated data.
 */
function MainnetReadOnlyWallet() {
  return (
    <>
      <ModeCard />
      <NoirWalletCard />
      <Notice tone="neutral" title="VeilPay server observer unavailable">
        Wallet balances, local activity, and transaction statuses above come directly from Noir Wallet. VeilPay has no mainnet observer here, so it cannot report agent spending, payment confirmation, or independently verified settlement. Those are separate records, not substitutes for wallet activity.
      </Notice>
    </>
  );
}

function Overview() {
  const mode = useNetworkMode();
  if (mode.kind === "mainnet_readonly") return <MainnetReadOnlyWallet />;
  return <RequireContext ctx="customer"><Dashboard /></RequireContext>;
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="Wallet-reported mainnet balances and activity, kept separate from VeilPay agent spending and settlement evidence." />
      <Overview />
    </>
  );
}
