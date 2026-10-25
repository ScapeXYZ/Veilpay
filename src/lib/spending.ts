/**
 * Agent spending activity: pure aggregation over the payment history the VeilPay server returned.
 * Nothing here invents data. A day with no payments is a zero, never an estimate.
 *
 * - "Completed" = status `confirmed` with no unresolved wallet state. Dated by its latest
 *   `confirmed` timeline event (falls back to createdAt).
 * - "Blocked" = status `rejected` (a spending rule refused it). Counted separately and NEVER added
 *   to the spent total: no money moved and nothing was set aside.
 * - Everything still in flight (requested/authorized/submitted/confirming) is counted as
 *   "not counted yet"; failed/expired are left out entirely.
 * Money stays BigInt zatoshi end to end.
 */
import type { Payment } from "@/lib/contract/schemas";
import { unresolvedOf } from "@/lib/present";
import { fromBig, toBig } from "@/lib/zat";

export type SpendingRange = 7 | 30;

export interface SpendingDay {
  /** Calendar date in the display time zone, YYYY-MM-DD. */
  key: string;
  /** Short axis label: "Mon 19" (7 days) or "Oct 19" (30 days). */
  label: string;
  /** Long label for screen readers and tooltips: "Monday, October 19". */
  longLabel: string;
  spentZat: string;
  completedCount: number;
  blockedCount: number;
  blockedZat: string;
}

export interface SpendingSeries {
  range: SpendingRange;
  days: SpendingDay[];
  spentZat: string;
  completedCount: number;
  blockedCount: number;
  /** Amount that blocked attempts asked for. Shown for context only, never spent. */
  blockedZat: string;
  /** Payments in the window that are not finished yet. Not in any total. */
  inFlightCount: number;
  /** Largest single-day spend, for bar scaling. */
  maxDayZat: string;
}

const IN_FLIGHT = new Set<Payment["status"]>(["requested", "authorized", "submitted", "confirming"]);

/** YYYY-MM-DD of an instant in a time zone (undefined = the browser's zone). */
export function dayKey(iso: string | Date, timeZone?: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Step a calendar key by whole days (UTC calendar math, so DST never skips or doubles a day). */
function shiftKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

function labelsOf(key: string, range: SpendingRange): { label: string; longLabel: string } {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(date);
  const label = range === 7 ? `${fmt({ weekday: "short" })} ${d}` : fmt({ month: "short", day: "numeric" });
  return { label, longLabel: fmt({ weekday: "long", month: "long", day: "numeric" }) };
}

/** When a completed payment completed: its latest `confirmed` event, else when it was created. */
export function completedAt(p: Payment): string {
  const confirmed = p.timeline.filter((e) => e.status === "confirmed").map((e) => e.at);
  return confirmed.length ? confirmed.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a)) : p.createdAt;
}

export function isCompleted(p: Payment): boolean {
  return p.status === "confirmed" && !unresolvedOf(p);
}

export function isBlocked(p: Payment): boolean {
  return p.status === "rejected";
}

export function aggregateSpending(
  payments: Payment[],
  opts: { range: SpendingRange; now?: Date; timeZone?: string; agentId?: string | null },
): SpendingSeries {
  const { range, timeZone } = opts;
  const today = dayKey(opts.now ?? new Date(), timeZone);
  const keys = Array.from({ length: range }, (_, i) => shiftKey(today, i - (range - 1)));
  const acc = new Map(keys.map((k) => [k, { spent: 0n, completed: 0, blocked: 0, blockedAmt: 0n }]));
  let inFlight = 0;

  for (const p of payments) {
    if (opts.agentId && p.agentId !== opts.agentId) continue;
    if (isCompleted(p)) {
      const b = acc.get(dayKey(completedAt(p), timeZone));
      if (b) { b.spent += toBig(p.amountZat); b.completed += 1; }
    } else if (isBlocked(p)) {
      const b = acc.get(dayKey(p.createdAt, timeZone));
      if (b) { b.blocked += 1; b.blockedAmt += toBig(p.amountZat); }
    } else if (IN_FLIGHT.has(p.status) && acc.has(dayKey(p.createdAt, timeZone))) {
      inFlight += 1;
    }
  }

  let spent = 0n, blockedAmt = 0n, max = 0n, completed = 0, blocked = 0;
  const days: SpendingDay[] = keys.map((key) => {
    const b = acc.get(key)!;
    spent += b.spent; blockedAmt += b.blockedAmt; completed += b.completed; blocked += b.blocked;
    if (b.spent > max) max = b.spent;
    return { key, ...labelsOf(key, range), spentZat: fromBig(b.spent), completedCount: b.completed, blockedCount: b.blocked, blockedZat: fromBig(b.blockedAmt) };
  });
  return { range, days, spentZat: fromBig(spent), completedCount: completed, blockedCount: blocked, blockedZat: fromBig(blockedAmt), inFlightCount: inFlight, maxDayZat: fromBig(max) };
}

/** Bar height, 0-100 with one decimal, BigInt math. A non-zero day always gets a visible sliver. */
export function barPct(dayZat: string, maxZat: string): number {
  const max = toBig(maxZat);
  const v = toBig(dayZat);
  if (max === 0n || v === 0n) return 0;
  return Math.max(2, Number((v * 1000n) / max) / 10);
}
