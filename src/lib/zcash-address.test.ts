import { describe, expect, it } from "vitest";
import {
  blake2b,
  decodeUnifiedAddress,
  f4jumble,
  f4jumbleInv,
  isOrchardTestnetUnifiedAddress,
  isSaplingTestnetAddress,
  isValidatedTestnetAddress,
  parseZip321,
  zecToZat,
} from "./zcash-address";

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

// Official ZIP-316 vectors (github.com/zcash/zcash-test-vectors, f4jumble.json row 0 and
// unified_address.json row 3: p2pkh + Sapling + Orchard, mainnet HRP "u").
const F4_NORMAL = "5d7a8f739a2d9e945b0ce152a8049e294c4d6e66b164939daffa2ef6ee6921481cdd86b3cc4318d9614fc820905d042b";
const F4_JUMBLED = "0304d029141b995da5387c125970673504d6c764d91ea6c082123770c7139ccd88ee27368cd0c0921a0444c8e5858d22";
const OFFICIAL_UA =
  "u1pg2aaph7jp8rpf6yhsza25722sg5fcn3vaca6ze27hqjw7jvvhhuxkpcg0ge9xh6drsgdkda8qjq5chpehkcpxf87rnjryjqwymdheptpvnljqqrjqzjwkc2ma6hcq666kgwfytxwac8eyex6ndgr6ezte66706e3vaqrd25dzvzkc69kw0jgywtd0cmq52q5lkw6uh7hyvzjse8ksx";
const OFFICIAL_ORCHARD = "cecbe5e689a453a3fe10ccf7617e6c1fb382819d7fc9200a1f42092ac84a30378f8c1fb90dff71a6d5042d";
const OFFICIAL_P2PKH = "cad268758c5e71493066446b98e71df9d1d6a5ca";

// Orchard-only testnet UA built by an independent reference (Python hashlib.blake2b) from the
// receiver bytes 0x01..0x2b. Encoding vector only: not a real key, never fund it.
const UTEST_ORCHARD =
  "utest1s9tgkxz3facm5lakztmrm7g062wxvq7kdd93w23kmr368h90wxjrc0la8cxwzfummn2wd2q3ql6t3nt77s5r3n3uflj8kz2e2sz5yrtk";
// Same receiver encoded with the mainnet HRP.
const MAIN_ORCHARD = "u1dm4vf5es4c5hwtjdhke5sh7xsdfu6a5c8veg4hj30uj9ffgyalz0ywvu0a9rhmgw5rcnz7a7dgg2cmy8uvu38q7z967vsjn0pgjq2fyp";

describe("BLAKE2b + F4Jumble (ZIP-316)", () => {
  it("matches a personalized BLAKE2b reference", () => {
    const person = new Uint8Array(16);
    person.set(new TextEncoder().encode("UA_F4Jumble_H"));
    expect(toHex(blake2b(new TextEncoder().encode("abc"), 32, person))).toBe("e479e6f35217a13c406f98f6876726a6c01d8ee083a7ade2bc0c1ffcbc72e2a8");
  });
  it("matches the official F4Jumble vector both ways", () => {
    expect(toHex(f4jumble(hex(F4_NORMAL)))).toBe(F4_JUMBLED);
    expect(toHex(f4jumbleInv(hex(F4_JUMBLED)))).toBe(F4_NORMAL);
  });
});

describe("Unified Address decoding", () => {
  it("decodes the official ZIP-316 vector to its exact receivers", () => {
    const items = decodeUnifiedAddress(OFFICIAL_UA, "u")!;
    expect(items.map((i) => i.typecode)).toEqual([0, 2, 3]);
    expect(toHex(items.find((i) => i.typecode === 3)!.data)).toBe(OFFICIAL_ORCHARD);
    expect(toHex(items.find((i) => i.typecode === 0)!.data)).toBe(OFFICIAL_P2PKH);
  });
  it("accepts an Orchard-only testnet UA and recovers the receiver", () => {
    expect(isOrchardTestnetUnifiedAddress(UTEST_ORCHARD)).toBe(true);
    expect(toHex(decodeUnifiedAddress(UTEST_ORCHARD, "utest")![0].data)).toBe(toHex(Uint8Array.from({ length: 43 }, (_, i) => i + 1)));
  });
  it.each([
    ["mainnet UA", MAIN_ORCHARD],
    ["official mainnet UA", OFFICIAL_UA],
    ["one changed character", UTEST_ORCHARD.slice(0, 20) + (UTEST_ORCHARD[20] === "q" ? "p" : "q") + UTEST_ORCHARD.slice(21)],
    ["truncated", UTEST_ORCHARD.slice(0, -1)],
    ["uppercase", UTEST_ORCHARD.toUpperCase()],
    ["prefix only", "utest1backendaddress"],
    ["mock receiver", "mock-address-not-on-chain"],
    ["empty", ""],
  ])("rejects %s", (_, address) => {
    expect(isOrchardTestnetUnifiedAddress(address)).toBe(false);
    expect(isValidatedTestnetAddress(address)).toBe(false);
  });
  it("still validates Sapling testnet and never treats a UA as Sapling", () => {
    expect(isSaplingTestnetAddress(UTEST_ORCHARD)).toBe(false);
    expect(isValidatedTestnetAddress("ztestsapling1euldd485nn489mlc9qs7g0vt9em845mfzehcp8sverxtwczhyuwhu8jzexhk8z6w4xt2wqfuzry")).toBe(true);
  });
});

describe("ZIP-321 parsing", () => {
  it("parses an exact single-payment request", () => {
    expect(parseZip321(`zcash:${UTEST_ORCHARD}?amount=0.12345678`)).toEqual({ address: UTEST_ORCHARD, amountZat: 12345678n });
    expect(parseZip321(`zcash:${UTEST_ORCHARD}?amount=1&label=x&message=y`)).toEqual({ address: UTEST_ORCHARD, amountZat: 100000000n });
  });
  it.each([
    `zcash:${UTEST_ORCHARD}`,
    `zcash:${UTEST_ORCHARD}?amount=0`,
    `zcash:${UTEST_ORCHARD}?amount=0.123456789`,
    `zcash:${UTEST_ORCHARD}?amount=1e-8`,
    `zcash:${UTEST_ORCHARD}?amount=1&amount=2`,
    `zcash:${UTEST_ORCHARD}?amount=1&address.1=${UTEST_ORCHARD}&amount.1=1`,
    `zcash:${UTEST_ORCHARD}?amount=1&req-future=1`,
    `zcash:?address=${UTEST_ORCHARD}&amount=1`,
    `veilpay-mock:inv_1?amountZat=1`,
  ])("rejects %s", (uri) => {
    expect(parseZip321(uri)).toBeNull();
  });
  it("converts ZEC to zatoshis without floats", () => {
    expect(zecToZat("1234.56789012")).toBe(123456789012n);
    expect(zecToZat("0.1")).toBe(10000000n);
    expect(zecToZat("01")).toBeNull();
  });
});
