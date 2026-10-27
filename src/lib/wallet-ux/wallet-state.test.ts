import { describe, expect, it } from "vitest";
import {
  expectedWalletNetwork, formatWalletZec, initialWalletState, isMobileBrowser, networkOfAccounts, networkOfAddress,
  truncateAddress, walletReducer, walletStatusCopy, type WalletState,
} from "./wallet-state";
import type { NoirAccount, NoirBalance } from "@/lib/noir-wallet";

const main: NoirAccount[] = [
  { id: "w:0", label: "Treasury", walletId: "w", accountId: "0", addresses: { transparent: "t1abc", shielded: "u1abcdefghijklmnopqrstuvwxyz" } },
  { id: "w:1", label: "", walletId: "w", accountId: "1", addresses: { transparent: "t1def", shielded: "u1zyxwvutsrqponmlkjihgfedcba" } },
];
const test: NoirAccount[] = [{ id: "t:0", label: "Test", walletId: "t", accountId: "0", addresses: { transparent: "tmXYZ", shielded: "utest1qqq" } }];

function bal(id: string, synced: boolean, shielded = "2.50"): NoirBalance {
  return { transparent: "9", shielded: "9", accounts: [{ id, walletId: "w", accountId: "0", synced, balance: { transparent: "0", shielded, available: "2.00", total: "2.60" } }] };
}
const connected = (): WalletState => walletReducer(initialWalletState, { type: "accounts", accounts: main, expected: "mainnet" });

describe("network detection", () => {
  it("reads mainnet and testnet from address prefixes", () => {
    expect(networkOfAddress("u1abc")).toBe("mainnet");
    expect(networkOfAddress("zs1abc")).toBe("mainnet");
    expect(networkOfAddress("t1abc")).toBe("mainnet");
    expect(networkOfAddress("utest1abc")).toBe("testnet");
    expect(networkOfAddress("ztestsapling1abc")).toBe("testnet");
    expect(networkOfAddress("tmabc")).toBe("testnet");
    expect(networkOfAddress("garbage")).toBeNull();
    expect(networkOfAccounts(main)).toBe("mainnet");
    expect(networkOfAccounts(test)).toBe("testnet");
    expect(networkOfAccounts([{ ...main[0], addresses: { transparent: "tmX", shielded: "u1X" } }])).toBe("mismatch");
    expect(networkOfAccounts([{ ...main[0], addresses: { transparent: "", shielded: "x" } }])).toBe("unknown");
  });
  it("only offers a wallet on a confirmed server network", () => {
    expect(expectedWalletNetwork("mainnet_readonly")).toBe("mainnet");
    expect(expectedWalletNetwork("testnet")).toBe("testnet");
    expect(expectedWalletNetwork("testnet_manual")).toBe("testnet");
    expect(expectedWalletNetwork("mock")).toBeNull();
    expect(expectedWalletNetwork("unknown")).toBeNull();
    expect(expectedWalletNetwork("disabled")).toBe("testnet");
  });
});

