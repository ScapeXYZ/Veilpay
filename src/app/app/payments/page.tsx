"use client";

import clsx from "clsx";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PaymentDetail, PaymentRow } from "@/components/payment";
import { PageHeader, RequireContext } from "@/components/shell";
import { Card, ErrorBox, Skeleton } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, usePayment, usePayments } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { unresolvedOf } from "@/lib/present";

const FILTERS: { id: string; label: string; match: (p: Payment) => boolean }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "attention", label: "Needs attention", match: (p) => !!unresolvedOf(p) },
  { id: "inflight", label: "In flight", match: (p) => ["authorized", "submitted", "confirming"].includes(p.status) && !unresolvedOf(p) },
  { id: "paid", label: "Paid", match: (p) => p.status === "confirmed" },
  { id: "blocked", label: "Blocked", match: (p) => p.status === "rejected" },
  { id: "failed", label: "Failed / expired", match: (p) => p.status === "failed" || p.status === "expired" },
];

function Payments() {
  const simLabels = useNetworkMode().kind === "mock";
  const { data, isLoading, error } = usePayments();
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const items = useMemo(() => data?.items ?? [], [data]);
  const f = FILTERS.find((x) => x.id === filter)!;
  const shown = items.filter(f.match);
  const selId = selected ?? shown[0]?.id ?? null;
  const { data: detail, isLoading: detailLoading, error: detailError } = usePayment(selId);
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="!p-3">
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Filter payments">
          {FILTERS.map((x) => {
            const n = items.filter(x.match).length;
            return (
              <button
                key={x.id}
                aria-pressed={filter === x.id}
                data-testid={`filter-${x.id}`}
                onClick={() => {
                  setFilter(x.id);
                  setSelected(null);
                }}
                className={clsx(
                  "rounded-md px-2 py-1 text-xs",
                  filter === x.id ? "bg-zinc-700 text-zinc-50" : "text-zinc-400 hover:bg-zinc-800",
                  x.id === "attention" && n > 0 && filter !== x.id && "text-orange-300",
                )}
              >
                {simLabels && x.label === "Paid" ? "Simulated complete" : x.label} <span className="text-zinc-500">{n}</span>
              </button>
            );
          })}
        </div>
        {isLoading ? (
          <Skeleton className="h-64" />
        ) : shown.length === 0 ? (
          <p className="p-3 text-sm text-zinc-500">No payments match this filter.</p>
        ) : (
          <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
            {shown.map((p) => (
              <PaymentRow key={p.id} p={p} active={p.id === selId} onClick={() => setSelected(p.id)} />
            ))}
          </div>
        )}
      </Card>
      <Card>
        {detailError ? <ErrorBox>{errorText(detailError)}</ErrorBox> : detailLoading ? <Skeleton className="h-64" /> : detail ? (
          <>
            <PaymentDetail p={detail} />
            <Link href={`/app/payments/${detail.id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-accent-300 hover:text-accent-200">Open payment page <ArrowRight size={13} aria-hidden /></Link>
          </>
        ) : <p className="text-sm text-zinc-500">Select a payment.</p>}
      </Card>
    </div>
  );
}

function NewButton() {
  const mode = useNetworkMode();
  if (!mode.canWrite) return null;
  return (
    <Link href="/app/payments/new" data-testid="new-payment" className="inline-flex items-center gap-1.5 rounded-lg bg-accent-400 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-accent-300">
      <Plus size={14} aria-hidden /> New request
    </Link>
  );
}

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments" subtitle="Every payment your agent asked for, and where it stands. A payment with an unknown outcome is never resent." right={<NewButton />} />
      <RequireContext ctx="customer">
        <Payments />
      </RequireContext>
    </>
  );
}
