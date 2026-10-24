import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Providers } from "@/app/providers";
import { seedPayments } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import type { Payment } from "@/lib/contract/schemas";
import { MockBanner } from "./source";
import { PaymentDetail } from "./payment";

const seed = (id: string) => seedPayments().find((p) => p.id === id)!;
const renderDetail = (p: Payment) =>
  render(
    <Providers client={new MockApiClient({ latencyMs: 0 })}>
      <PaymentDetail p={p} />
    </Providers>,
  );

describe("PaymentDetail", () => {
  it("labels the wallet operation with readable operator-review copy", () => {
    renderDetail(seed("pay_operator00001"));
    expect(screen.getByTestId("wallet-op")).toHaveTextContent("Requires operator review · attempt 1");
    expect(screen.getByTestId("wallet-op")).not.toHaveTextContent(/Unknown|needsOperator/);
  });
  it("needsOperator: shows 'Requires operator review', no failure, no execute/resend button", () => {
    renderDetail(seed("pay_operator00001"));
    expect(screen.getByTestId("unresolved-operator")).toHaveTextContent("Requires operator review");
    expect(screen.queryByTestId("failure-definitive")).toBeNull();
    expect(screen.queryByTestId("execute")).toBeNull();
    expect(screen.queryByText(/simulate next chain event/i)).toBeNull();
    expect(screen.getByTestId("unresolved-operator")).toHaveTextContent(/provisional/i);
  });

  it("needsOperator still wins when the status reads failed", () => {
    renderDetail({ ...seed("pay_operator00001"), status: "failed", failure: { code: "BROADCAST_REJECTED", retriable: false, definitive: true } });
    expect(screen.getByTestId("unresolved-operator")).toBeInTheDocument();
    expect(screen.queryByTestId("failure-definitive")).toBeNull();
    expect(within(screen.getByTestId("send-record")).getByText("Requires operator review", { exact: true })).toBeInTheDocument();
    expect(within(screen.getByTestId("send-record")).queryByText("Failed")).toBeNull();
  });

  it("reconciling payment is labelled as unresolved and offers no resend", () => {
    renderDetail(seed("pay_reconcile0001"));
    expect(screen.getByTestId("unresolved-reconciling")).toHaveTextContent("Being reconciled");
    expect(screen.queryByTestId("execute")).toBeNull();
  });

  it.each(["authorized", "confirmed", "failed", "expired"] as const)("unknown wallet overrides %s without offering a resend", (status) => {
    const base = seed("pay_reconcile0001");
    renderDetail({ ...base, status, failure: null, walletOperation: { ...base.walletOperation!, state: "unknown", needsOperator: false } });
    expect(screen.getByTestId("unresolved-reconciling")).toBeInTheDocument();
    expect(screen.queryByTestId("execute")).toBeNull();
    expect(screen.queryByTestId("failure-definitive")).toBeNull();
    expect(within(screen.getByTestId("send-record")).queryByText("Paid", { exact: true })).toBeNull();
  });

  it("staged manual testnet payment: awaiting operator, signed txid marked not broadcast, no execute/resend", () => {
    const base = seed("pay_reconcile0001");
    renderDetail({ ...base, status: "submitted", failure: null, mockRef: null, txid: "ab".repeat(32), walletOperation: { ...base.walletOperation!, state: "pending", needsOperator: false, requiresOperatorConfirmation: true, phase: "prepared", feeZat: "10000" } });
    expect(screen.getByTestId("unresolved-awaiting-operator")).toHaveTextContent("Awaiting operator confirmation");
    expect(screen.getByTestId("txid-not-broadcast")).toHaveTextContent("signed, not broadcast");
    expect(screen.getByTestId("wallet-op-phase")).toHaveTextContent("Signed offline, not broadcast");
    expect(screen.queryByTestId("execute")).toBeNull();
    expect(screen.queryByRole("button", { name: /resend|retry|execute|pay/i })).toBeNull();
    expect(screen.queryByText(/Broadcast or in flight/)).toBeNull();
  });

  it("operator review overrides authorized and disables execution", () => {
    renderDetail({ ...seed("pay_operator00001"), status: "authorized" });
    expect(screen.getByTestId("unresolved-operator")).toBeInTheDocument();
    expect(screen.queryByTestId("execute")).toBeNull();
  });

  it("reorg shows a backward move in the timeline", () => {
    renderDetail(seed("pay_reorged000001"));
    const tl = screen.getByTestId("timeline");
    expect(within(tl).getByText("backward move")).toBeInTheDocument();
  });

  it("definitive failure is shown as failed with its code", () => {
    renderDetail(seed("pay_bcastrej0001"));
    expect(screen.getByTestId("failure-definitive")).toHaveTextContent("BROADCAST_REJECTED");
  });

  it("mock ref is never shown as a txid", () => {
    renderDetail(seed("pay_bcastrej0001"));
    expect(screen.getByTestId("tx-ref")).toHaveTextContent("not a txid");
  });
});

describe("MockBanner", () => {
  it("is always visible with the mock client", async () => {
    render(
      <Providers client={new MockApiClient({ latencyMs: 0 })}>
        <MockBanner />
      </Providers>,
    );
    expect(await screen.findByTestId("mock-banner")).toHaveTextContent(/mock/i);
  });
});