describe("walletReducer states", () => {
  it("not installed vs desktop-only on phones", () => {
    expect(walletReducer(initialWalletState, { type: "provider_missing", mobile: false }).status).toBe("not_installed");
    expect(walletReducer(initialWalletState, { type: "provider_missing", mobile: true }).status).toBe("mobile_unsupported");
  });
  it("disconnected -> connecting -> connected selects the first account and asks for a balance", () => {
    const d = walletReducer(initialWalletState, { type: "restore_none" });
    expect(d.status).toBe("disconnected");
    const c = walletReducer(d, { type: "connect_start" });
    expect(c.status).toBe("connecting");
    const s = walletReducer(c, { type: "accounts", accounts: main, expected: "mainnet" });
    expect(s).toMatchObject({ status: "connected", selectedId: "w:0", balanceLoading: true, balance: null });
  });
  it("empty account list is disconnected", () => {
    expect(walletReducer(initialWalletState, { type: "accounts", accounts: [], expected: "mainnet" }).status).toBe("disconnected");
  });
  it("wrong network fails closed and drops accounts", () => {
    const s = walletReducer(initialWalletState, { type: "accounts", accounts: test, expected: "mainnet" });
    expect(s).toMatchObject({ status: "wrong_network", accounts: [], detectedNetwork: "testnet", balance: null });
    const u = walletReducer(initialWalletState, { type: "accounts", accounts: [{ ...main[0], addresses: { transparent: "", shielded: "?" } }], expected: "mainnet" });
    expect(u).toMatchObject({ status: "wrong_network", detectedNetwork: "unknown", accounts: [] });
    expect(walletStatusCopy("wrong_network", "testnet", "mainnet").title).toMatch(/wallet is on testnet/);
    expect(walletStatusCopy("wrong_network", "unknown", "mainnet").title).toMatch(/could not be confirmed/);
  });
  it("synced balance is shown; unsynced is Unavailable, never 0", () => {
    const s = walletReducer(connected(), { type: "balance", accountId: "w:0", result: bal("w:0", true) });
    expect(s.balance).toEqual({ synced: true, values: { shielded: "2.50", transparent: "0", available: "2.00", total: "2.60" } });
    const u = walletReducer(connected(), { type: "balance", accountId: "w:0", result: bal("w:0", false, "0") });
    expect(u.balance?.synced).toBe(false);
    expect(formatWalletZec(u.balance?.values.shielded, false)).toBe("Unavailable");
  });
  it("a balance without a per-account entry fails closed as unsynced", () => {
    const s = walletReducer(connected(), { type: "balance", accountId: "w:0", result: { transparent: "0", shielded: "1", accounts: [] } });
    expect(s.balance?.synced).toBe(false);
  });
  it("ignores a stale balance for a different account", () => {
    const sel = walletReducer(connected(), { type: "select", accountId: "w:1" });
    expect(walletReducer(sel, { type: "balance", accountId: "w:0", result: bal("w:0", true) })).toBe(sel);
  });
  it("select only accepts authorized accounts and clears the old balance", () => {
    const withBal = walletReducer(connected(), { type: "balance", accountId: "w:0", result: bal("w:0", true) });
    const s = walletReducer(withBal, { type: "select", accountId: "w:1" });
    expect(s).toMatchObject({ selectedId: "w:1", balance: null, balanceLoading: true });
    expect(walletReducer(withBal, { type: "select", accountId: "evil" })).toBe(withBal);
  });
  it("locked ([]), disconnected (null) and account change all drop balances", () => {
    const withBal = walletReducer(connected(), { type: "balance", accountId: "w:0", result: bal("w:0", true) });
    expect(walletReducer(withBal, { type: "accounts_changed", payload: [] })).toMatchObject({ status: "locked", balance: null, accounts: [] });
    expect(walletReducer(withBal, { type: "accounts_changed", payload: null })).toMatchObject({ status: "disconnected", balance: null });
    const changed = walletReducer(withBal, { type: "accounts_changed", payload: [{ id: "w:1" }] });
    expect(changed).toMatchObject({ status: "account_changed", balance: null, selectedId: null });
    const reloaded = walletReducer(changed, { type: "accounts", accounts: main, expected: "mainnet", afterChange: true });
    expect(reloaded).toMatchObject({ status: "account_changed", selectedId: null, balance: null });
    expect(reloaded.accounts).toHaveLength(2);
    expect(walletReducer(reloaded, { type: "select", accountId: "w:1" })).toMatchObject({ status: "connected", selectedId: "w:1", balanceLoading: true });
  });
  it("errors map to rejected / locked / error; syncing keeps accounts but no amounts", () => {
    expect(walletReducer(connected(), { type: "error", kind: "rejected" }).status).toBe("rejected");
    expect(walletReducer(connected(), { type: "error", kind: "locked" })).toMatchObject({ status: "locked", accounts: [] });
    expect(walletReducer(connected(), { type: "error", kind: "failed" })).toMatchObject({ status: "error", balance: null });
    const sy = walletReducer(connected(), { type: "error", kind: "syncing" });
    expect(sy).toMatchObject({ status: "connected", balance: { synced: false, values: {} }, balanceLoading: false });
  });
  it("off clears everything", () => {
    expect(walletReducer(connected(), { type: "off" })).toMatchObject({ status: "off", accounts: [] });
  });
});

describe("presentation helpers", () => {
  it("formats amounts strictly", () => {
    expect(formatWalletZec("1.25", true)).toBe("1.25 ZEC");
    expect(formatWalletZec("0", true)).toBe("0 ZEC");
    expect(formatWalletZec(undefined, true)).toBe("Unavailable");
    expect(formatWalletZec("NaN", true)).toBe("Unavailable");
    expect(formatWalletZec("5", false)).toBe("Unavailable");
  });
  it("truncates long addresses only", () => {
    expect(truncateAddress("u1abcdefghijklmnopqrstuvwxyz")).toBe("u1abcdef…uvwxyz");
    expect(truncateAddress("t1short")).toBe("t1short");
  });
  it("detects phones", () => {
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isMobileBrowser({ userAgent: "x", userAgentData: { mobile: true } })).toBe(true);
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Macintosh) Chrome/130" })).toBe(false);
  });
});
