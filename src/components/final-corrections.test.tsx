/**
 * Regression tests for the reviewer's frontend-to-Axum walkthrough corrections (final polish):
 * 1 Payment ID + copy, 2 privacy after a simulated payment, 3 simulated match wording,
 * 4 simulated confirmations, 5 receipt/ack never implies funds arrived, 6 merchant verify steps,
 * 7 consistent simulated status labels.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MerchantPage from "@/app/merchant/page";
import { Providers } from "@/app/providers";
import { seedPayments } from "@/lib/api/fixtures";
import { MockApiClient } from "@/lib/api/mock";
import type { Payment, Verification } from "@/lib/contract/schemas";
import {
  ackEligibility,
  ackStatement,
  confirmationsText,
  paymentStatusLabel,
  privacyLine,
  statusLabel,
  verificationCopy,
  wasSent,
} from "@/lib/present";
import { PaymentDetail } from "./payment";

vi.mock("next/navigation", () => ({ usePathname: () => "/merchant" }));

const seed = (id: string) => seedPayments().find((p) => p.id === id)!;
const renderDetail = (p: Payment) =>
  render(
    <Providers client={new MockApiClient({ latencyMs: 0 })}>
      <PaymentDetail p={p} />
    </Providers>,
  );

const verification = (over: Partial<Verification>): Verification =>
  ({
    paymentId: "pay_x",
    invoiceId: "inv_x",
    state: "received",
    expectedZat: "100",
    receivedZat: "100",
    confirmations: 3,
    confirmationsRequired: 3,
    method: "mock",
    mock: true,
    checkedAt: new Date().toISOString(),
    ...over,
  }) as Verification;

afterEach(() => vi.restoreAllMocks());

describe("1. Payment ID with one-click copy", () => {
  it("shows the full Payment ID and copies it to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const p = seed("pay_confirmed0001");
    renderDetail(p);
    expect(screen.getByTestId("payment-id-value")).toHaveTextContent(p.id);
    expect(screen.getByTestId("payment-id-help")).toHaveTextContent(/copy the ID and paste it on the Merchant page/i);
    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-payment-id"));
    });
    expect(writeText).toHaveBeenCalledWith(p.id);
    await waitFor(() => expect(screen.getByTestId("copy-payment-id-status")).toHaveTextContent("Copied to clipboard"));
  });
  it("tells the user how to copy by hand when the clipboard is blocked", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    renderDetail(seed("pay_confirmed0001"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("copy-payment-id"));
    });
    await waitFor(() => expect(screen.getByTestId("copy-payment-id-status")).toHaveTextContent(/copy it by hand/i));
  });
});

describe("2. Privacy after a simulated payment", () => {
  it("never says 'Not sent yet' once a simulated payment completed", () => {
    renderDetail(seed("pay_confirmed0001"));
    const row = screen.getByTestId("detail-privacy");
    expect(row).not.toHaveTextContent(/not sent yet/i);
    expect(row).toHaveTextContent(/Mock execution only/);
    expect(row).toHaveTextContent(/No real shielded settlement/);
  });
  it("counts a practice reference or timeline send as sent, even if the status lags", () => {
    const p = { ...seed("pay_confirmed0001"), status: "authorized" as const };
    expect(wasSent(p)).toBe(true);
    expect(privacyLine(p, true)).toMatch(/Mock execution only/);
  });
  it("still says 'Not sent yet' for an approved payment nothing was sent for", () => {
    const p = { ...seed("pay_confirmed0001"), status: "authorized" as const, mockRef: null, txid: null, timeline: [] };
    expect(privacyLine(p, false)).toBe("Not sent yet");
    expect(privacyLine(p, true)).toMatch(/^Not sent yet/);
  });
  it("live mode keeps the server-reported pool wording", () => {
    const p = { ...seed("pay_confirmed0001"), mockRef: null, pool: "orchard" as const };
    expect(privacyLine(p, false)).toBe("orchard pool, as reported by VeilPay");
  });
});

describe("3 + 5. Merchant receipt wording", () => {
  it("a simulated match reads 'The simulated payment matches the invoice.' and never 'arrived'", () => {
    const v = verification({});
    const c = verificationCopy(v);
    expect(c.label).toBe("Simulated match");
    expect(c.help).toMatch(/^The simulated payment matches the invoice\./);
    expect(ackEligibility(v).reason).toBe("The simulated payment matches the invoice.");
    expect(`${c.help} ${ackEligibility(v).reason}`).not.toMatch(/expected amount arrived|right amount arrived/i);
  });
  it("the acknowledgment statement never implies funds arrived or independent chain checks", () => {
    expect(ackStatement(true)).toMatch(/not proof that any funds arrived/);
    expect(ackStatement(false)).toMatch(/not settlement proof or an independent chain check/);
  });
  it("live receipts describe a scan report, not money arriving", () => {
    const v = verification({ method: "merchant_ivk_scan" as Verification["method"], mock: false });
    expect(verificationCopy(v).help).not.toMatch(/arrived/i);
    expect(ackEligibility(v).reason).not.toMatch(/arrived/i);
  });
});

describe("4. Confirmations are labelled simulated", () => {
  it("formats simulated and live confirmation counts", () => {
    expect(confirmationsText(2, 3, true)).toBe("2 of 3 simulated confirmations");
    expect(confirmationsText(1, 1, true)).toBe("1 of 1 simulated confirmation");
    expect(confirmationsText(2, 3, false)).toBe("2 of 3");
    expect(confirmationsText(null, null, true)).toBe("0 simulated confirmations");
    expect(confirmationsText(3, 1, true)).toBe("3 of 1 simulated confirmations");
  });
  it("payment details show simulated confirmations in practice mode", () => {
    renderDetail(seed("pay_confirmed0001"));
    expect(screen.getByTestId("detail-confirmations")).toHaveTextContent(/simulated confirmation/);
  });
});

describe("6. Merchant verification journey", () => {
  it("shows numbered copy-and-paste steps and checks on Enter", async () => {
    const api = new MockApiClient({ latencyMs: 0 });
    await api.createDemoSession("merchant");
    render(<Providers client={api}><MerchantPage /></Providers>);
    const steps = await screen.findByTestId("verify-steps");
    expect(steps).toHaveTextContent(/Payment ID/);
    expect(steps).toHaveTextContent(/Copy/);
    expect(steps).toHaveTextContent(/simulated payment matches the invoice, not that funds arrived/);
    const input = screen.getByTestId("verify-input");
    fireEvent.change(input, { target: { value: "  pay_confirmed0001  " } });
    fireEvent.submit(input.closest("form")!);
    const card = await screen.findByTestId("verification");
    expect(within(card).getByTestId("verification-confirmations")).toHaveTextContent(/simulated/);
  });
});

describe("7. Consistent simulated status labels", () => {
  it("badges, details and timeline share one simulated vocabulary", () => {
    const p = seed("pay_confirmed0001");
    expect(paymentStatusLabel(p, true).label).toBe("Simulated complete");
    expect(paymentStatusLabel(p, false).label).toBe("Paid");
    expect(statusLabel("confirming", true)).toBe("Simulated, awaiting simulated confirmations");
    expect(statusLabel("submitted", true)).toBe("Simulated send");
    expect(statusLabel("authorized", true)).toBe("Approved, not paid");
    renderDetail(p);
    expect(screen.getByTestId("detail-status")).toHaveTextContent("Simulated complete");
    expect(screen.getByTestId(`badge-${p.id}`)).toHaveTextContent("Simulated complete");
    expect(screen.getByTestId("tl-status-confirmed")).toHaveTextContent("Simulated complete");
  });
  it("unresolved states keep their own wording in a simulation", () => {
    const p = seed("pay_operator00001");
    expect(paymentStatusLabel(p, true).label).toBe("Requires operator review");
  });
});
