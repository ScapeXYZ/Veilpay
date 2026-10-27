"use client";

import type { ReactNode } from "react";
import { Badge, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import type { Agent } from "@/lib/contract/schemas";
import { fmtTime } from "@/lib/present";
import { formatZec } from "@/lib/zat";

/** Plain-language summary built only from the server's policy fields. */
export function policySentence(a: Agent): string {
  const m = a.policy.allowedMerchantIds.length;
  const where = m === 0 ? "with no merchants approved yet, so every payment is blocked" : `only at ${m === 1 ? "1 approved merchant" : `${m} approved merchants`}`;
  return `${a.name} can spend up to ${formatZec(a.policy.totalBudgetZat)} in total, no more than ${formatZec(a.policy.perTxLimitZat)} per payment, ${where}.`;
}

/**
 * The policy sheet: the one special card in Sealed Ledger. A ruled document of what the agent
 * may spend, read from the VeilPay server. Editing stays in the existing form below it.
 */
export function PolicySheet({ agent: a }: { agent: Agent }) {
  const mode = useNetworkMode();
  const practice = mode.kind === "mock";
  const rows: { k: string; v: ReactNode; testId: string }[] = [
    { k: "Total budget", v: <Zec zat={a.policy.totalBudgetZat} />, testId: "sheet-budget" },
    { k: "Max per payment", v: <Zec zat={a.policy.perTxLimitZat} />, testId: "sheet-cap" },
    { k: "Approved merchants", v: a.policy.allowedMerchantIds.length ? <span className="font-mono text-[13px] break-all">{a.policy.allowedMerchantIds.join(", ")}</span> : "None", testId: "sheet-merchants" },
    { k: "Approval time limit", v: a.policy.requestTtlSeconds ? `${a.policy.requestTtlSeconds}s` : "Server default", testId: "sheet-ttl" },
    { k: "Policy expiration", v: a.policy.expiresAt ? fmtTime(a.policy.expiresAt) : "No expiration", testId: "sheet-expiry" },
    { k: "Daily limit", v: <span className="text-zinc-400">Not available yet</span>, testId: "sheet-daily" },
  ];
  return (
    <section data-testid="policy-sheet" aria-labelledby="policy-sheet-title" className="rounded-[14px] border border-line bg-zinc-900">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 id="policy-sheet-title" className="font-display text-[1.375rem] text-zinc-50">Policy sheet</h2>
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          {practice && <Badge tone="neutral" className="!bg-transparent !text-practice !ring-practice/60" testId="sheet-practice">practice agent</Badge>}
          <span className="font-mono">v{a.policy.version}</span>
        </span>
      </header>
      <p data-testid="policy-sentence" className="px-5 pt-4 text-[15px] text-zinc-200">{policySentence(a)}</p>
      <dl className="mt-3 px-5">
        {rows.map((r) => (
          <div key={r.k} data-testid={r.testId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-line/70 py-2.5 text-sm first:border-t-0 sm:grid-cols-[200px_minmax(0,1fr)]">
            <dt className="text-zinc-400">{r.k}</dt>
            <dd className="min-w-0 text-right text-zinc-100 tabular sm:text-left">{r.v}</dd>
          </div>
        ))}
      </dl>
      <footer className="border-t border-line px-5 py-3 text-xs text-zinc-500" data-testid="sheet-footer">
        Last changed {fmtTime(a.policy.updatedAt)}. These rules come from the VeilPay server, not from this page.
      </footer>
    </section>
  );
}
