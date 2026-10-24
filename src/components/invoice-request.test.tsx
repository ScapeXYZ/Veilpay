import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/lib/contract/schemas";
import { InvoiceRequest, invoicePaymentUri } from "./invoice-request";

const invoice: Invoice = { id: "inv_test", merchantId: "merchant_test", reference: "Coffee & pastry", amountZat: "12345678", payTo: "utest1backendaddress", status: "open", createdAt: "2026-10-24T09:00:00Z" };

describe("Invoice payment request", () => {
  it("labels expiry in UTC consistently with the payment timeline", () => {
    render(<InvoiceRequest invoice={{ ...invoice, expiresAt: "2026-10-24T14:20:00Z" }} demo />);
    expect(screen.getByText(/Expires:/)).toHaveTextContent("24 Oct, 14:20 UTC");
  });
  it("encodes the exact backend address and decimal ZEC amount", () => {
    expect(invoicePaymentUri(invoice)).toBe("zcash:utest1backendaddress?amount=0.12345678&label=Coffee%20%26%20pastry");
  });
  it("never includes currency labels or grouping in large amounts", () => {
    expect(invoicePaymentUri({ ...invoice, amountZat: "123456789012" })).toContain("amount=1234.56789012&");
  });
  it("does not fabricate a missing receiving address", () => {
    render(<InvoiceRequest invoice={{ ...invoice, payTo: undefined }} demo={false} />);
    expect(invoicePaymentUri({ ...invoice, payTo: undefined })).toBeNull();
    expect(screen.getByText(/waiting for the backend/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("visibly marks demo QR codes and never claims payment is confirmed", () => {
    render(<InvoiceRequest invoice={invoice} demo />);
    expect(screen.getByText(/DEMO QR ONLY/)).toBeInTheDocument();
    expect(screen.getByText(/does not confirm payment/)).toBeInTheDocument();
    expect(screen.getByLabelText("Payment request")).toHaveValue(invoicePaymentUri(invoice));
  });
  it.each(["paid", "paid_late", "expired"] as const)("suppresses payment QR for %s invoice", (status) => {
    render(<InvoiceRequest invoice={{ ...invoice, status }} demo={false} />);
    expect(screen.getByText(/no longer payable/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Payment request")).toBeNull();
  });
  it("copies a request and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<InvoiceRequest invoice={invoice} demo />);
    fireEvent.click(screen.getByRole("button", { name: "Copy payment request" }));
    expect(await screen.findByText("Copied payment request")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(invoicePaymentUri(invoice));
  });
  it("offers manual copying when clipboard access fails", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<InvoiceRequest invoice={invoice} demo />);
    fireEvent.click(screen.getByRole("button", { name: "Copy payment request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/copy it manually/);
  });
});
