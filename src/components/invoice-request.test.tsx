import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Invoice } from "@/lib/contract/schemas";
import { isSaplingTestnetAddress } from "@/lib/zcash-address";
import { InvoiceRequest } from "./invoice-request";
import { invoicePaymentUri } from "@/lib/payment-uri";

// Public 43-byte Sapling receiver from causeway-sapling docs, re-encoded for testnet.
// Encoding vector only: never fund this address; no wallet control is claimed.
const address = "ztestsapling1euldd485nn489mlc9qs7g0vt9em845mfzehcp8sverxtwczhyuwhu8jzexhk8z6w4xt2wqfuzry";
const invoice: Invoice = { id: "inv_test", merchantId: "merchant_test", reference: "Coffee & pastry", amountZat: "12345678", payTo: address, status: "open", createdAt: "2026-10-24T09:00:00Z" };

describe("Invoice payment request safety", () => {
  it("labels expiry in UTC", () => {
    render(<InvoiceRequest invoice={{ ...invoice, expiresAt: "2026-10-24T14:20:00Z" }} demo />);
    expect(screen.getByText(/Expires:/)).toHaveTextContent("24 Oct, 14:20 UTC");
  });
  it("validates a checksummed Sapling testnet receiver", () => {
    expect(isSaplingTestnetAddress(address)).toBe(true);
    expect(invoicePaymentUri(invoice)).toBe(`zcash:${address}?amount=0.12345678&label=Coffee%20%26%20pastry`);
  });
  it.each(["", "utest1backendaddress", "mock-address-not-on-chain", "tmInventedAddress", address.slice(0, -1) + "q", address.toUpperCase(), "zs1" + address.slice(12)])("rejects invalid/unsupported receiver %s", (payTo) => {
    expect(invoicePaymentUri({ ...invoice, payTo })).toBeNull();
  });
  it("preserves exact large decimal amounts", () => {
    expect(invoicePaymentUri({ ...invoice, amountZat: "123456789012" })).toContain("amount=1234.56789012&");
  });
  it("rejects zero, excess amounts and expired requests", () => {
    expect(invoicePaymentUri({ ...invoice, amountZat: "0" })).toBeNull();
    expect(invoicePaymentUri({ ...invoice, amountZat: "2100000000000001" })).toBeNull();
    expect(invoicePaymentUri({ ...invoice, expiresAt: "2000-01-01T00:00:00Z" })).toBeNull();
  });
  it("does not fabricate a missing address", () => {
    render(<InvoiceRequest invoice={{ ...invoice, payTo: undefined }} demo={false} />);
    expect(screen.getByTestId("invoice-no-qr")).toHaveTextContent(/no validated/i);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("demo never generates a QR or wallet URI even with a valid address", () => {
    const { container } = render(<InvoiceRequest invoice={invoice} demo />);
    expect(invoicePaymentUri(invoice, true)).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.queryByLabelText("Payment request")).toBeNull();
    expect(screen.getByText(/DEMO ONLY/)).toBeInTheDocument();
    expect(screen.getByText(/does not mean it is paid/)).toBeInTheDocument();
  });
  it("nonspendable payload overrides an otherwise valid address", () => {
    const mock: Invoice = { ...invoice, paymentPayload: { format: "veilpay-mock-v1", uri: "veilpay-mock:inv_test?amountZat=12345678", mock: true, spendable: false } };
    expect(invoicePaymentUri(mock)).toBeNull();
    const { container } = render(<InvoiceRequest invoice={mock} demo={false} />);
    expect(container.querySelector("svg")).toBeNull();
  });
  it.each(["paid", "paid_late", "expired"] as const)("suppresses QR for %s", (status) => {
    render(<InvoiceRequest invoice={{ ...invoice, status }} demo={false} />);
    expect(invoicePaymentUri({ ...invoice, status })).toBeNull();
    expect(screen.getByText(/no longer payable/)).toBeInTheDocument();
  });
  it("copies a validated real request and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<InvoiceRequest invoice={invoice} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy payment request" }));
    expect(await screen.findByText("Copied payment request")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(invoicePaymentUri(invoice));
  });
  it("offers manual copying after clipboard rejection", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<InvoiceRequest invoice={invoice} demo={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy payment request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/copy it manually/);
  });
});

// Milestone 3 real testnet invoice: backend-issued ZIP-321 payload for an Orchard-only utest1 UA.
// Encoding vector only (receiver bytes 0x01..0x2b), never fund it.
const UTEST = "utest1s9tgkxz3facm5lakztmrm7g062wxvq7kdd93w23kmr368h90wxjrc0la8cxwzfummn2wd2q3ql6t3nt77s5r3n3uflj8kz2e2sz5yrtk";
const real: Invoice = {
  ...invoice,
  payTo: UTEST,
  network: "testnet",
  paymentPayload: { format: "zip321", uri: `zcash:${UTEST}?amount=0.12345678`, network: "testnet", mock: false, spendable: true },
};

describe("Backend ZIP-321 testnet invoices (Milestone 3)", () => {
  it("renders the backend request only after full validation", () => {
    expect(invoicePaymentUri(real)).toBe(real.paymentPayload!.uri);
    const { container } = render(<InvoiceRequest invoice={real} demo={false} />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/Testnet only/)).toBeInTheDocument();
  });
  it.each([
    ["demo mode", real, true],
    ["amount differs from invoice", { ...real, amountZat: "12345679" }, false],
    ["URI address differs from payTo", { ...real, paymentPayload: { ...real.paymentPayload!, uri: `zcash:${UTEST.slice(0, -1)}q?amount=0.12345678` } }, false],
    ["payTo fails UA decoding", { ...real, payTo: "utest1backendaddress", paymentPayload: { ...real.paymentPayload!, uri: "zcash:utest1backendaddress?amount=0.12345678" } }, false],
    ["invoice network missing", { ...real, network: undefined }, false],
    ["multi-payment request", { ...real, paymentPayload: { ...real.paymentPayload!, uri: `zcash:${UTEST}?amount=0.12345678&address.1=${UTEST}&amount.1=1` } }, false],
    ["expired", { ...real, expiresAt: "2000-01-01T00:00:00Z" }, false],
    ["paid", { ...real, status: "paid" }, false],
  ] as [string, Invoice, boolean][])("fails closed: %s", (_, inv, demo) => {
    expect(invoicePaymentUri(inv, demo)).toBeNull();
    const { container } = render(<InvoiceRequest invoice={inv} demo={demo} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.innerHTML).not.toContain("zcash:");
  });
});
