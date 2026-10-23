import { describe, expect, it } from "vitest";
import { seedPayments } from "@/lib/api/fixtures";
import type { Payment, Verification } from "@/lib/contract/schemas";
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
    expect(paymentBadge(p).label).toBe("Submitted, outcome unknown");
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
    expect(timelineTitle({ status: "confirming", kind: "reorg", at: "2026-10-23T00:00:00Z" })).toMatch(/^Reorg: back to/);
    expect(timelineTitle({ status: "failed", kind: "reconciled", at: "2026-10-23T00:00:00Z" })).toMatch(/^Reconciled:/);
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
  it("mock client is always mock; live client trusts the backend mode", () => {
    expect(dataSourceOf(undefined, "mock")).toBe("mock");
    expect(dataSourceOf(undefined, "live")).toBe("unknown");
  });
});
