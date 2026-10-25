import type { NoirTransaction } from "./noir-wallet";
import { addZat, parseZecInput } from "./zat";

export type WalletActivityRange = 7 | 30;
export type WalletDirection = "incoming" | "outgoing" | null;

export type WalletActivityDay = {
  key: string;
  label: string;
  longLabel: string;
  incomingZat: string;
  outgoingZat: string;
  count: number;
};

export type WalletActivitySeries = {
  days: WalletActivityDay[];
  incomingZat: string;
  outgoingZat: string;
  count: number;
  maxDayZat: string;
};

/** Only send/receive have a direction guaranteed by Noir Wallet's history API. */
export function walletDirection(type: string): WalletDirection {
  const normalized = type.trim().toLowerCase();
  if (normalized === "receive") return "incoming";
  if (normalized === "send") return "outgoing";
  return null;
}

/**
 * Convert an SDK decimal only when it is an exact non-negative ZEC amount.
 * History can include other activity kinds, so a missing result means “do not
 * derive a monetary total from this entry”, never zero.
 */
export function walletAmountZat(amount: string): string | null {
  return parseZecInput(amount);
}

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayLabels(date: Date) {
  return {
    label: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    longLabel: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date),
  };
}

/**
 * Bucket only timestamped, directionally-classified wallet history. The range
 * is a local-calendar window ending today, matching the dates users see in
 * their wallet. No entry is synthesized for an empty day.
 */
export function aggregateWalletActivity(entries: NoirTransaction[], range: WalletActivityRange, now = new Date()): WalletActivitySeries {
  const today = dayStart(now);
  const first = new Date(today);
  first.setDate(first.getDate() - (range - 1));
  const days = Array.from({ length: range }, (_, index) => {
    const date = new Date(first);
    date.setDate(date.getDate() + index);
    const labels = dayLabels(date);
    return { key: dayKey(date), ...labels, incomingZat: "0", outgoingZat: "0", count: 0 };
  });
  const byKey = new Map(days.map((day) => [day.key, day]));

  for (const entry of entries) {
    const direction = walletDirection(entry.type);
    const zat = walletAmountZat(entry.amount);
    const timestamp = new Date(entry.timestamp);
    if (!direction || !zat || Number.isNaN(timestamp.getTime())) continue;
    const bucket = byKey.get(dayKey(timestamp));
    if (!bucket) continue;
    if (direction === "incoming") bucket.incomingZat = addZat(bucket.incomingZat, zat);
    else bucket.outgoingZat = addZat(bucket.outgoingZat, zat);
    bucket.count += 1;
  }

  const incomingZat = addZat(...days.map((day) => day.incomingZat));
  const outgoingZat = addZat(...days.map((day) => day.outgoingZat));
  const maxDayZat = days.reduce((max, day) => {
    const total = addZat(day.incomingZat, day.outgoingZat);
    return BigInt(total) > BigInt(max) ? total : max;
  }, "0");
  return { days, incomingZat, outgoingZat, count: days.reduce((sum, day) => sum + day.count, 0), maxDayZat };
}
