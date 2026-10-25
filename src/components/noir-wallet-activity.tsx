"use client";

import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import type { NoirTransaction } from "@/lib/noir-wallet";
import { aggregateWalletActivity, walletAmountZat, type WalletActivityRange } from "@/lib/noir-wallet-activity";
import { formatZec } from "@/lib/zat";
import { Badge, Card, Zec } from "./ui";

function activityLabel(type: string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityTime(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

function activityAmount(amount: string) {
  const zat = walletAmountZat(amount);
  return zat ? formatZec(zat) : "Amount unavailable";
}

function barPct(value: string, max: string) {
  if (max === "0") return 0;
  return Number((BigInt(value) * 100n) / BigInt(max));
}

/** Wallet-local history only; it is deliberately not merged with VeilPay records. */
export function NoirWalletActivity({ entries }: { entries: NoirTransaction[] }) {
  const [range, setRange] = useState<WalletActivityRange>(7);
  const series = useMemo(() => aggregateWalletActivity(entries, range), [entries, range]);
  const recent = useMemo(
    () => [...entries].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10),
    [entries],
  );
  const hasDerivableTotals = series.count > 0;

  return (
    <div className="space-y-5" data-testid="noir-wallet-analytics">
      <Card
        testId="noir-wallet-chart"
        title={<span className="flex items-center gap-2"><BarChart3 size={14} className="text-accent-300" aria-hidden /> Wallet activity</span>}
        action={<div role="group" aria-label="Wallet activity time range" className="inline-flex rounded-lg border border-zinc-800 p-0.5 text-xs">
          {([7, 30] as const).map((value) => <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)} data-testid={`noir-wallet-range-${value}`}
            className={clsx("rounded-md px-2.5 py-1 font-medium", range === value ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200")}>{value} days</button>)}
        </div>}
      >
        {!hasDerivableTotals ? (
          <p className="py-8 text-center text-sm text-zinc-500" data-testid="noir-wallet-chart-empty">No transactions reported in the last {range} days.</p>
        ) : (
          <>
            <dl className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div><dt className="flex items-center gap-1 text-xs text-zinc-500"><ArrowDownLeft size={12} aria-hidden /> Incoming</dt><dd><Zec zat={series.incomingZat} className="text-emerald-300" /> <span className="text-xs text-zinc-500">derived from wallet receive entries</span></dd></div>
              <div><dt className="flex items-center gap-1 text-xs text-zinc-500"><ArrowUpRight size={12} aria-hidden /> Outgoing</dt><dd><Zec zat={series.outgoingZat} className="text-rose-300" /> <span className="text-xs text-zinc-500">derived from wallet send entries</span></dd></div>
            </dl>
            <div role="img" aria-label={`${series.count} wallet transactions with directionally-classified amounts in the last ${range} days.`}
              className={clsx("grid h-40 items-end border-b border-zinc-800", range === 7 ? "gap-2 sm:gap-3" : "gap-px sm:gap-1")}
              style={{ gridTemplateColumns: `repeat(${series.days.length}, minmax(0, 1fr))` }} data-testid="noir-wallet-bars">
              {series.days.map((day) => {
                const total = (BigInt(day.incomingZat) + BigInt(day.outgoingZat)).toString();
                const incoming = barPct(day.incomingZat, series.maxDayZat);
                const outgoing = barPct(day.outgoingZat, series.maxDayZat);
                return <div key={day.key} className="flex h-full items-end" title={`${day.longLabel}: ${formatZec(day.incomingZat)} incoming, ${formatZec(day.outgoingZat)} outgoing`}>
                  {total === "0" ? <div className="h-[2px] w-full rounded-t-sm bg-zinc-800" /> : <div className="flex w-full flex-col overflow-hidden rounded-t-sm" style={{ height: `${Math.max(3, incoming + outgoing)}%` }}>
                    {incoming > 0 && <div className="bg-emerald-500" style={{ height: `${(incoming / (incoming + outgoing)) * 100}%` }} />}
                    {outgoing > 0 && <div className="bg-rose-400" style={{ height: `${(outgoing / (incoming + outgoing)) * 100}%` }} />}
                  </div>}
                </div>;
              })}
            </div>
            <div aria-hidden className={clsx("mt-1.5 grid text-center", range === 7 ? "gap-2 sm:gap-3" : "gap-px sm:gap-1")} style={{ gridTemplateColumns: `repeat(${series.days.length}, minmax(0, 1fr))` }}>
              {series.days.map((day, index) => <span key={day.key} className="text-[10px] text-zinc-500">{range === 7 || index % 5 === 0 ? day.label : ""}</span>)}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500" />Incoming receive entries</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-400" />Outgoing send entries</span></p>
          </>
        )}
        <p className="mt-3 text-[11px] text-zinc-500">Source: Noir Wallet&apos;s local transaction history and timestamps. Totals exclude activity whose direction or exact amount cannot be reliably derived. This is neither VeilPay agent spending nor independently verified settlement.</p>
      </Card>

      <Card title="Recent wallet transactions" testId="noir-wallet-recent">
        {recent.length === 0 ? <p className="text-sm text-zinc-500">No transactions reported.</p> : <ul className="divide-y divide-zinc-800" data-testid="noir-activity-list">
          {recent.map((transaction) => <li key={`${transaction.txid}-${transaction.timestamp}`} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"><span className="text-zinc-100">{activityLabel(transaction.type)}</span><span className="tabular-nums text-zinc-200">{activityAmount(transaction.amount)}</span></div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500"><Badge tone="neutral">{transaction.status}</Badge><span>{activityTime(transaction.timestamp)}</span><span className="break-all font-mono">{transaction.txid}</span></div>
          </li>)}
        </ul>}
        <p className="mt-3 text-xs text-zinc-500">Wallet-reported status is shown as reported. Memos are never displayed. A wallet record is not a VeilPay payment confirmation.</p>
      </Card>
    </div>
  );
}
