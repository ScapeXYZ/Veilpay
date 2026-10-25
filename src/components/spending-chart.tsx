"use client";

import clsx from "clsx";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, ErrorBox, Skeleton, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, usePayments } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { aggregateSpending, barPct, type SpendingRange } from "@/lib/spending";
import { formatZec } from "@/lib/zat";

export interface SpendingChartViewProps {
  payments: Payment[] | undefined;
  isLoading: boolean;
  error: unknown;
  /** True in mock / regtest-mock mode, or when any payment carries a practice reference. */
  simulated: boolean;
  /** More history exists on the server than this page loaded. */
  truncated?: boolean;
  agentId?: string | null;
  now?: Date;
  timeZone?: string;
  onRetry?: () => void;
}

/**
 * "Agent spending activity": completed payments per day from the server's payment history.
 * Blocked attempts are a separate row and are never part of the spent total.
 * Hand-rolled bars (no chart dependency); a hidden table carries the same numbers for screen readers.
 */
export function SpendingChartView({ payments, isLoading, error, simulated, truncated, agentId, now, timeZone, onRetry }: SpendingChartViewProps) {
  const [range, setRange] = useState<SpendingRange>(7);
  const series = useMemo(
    () => (payments ? aggregateSpending(payments, { range, now, timeZone, agentId }) : null),
    [payments, range, now, timeZone, agentId],
  );
  const word = simulated ? "simulated" : "completed";
  const title = (
    <span className="flex flex-wrap items-center gap-2">
      <BarChart3 size={14} aria-hidden className="text-accent-300" />Agent spending activity
      {simulated && <Badge tone="warning" testId="spending-sim-label">Simulated · practice data</Badge>}
    </span>
  );
  const toggle = (
    <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-zinc-800 p-0.5 text-xs" data-testid="spending-range">
      {([7, 30] as const).map((r) => (
        <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} data-testid={`spending-range-${r}`}
          className={clsx("rounded-md px-2.5 py-1 font-medium", range === r ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-200")}>
          {r} days
        </button>
      ))}
    </div>
  );

  let body;
  if (error) {
    body = (
      <div data-testid="spending-error" className="flex flex-col gap-2">
        <ErrorBox>Payment history could not be loaded, so no chart is shown. {errorText(error)}</ErrorBox>
        {onRetry && <button type="button" onClick={onRetry} className="self-start text-xs text-accent-300 hover:text-accent-200">Try again</button>}
      </div>
    );
  } else if (isLoading || !series) {
    body = <div data-testid="spending-loading"><Skeleton className="h-44" /></div>;
  } else if (series.completedCount === 0 && series.blockedCount === 0) {
    body = (
      <p className="py-8 text-center text-sm text-zinc-500" data-testid="spending-empty">
        No {word} payments or blocked attempts in the last {range} days.
        {series.inFlightCount > 0 && ` ${series.inFlightCount} still in progress, not counted yet.`}
      </p>
    );
  } else {
    const summary = `${series.completedCount} ${word} payment${series.completedCount === 1 ? "" : "s"} totalling ${formatZec(series.spentZat)} in the last ${range} days. ${series.blockedCount} blocked attempt${series.blockedCount === 1 ? "" : "s"}, not counted as spent.`;
    const showLabel = (i: number) => range === 7 || i % 5 === (series.days.length - 1) % 5;
    body = (
      <div data-testid="spending-chart">
        <dl className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-zinc-500">{simulated ? "Simulated spend" : "Spent"}</dt><dd><Zec zat={series.spentZat} testId="spending-total" className="text-zinc-50" /> <span className="text-xs text-zinc-500">· {series.completedCount} {word}</span></dd></div>
          <div><dt className="text-xs text-zinc-500">Blocked attempts</dt><dd data-testid="spending-blocked" className="text-rose-300">{series.blockedCount} <span className="text-xs text-zinc-500">· not spent, no money moved</span></dd></div>
          <div><dt className="text-xs text-zinc-500">In progress</dt><dd data-testid="spending-inflight" className="text-zinc-300">{series.inFlightCount} <span className="text-xs text-zinc-500">· not counted yet</span></dd></div>
        </dl>
        <div role="img" aria-label={summary} data-testid="spending-bars"
          className={clsx("grid h-40 items-end border-b border-zinc-800", range === 7 ? "gap-2 sm:gap-3" : "gap-px sm:gap-1")}
          style={{ gridTemplateColumns: `repeat(${series.days.length}, minmax(0, 1fr))` }}>
          {series.days.map((d) => (
            <div key={d.key} className="flex h-full items-end" title={`${d.longLabel}: ${formatZec(d.spentZat)} ${word}${d.blockedCount ? `, ${d.blockedCount} blocked` : ""}`}>
              <div data-testid={`spending-bar-${d.key}`} data-zat={d.spentZat}
                className={clsx("w-full rounded-t-sm", d.spentZat === "0" ? "bg-zinc-800" : "bg-accent-400")}
                style={{ height: d.spentZat === "0" ? "2px" : `${barPct(d.spentZat, series.maxDayZat)}%` }} />
            </div>
          ))}
        </div>
        <div aria-hidden className={clsx("mt-1.5 grid text-center", range === 7 ? "gap-2 sm:gap-3" : "gap-px sm:gap-1")}
          style={{ gridTemplateColumns: `repeat(${series.days.length}, minmax(0, 1fr))` }}>
          {series.days.map((d, i) => (
            <div key={d.key} className="flex flex-col items-center gap-1">
              <span className="h-3.5 text-[10px] font-medium text-rose-300" data-testid={`spending-blocked-${d.key}`}>{d.blockedCount ? `${d.blockedCount}✕` : ""}</span>
              <span className="whitespace-nowrap text-[10px] text-zinc-500">{showLabel(i) ? d.label : ""}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-accent-400" aria-hidden />{simulated ? "Simulated completed payments (ZEC)" : "Completed payments (ZEC)"}</span>
          <span className="flex items-center gap-1.5"><span className="font-medium text-rose-300" aria-hidden>✕</span>Blocked by a spending rule, excluded from totals</span>
        </p>
        <table className="sr-only" data-testid="spending-table">
          <caption>{summary}</caption>
          <thead><tr><th scope="col">Day</th><th scope="col">{simulated ? "Simulated spend" : "Spent"}</th><th scope="col">{word} payments</th><th scope="col">Blocked attempts</th></tr></thead>
          <tbody>
            {series.days.map((d) => (
              <tr key={d.key}><th scope="row">{d.longLabel}</th><td>{formatZec(d.spentZat)}</td><td>{d.completedCount}</td><td>{d.blockedCount}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card title={title} action={toggle} testId="spending-activity">
      {body}
      <p className="mt-3 text-[11px] text-zinc-500" data-testid="spending-footnote">
        {simulated
          ? "From the payment history the VeilPay server returned. Simulated payments: practice data only, no funds moved and no chain settlement."
          : "From the payment history the VeilPay server returned. Not a wallet balance."}
        {truncated && " Only the most recent payments the server returned are included."}
      </p>
    </Card>
  );
}

/** Overview card wired to the existing payments query (no new endpoint). */
export function SpendingChart({ agentId }: { agentId?: string | null }) {
  const { data, isLoading, error, refetch } = usePayments();
  const m = useNetworkMode();
  const items = data?.items;
  const simulated = m.kind === "mock" || !!items?.some((p) => p.mockRef);
  return (
    <SpendingChartView payments={items} isLoading={isLoading} error={error} simulated={simulated}
      truncated={!!data?.nextCursor} agentId={agentId} onRetry={() => void refetch()} />
  );
}
