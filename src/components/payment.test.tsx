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
