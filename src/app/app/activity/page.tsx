"use client";

import clsx from "clsx";
import { AlertTriangle, ChevronDown, RefreshCw, Wrench } from "lucide-react";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { PaymentBadge, Timeline } from "@/components/payment";
import { PageHeader, RequireContext } from "@/components/shell";
import { Button, Card, ErrorBox, Notice, Skeleton, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useHealth, usePayments } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { fmtTime, lastUpdated, unresolvedOf } from "@/lib/present";

const VIEWS: { id: string; label: string; match: (p: Payment) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "blocked", label: "Blocked by rules", match: (p) => p.status === "rejected" },
  { id: "awaiting", label: "Waiting for operator", match: (p) => unresolvedOf(p)?.kind === "awaiting-operator" },
  { id: "unknown", label: "Outcome unknown", match: (p) => { const k = unresolvedOf(p)?.kind; return k === "operator" || k === "reconciling"; } },
  { id: "confirming", label: "Being confirmed", match: (p) => (p.status === "submitted" || p.status === "confirming") && !unresolvedOf(p) },
  { id: "verified", label: "Paid", match: (p) => p.status === "confirmed" },
];

function Alerts({ items }: { items: Payment[] }) {
  const { data: h } = useHealth();
  const review = items.filter((p) => unresolvedOf(p)?.kind === "operator").length;
  if (!h?.chainWatcher.deepReorgAlert && review === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="activity-alerts">
      {h?.chainWatcher.deepReorgAlert && (
        <Notice tone="danger" title={<span className="flex items-center gap-2"><AlertTriangle size={15} aria-hidden />The network replaced more than {h.chainWatcher.watchDepth} recent blocks</span>}>
          Older payments are not re-checked automatically. An operator is reviewing, and merchant confirmations that depend on them may be withdrawn.
        </Notice>
      )}
      {review > 0 && (
        <Notice tone="review" title={<span className="flex items-center gap-2"><Wrench size={15} aria-hidden />{review} {review === 1 ? "payment requires" : "payments require"} operator review · do not resend</span>} />
      )}
    </div>
  );
}

function ActivityTable() {
  const simLabels = useNetworkMode().kind === "mock";
  const { data, isLoading, error, refetch, isFetching } = usePayments();
  const [view, setView] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const items = useMemo(() => data?.items ?? [], [data]);
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  if (isLoading) return <Skeleton className="h-80" />;
  const v = VIEWS.find((x) => x.id === view)!;
  const shown = items.filter(v.match);
  return (
    <>
      <Alerts items={items} />
      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 p-3">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Saved views">
            {VIEWS.map((x) => {
              const n = items.filter(x.match).length;
              return (
                <button key={x.id} aria-pressed={view === x.id} data-testid={`view-${x.id}`} onClick={() => { setView(x.id); setOpen(null); }}
                  className={clsx("rounded-md px-2.5 py-1 text-xs", view === x.id ? "bg-zinc-800 text-zinc-50 ring-1 ring-zinc-700" : "text-zinc-400 hover:bg-zinc-950")}>
                  {simLabels && x.label === "Paid" ? "Simulated complete" : x.label} <span className="tabular-nums text-zinc-500">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500" data-testid="loaded-results">Showing {items.length}{data?.nextCursor ? "+" : ""}</span>
            <Button variant="secondary" onClick={() => refetch()} busy={isFetching} data-testid="refresh-activity"><RefreshCw size={13} aria-hidden /> Refresh</Button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="p-5 text-sm text-zinc-500">Nothing here right now.</p>
        ) : (
          <table className="block w-full text-sm md:table" data-testid="activity-table">
            <thead className="hidden text-left text-xs uppercase tracking-wide text-zinc-500 md:table-header-group">
              <tr><th className="px-4 py-2 font-medium">Payment</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 text-right font-medium">Amount</th><th className="px-4 py-2 font-medium">Updated</th><th className="w-10" /></tr>
            </thead>
            <tbody className="block md:table-row-group">
              {shown.map((p) => (
                <Fragment key={p.id}>
                  <tr className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-zinc-800 px-4 py-3 first:border-t-0 md:table-row md:px-0 md:py-0">
                    <td className="min-w-0 md:px-4 md:py-3">
                      <Link href={`/app/payments/${p.id}`} className="block truncate text-zinc-100 hover:text-accent-200">{p.reference}</Link>
                      <span className="block text-xs text-zinc-500">{p.merchantName ?? p.merchantId}</span>
                    </td>
                    <td className="order-3 mt-1.5 md:order-none md:mt-0 md:px-4 md:py-3"><PaymentBadge p={p} /></td>
                    <td className="text-right md:px-4 md:py-3"><Zec zat={p.amountZat} /></td>
                    <td className="order-4 mt-1.5 text-right text-xs text-zinc-500 md:order-none md:mt-0 md:px-4 md:py-3 md:text-left">{fmtTime(lastUpdated(p))}</td>
                    <td className="order-5 col-span-2 md:col-span-1 md:px-2 md:py-3">
                      <button onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} aria-label={`Timeline for ${p.reference}`}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100 md:mt-0">
                        <span className="md:sr-only">Timeline</span><ChevronDown size={15} className={clsx("transition-transform", open === p.id && "rotate-180")} aria-hidden />
                      </button>
                    </td>
                  </tr>
                  {open === p.id && (
                    <tr className="block border-t border-zinc-900 bg-zinc-950/50 md:table-row">
                      <td colSpan={5} className="block px-5 py-4 md:table-cell"><Timeline p={p} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <p className="text-xs text-zinc-500">This is payment history, not a full security log. Filters apply to the payments shown. Refresh only re-reads; it never sends again.</p>
    </>
  );
}

export default function ActivityPage() {
  return (
    <>
      <PageHeader title="Activity" subtitle="Everything that happened to your agent's payments, newest first." />
      <RequireContext ctx="customer">
        <ActivityTable />
      </RequireContext>
    </>
  );
}
