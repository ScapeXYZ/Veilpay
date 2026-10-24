/**
 * Zcash testnet address + ZIP-321 request validation for the invoice QR.
 *
 * Everything here fails closed: an address or request is accepted only after full
 * decoding (checksum, HRP, padding, lengths), never on a prefix match. This is
 * encoding validation, not proof that anyone controls the receiving key.
 *
 * - Sapling (ZIP-173): Bech32, HRP `ztestsapling`, 43-byte payload.
 * - Unified (ZIP-316): Bech32m, HRP `utest`, F4Jumble inverse (BLAKE2b), 16-byte HRP
 *   padding, ascending typecode items. The backend issues Orchard-only `utest1` invoices,
 *   so an Orchard receiver (typecode 0x03, 43 bytes) is required.
 */
const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) checksum ^= GENERATORS[i];
  }
  return checksum >>> 0;
}

/** Bech32/Bech32m decode to bytes. Returns null on any malformation, wrong HRP or wrong variant. */
function bech32Decode(address: string, hrp: string, variant: number, maxLength: number): Uint8Array | null {
  if (address !== address.toLowerCase() || address.length > maxLength) return null;
  const separator = address.lastIndexOf("1");
  if (separator < 1 || address.slice(0, separator) !== hrp) return null;
  const words = [...address.slice(separator + 1)].map((char) => ALPHABET.indexOf(char));
  if (words.length < 6 || words.some((word) => word < 0)) return null;
  const values = [...hrp].map((c) => c.charCodeAt(0) >> 5).concat([0], [...hrp].map((c) => c.charCodeAt(0) & 31), words);
  if (polymod(values) !== variant) return null;
  const out: number[] = [];
  let accumulator = 0, bits = 0;
  for (const word of words.slice(0, -6)) {
    accumulator = ((accumulator << 5) | word) & 0xfff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 255);
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 255) !== 0) return null;
  return Uint8Array.from(out);
}

export function isSaplingTestnetAddress(address: string): boolean {
  if (address.length !== 88) return false;
  const bytes = bech32Decode(address, "ztestsapling", BECH32_CONST, 90);
  return bytes !== null && bytes.length === 43;
}

// ---- BLAKE2b (RFC 7693) with personalization, BigInt lanes. Inputs here are < 1 KiB. ----
const MASK = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & MASK;
function le64(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[offset + i] ?? 0);
  return v;
}

