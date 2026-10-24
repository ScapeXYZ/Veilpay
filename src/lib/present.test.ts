import { describe, expect, it } from "vitest";
import { seedPayments } from "@/lib/api/fixtures";
import type { Health, Payment, Verification } from "@/lib/contract/schemas";
import { ackEligibility, dataSourceOf, paymentBadge, timelineTitle, unresolvedOf } from "./present";

const byId = (id: string) => seedPayments().find((p) => p.id === id)!;

describe("unresolved payments (Temi caveat 1)", () => {
  it("needsOperator=true shows 'Requires operator review', never a failure", () => {
    const p = byId("pay_operator00001");
    expect(p.walletOperation?.needsOperator).toBe(true);
    expect(unresolvedOf(p)?.title).toBe("Requires operator review");
    expect(paymentBadge(p).label).toBe("Requires operator review");
    expect(paymentBadge(p).label.toLowerCase()).not.toContain("fail");
  });

  it("needsOperator wins even if the backend status says failed", () => {
    const p: Payment = { ...byId("pay_operator00001"), status: "failed" };
    expect(paymentBadge(p).label).toBe("Requires operator review");
  });

  it("crash between persist and send (pending op, submitted) is reconciling, not failed", () => {
    const p = byId("pay_reconcile0001");
    const u = unresolvedOf(p);
    expect(u?.kind).toBe("reconciling");
    expect(paymentBadge(p).label).toBe("Sent, outcome unknown");
  });

  it("definitive failures and normal states are not unresolved", () => {
    expect(unresolvedOf(byId("pay_bcastrej0001"))).toBeNull();
    expect(paymentBadge(byId("pay_bcastrej0001")).tone).toBe("danger");
    expect(unresolvedOf(byId("pay_confirmed0001"))).toBeNull();
    expect(paymentBadge(byId("pay_confirmed0001")).label).toBe("Paid");
  });
});

describe("timeline", () => {
  it("labels reorg as a backward move and keeps reconciled events distinct", () => {
    expect(timelineTitle({ status: "confirming", kind: "reorg", at: "2026-10-23T00:00:00Z" })).toMatch(/^Network correction: back to/);
    expect(timelineTitle({ status: "failed", kind: "reconciled", at: "2026-10-23T00:00:00Z" })).toMatch(/^Rechecked:/);
  });
});

describe("merchant acknowledgment gate", () => {
  const v = (o: Partial<Verification>): Verification => ({
    paymentId: "pay_x",
    invoiceId: "inv_x",
    state: "received",
    expectedZat: "100",
    receivedZat: "100",
    confirmations: 1,
    confirmationsRequired: 1,
    method: "mock",
    checkedAt: "2026-10-23T00:00:00Z",
    mock: true,
    ...o,
  });
  it("allows received, blocks mismatch and unverified", () => {
    expect(ackEligibility(v({})).allowed).toBe(true);
    expect(ackEligibility(v({ state: "amount_mismatch", receivedZat: "90" })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "pending" })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "not_seen" })).allowed).toBe(false);
  });
  it("late receipts need exact amount AND required depth", () => {
    expect(ackEligibility(v({ state: "late", confirmations: 0 })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "late", receivedZat: "99" })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "late" })).allowed).toBe(true);
  });
});

describe("real-vs-mock indicator", () => {
  it("never labels the disabled adapter or mainnet as real testnet", () => {
    const health: Health = { status: "degraded", network: "testnet", wallet: "broadcast_disabled", walletBackend: "zingo", chainHeight: null, confirmationsRequired: 1, mode: "disabled", reconciler: { lastRunAt: null, unresolved: 0 }, chainWatcher: { lastBlockAt: null, watchDepth: 10, deepReorgAlert: false } };
    expect(dataSourceOf(health, "live")).toBe("disabled");
    expect(dataSourceOf({ ...health, mode: "real" }, "live")).toBe("disabled");
    expect(dataSourceOf({ ...health, wallet: "ready", mode: "real", network: "mainnet" }, "live")).toBe("unknown");
  });
  it("mock client is always mock; live client trusts the backend mode", () => {
    expect(dataSourceOf(undefined, "mock")).toBe("mock");
    expect(dataSourceOf(undefined, "live")).toBe("unknown");
  });
});

