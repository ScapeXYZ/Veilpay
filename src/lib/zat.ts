/**
 * Zatoshi helpers. Money stays an integer string end to end; arithmetic is BigInt only.
 * Never parseFloat / Number() a zatoshi value.
 */
export const ZAT_PER_ZEC = 100_000_000n;
const ZAT_RE = /^(0|[1-9][0-9]{0,15})$/;

export function isZat(value: string): boolean {
  return ZAT_RE.test(value);
}

export function toBig(zat: string): bigint {
  if (!isZat(zat)) throw new Error("invalid zatoshi string");
  return BigInt(zat);
}

export function fromBig(value: bigint): string {
  if (value < 0n) throw new Error("negative zatoshi");
  const s = value.toString();
  if (!isZat(s)) throw new Error("zatoshi out of contract range");
  return s;
}

export function addZat(...values: string[]): string {
  return fromBig(values.reduce((acc, v) => acc + toBig(v), 0n));
}

/** a - b, clamped at 0 (display only; the backend owns remainingZat). */
export function subZatFloor(a: string, b: string): string {
  const d = toBig(a) - toBig(b);
  return fromBig(d < 0n ? 0n : d);
}

export function cmpZat(a: string, b: string): -1 | 0 | 1 {
  const x = toBig(a);
  const y = toBig(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Format zatoshi as ZEC, trimming trailing zeros but keeping at least 2 decimals. */
export function formatZec(zat: string, opts: { unit?: boolean } = {}): string {
  const v = toBig(zat);
  const whole = v / ZAT_PER_ZEC;
  let frac = (v % ZAT_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${wholeStr}.${frac}${opts.unit === false ? "" : " ZEC"}`;
}

/** Parse a user-typed ZEC decimal ("0.25") into a zatoshi string. Rejects >8 decimals. */
export function parseZecInput(input: string): string | null {
  const s = input.trim();
  const m = /^(\d{1,8})(?:\.(\d{1,8}))?$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  try {
    return fromBig(whole * ZAT_PER_ZEC + frac);
  } catch {
    return null;
  }
}

/** Percentage (0-100, integer) of part over total, BigInt math, for progress bars only. */
export function pctZat(part: string, total: string): number {
  const t = toBig(total);
  if (t === 0n) return 0;
  const p = (toBig(part) * 100n) / t;
  return Number(p > 100n ? 100n : p);
}