export function blake2b(input: Uint8Array, outLength: number, personal: Uint8Array): Uint8Array {
  if (outLength < 1 || outLength > 64 || personal.length !== 16) throw new Error("blake2b parameters");
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outLength);
  h[6] ^= le64(personal, 0);
  h[7] ^= le64(personal, 8);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let b = 0; b < blocks; b++) {
    const block = new Uint8Array(128);
    block.set(input.subarray(b * 128, b * 128 + 128));
    const m = Array.from({ length: 16 }, (_, i) => le64(block, i * 8));
    const last = b === blocks - 1;
    const t = BigInt(Math.min(input.length, (b + 1) * 128));
    const v = [...h, ...IV];
    v[12] ^= t & MASK;
    v[13] ^= t >> 64n;
    if (last) v[14] ^= MASK;
    const g = (a: number, bb: number, c: number, d: number, x: bigint, y: bigint) => {
      v[a] = (v[a] + v[bb] + x) & MASK;
      v[d] = rotr(v[d] ^ v[a], 32n);
      v[c] = (v[c] + v[d]) & MASK;
      v[bb] = rotr(v[bb] ^ v[c], 24n);
      v[a] = (v[a] + v[bb] + y) & MASK;
      v[d] = rotr(v[d] ^ v[a], 16n);
      v[c] = (v[c] + v[d]) & MASK;
      v[bb] = rotr(v[bb] ^ v[c], 63n);
    };
    for (let r = 0; r < 12; r++) {
      const s = SIGMA[r % 10];
      g(0, 4, 8, 12, m[s[0]], m[s[1]]);
      g(1, 5, 9, 13, m[s[2]], m[s[3]]);
      g(2, 6, 10, 14, m[s[4]], m[s[5]]);
      g(3, 7, 11, 15, m[s[6]], m[s[7]]);
      g(0, 5, 10, 15, m[s[8]], m[s[9]]);
      g(1, 6, 11, 12, m[s[10]], m[s[11]]);
      g(2, 7, 8, 13, m[s[12]], m[s[13]]);
      g(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
  }
  const out = new Uint8Array(outLength);
  for (let i = 0; i < outLength; i++) out[i] = Number((h[i >> 3] >> BigInt(8 * (i & 7))) & 0xffn);
  return out;
}

// ---- F4Jumble (ZIP-316) ----
const enc = new TextEncoder();
function personal(tag: string, i: number, j = 0): Uint8Array {
  const p = new Uint8Array(16);
  p.set(enc.encode(tag));
  p[13] = i;
  p[14] = j & 0xff;
  p[15] = (j >> 8) & 0xff;
  return p;
}
const xor = (a: Uint8Array, b: Uint8Array) => a.map((x, k) => x ^ b[k]);
function hRound(i: number, u: Uint8Array, lL: number) {
  return blake2b(u, lL, personal("UA_F4Jumble_H", i));
}
function gRound(i: number, u: Uint8Array, lR: number) {
  const out = new Uint8Array(lR);
  for (let j = 0; j * 64 < lR; j++) out.set(blake2b(u, 64, personal("UA_F4Jumble_G", i, j)).subarray(0, Math.min(64, lR - j * 64)), j * 64);
  return out;
}
function split(m: Uint8Array) {
  const lL = Math.min(64, Math.floor(m.length / 2));
  return { lL, lR: m.length - lL, a: m.slice(0, lL), b: m.slice(lL) };
}
export function f4jumble(m: Uint8Array): Uint8Array {
  if (m.length < 48 || m.length > 4194368) throw new Error("f4jumble length");
  const { lL, lR, a, b } = split(m);
  const x = xor(b, gRound(0, a, lR));
  const y = xor(a, hRound(0, x, lL));
  const d = xor(x, gRound(1, y, lR));
  const c = xor(y, hRound(1, d, lL));
  return Uint8Array.from([...c, ...d]);
}
export function f4jumbleInv(m: Uint8Array): Uint8Array {
  if (m.length < 48 || m.length > 4194368) throw new Error("f4jumble length");
  const { lL, lR, a: c, b: d } = split(m);
  const y = xor(c, hRound(1, d, lL));
  const x = xor(d, gRound(1, y, lR));
  const a = xor(y, hRound(0, x, lL));
  const b = xor(x, gRound(0, a, lR));
  return Uint8Array.from([...a, ...b]);
}

function compactSize(bytes: Uint8Array, at: number): [number, number] | null {
  const first = bytes[at];
  if (first === undefined) return null;
  if (first < 0xfd) return [first, at + 1];
  if (first === 0xfd && at + 3 <= bytes.length) {
    const v = bytes[at + 1] | (bytes[at + 2] << 8);
    return v >= 0xfd ? [v, at + 3] : null; // non-canonical encodings rejected
  }
  return null; // larger sizes never occur in a valid address
}

export type UnifiedReceivers = { typecode: number; data: Uint8Array }[];

/** Full ZIP-316 decode for the given HRP. Null on any failure. */
export function decodeUnifiedAddress(address: string, hrp: string): UnifiedReceivers | null {
  const raw = bech32Decode(address, hrp, BECH32M_CONST, 4096);
  if (!raw || raw.length < 48) return null;
  const m = f4jumbleInv(raw);
  const padding = new Uint8Array(16);
  padding.set(enc.encode(hrp));
  const tail = m.subarray(m.length - 16);
  if (tail.some((byte, k) => byte !== padding[k])) return null;
  const body = m.subarray(0, m.length - 16);
  const items: UnifiedReceivers = [];
  let at = 0;
  while (at < body.length) {
    const tc = compactSize(body, at);
    if (!tc) return null;
    const len = compactSize(body, tc[1]);
    if (!len || len[1] + len[0] > body.length) return null;
    if (items.length && tc[0] <= items[items.length - 1].typecode) return null; // ascending, no duplicates
    items.push({ typecode: tc[0], data: body.slice(len[1], len[1] + len[0]) });
    at = len[1] + len[0];
  }
  const sizes: Record<number, number> = { 0: 20, 1: 20, 2: 43, 3: 43 };
  for (const it of items) if (sizes[it.typecode] !== undefined && it.data.length !== sizes[it.typecode]) return null;
  if (items.some((it) => it.typecode === 0) && items.some((it) => it.typecode === 1)) return null;
  if (!items.some((it) => it.typecode === 2 || it.typecode === 3)) return null; // must carry a shielded receiver
  return items;
}

/** Testnet Unified Address carrying an Orchard receiver (what the backend issues for invoices). */
export function isOrchardTestnetUnifiedAddress(address: string): boolean {
  if (!address.startsWith("utest1")) return false;
  const items = decodeUnifiedAddress(address, "utest");
  return !!items?.some((it) => it.typecode === 3);
}

export function isValidatedTestnetAddress(address: string): boolean {
  return isOrchardTestnetUnifiedAddress(address) || isSaplingTestnetAddress(address);
}

/** Exact ZEC decimal (up to 8 places) to integer zatoshis, no floating point. */
export function zecToZat(amount: string): bigint | null {
  const m = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,8}))?$/.exec(amount);
  if (!m) return null;
  return BigInt(m[1]) * 100000000n + BigInt((m[2] ?? "").padEnd(8, "0"));
}

const ALLOWED_PARAMS = new Set(["amount", "label", "message", "memo"]);

/**
 * Strict single-payment ZIP-321 parse. Rejects multi-payment (indexed) requests, unknown
 * or required (`req-`) params, duplicates, and anything without an exact amount.
 */
export function parseZip321(uri: string): { address: string; amountZat: bigint } | null {
  const m = /^zcash:([a-z0-9]+)\?(.+)$/.exec(uri);
  if (!m) return null;
  const seen = new Map<string, string>();
  for (const part of m[2].split("&")) {
    const eq = part.indexOf("=");
    if (eq < 1) return null;
    const key = part.slice(0, eq);
    if (!ALLOWED_PARAMS.has(key) || seen.has(key)) return null;
    seen.set(key, part.slice(eq + 1));
  }
  const amount = seen.get("amount");
  const amountZat = amount ? zecToZat(amount) : null;
  if (amountZat === null || amountZat < 1n || amountZat > 2100000000000000n) return null;
  return { address: m[1], amountZat };
}