describe("Milestone 3 manual testnet execution + merchant wallet verification", () => {
  const v = (o: Partial<Verification>): Verification => ({
    paymentId: "pay_x", invoiceId: "inv_x", state: "received", expectedZat: "100", receivedZat: "100",
    confirmations: 3, confirmationsRequired: 3, method: "mock", checkedAt: "2026-10-23T00:00:00Z", mock: true, ...o,
  });
  const staged = (phase?: NonNullable<Payment["walletOperation"]>["phase"], requiresOperatorConfirmation = true): Payment => {
    const base = byId("pay_reconcile0001");
    return { ...base, status: "submitted", failure: null, txid: phase === "prepared" ? "ab".repeat(32) : null, walletOperation: { ...base.walletOperation!, state: "pending", needsOperator: false, requiresOperatorConfirmation, phase } };
  };
  it.each(["awaiting_operator", "preparing", "prepared", "submitting"] as const)("phase %s is awaiting operator, never paid or failed", (phase) => {
    const p = staged(phase);
    expect(unresolvedOf(p)?.kind).toBe("awaiting-operator");
    expect(paymentBadge(p).label).toBe("Awaiting operator");
    for (const status of ["confirmed", "failed", "authorized"] as const) expect(paymentBadge({ ...p, status }).label).toBe("Awaiting operator");
  });
  it("requiresOperatorConfirmation without a phase is still awaiting operator", () => {
    expect(unresolvedOf(staged(undefined))?.kind).toBe("awaiting-operator");
  });
  it("needsOperator outranks awaiting operator", () => {
    const p = staged("prepared");
    expect(unresolvedOf({ ...p, walletOperation: { ...p.walletOperation!, needsOperator: true } })?.kind).toBe("operator");
  });
  it("observing falls back to the wallet-op state (pending op = reconciling)", () => {
    expect(unresolvedOf(staged("observing"))?.kind).toBe("reconciling");
  });
  it("new timeline kinds have readable titles", () => {
    expect(timelineTitle({ status: "confirming", kind: "verification", at: "2026-10-24T00:00:00Z" })).toMatch(/Merchant verification/);
    expect(timelineTitle({ status: "submitted", kind: "wallet", at: "2026-10-24T00:00:00Z" })).toMatch(/Wallet event/);
  });
  it.each(["underpaid", "duplicate", "conflicting", "reorged"] as const)("%s can never be acknowledged", (state) => {
    expect(ackEligibility(v({ state })).allowed).toBe(false);
  });
  it("backend acknowledgmentEligible=false narrows a received verdict, true never widens", () => {
    expect(ackEligibility(v({ acknowledgmentEligible: false })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "late", acknowledgmentEligible: false })).allowed).toBe(false);
    expect(ackEligibility(v({ state: "pending", acknowledgmentEligible: true })).allowed).toBe(false);
    expect(ackEligibility(v({ method: "merchant_wallet_scan", mock: false })).allowed).toBe(true);
  });
  it("testnet_manual on testnet is a real source; operator_required wallet is not disabled", () => {
    const h = { status: "ok", network: "testnet", wallet: "operator_required", walletBackend: "zingo-cli", chainHeight: 1, confirmationsRequired: 3, mode: "testnet_manual", reconciler: { lastRunAt: null, unresolved: 0 }, chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 100, deepReorgAlert: false } } as Health;
    expect(dataSourceOf(h, "live")).toBe("real");
    expect(dataSourceOf({ ...h, network: "mainnet" }, "live")).toBe("unknown");
  });
});
