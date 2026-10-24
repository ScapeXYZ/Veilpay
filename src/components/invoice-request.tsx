"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Invoice } from "@/lib/contract/schemas";
import { formatZec } from "@/lib/zat";
import { fmtTime } from "@/lib/present";
import { isSaplingTestnetAddress, isValidatedTestnetAddress, parseZip321 } from "@/lib/zcash-address";
import { Badge, Button, ErrorBox } from "./ui";

/**
 * The ONLY gate for a payment QR / wallet request. Fails closed unless every check passes:
 * not demo, invoice open and unexpired, amount in range, and a fully decoded testnet receiver.
 * - Backend `zip321` payload (Milestone 3 real testnet invoices): rendered only if it is marked
 *   testnet + spendable + non-mock, the invoice says network=testnet, the URI is a strict
 *   single-payment ZIP-321 whose address equals `payTo` (an Orchard `utest1` UA or Sapling
 *   testnet address) and whose amount equals `amountZat` exactly.
 * - Mock payload: never.
 * - Legacy invoices with no payload: built locally for a validated Sapling testnet address only.
 * ZIP-321 amount is decimal ZEC, derived without floating point. Never invent an address.
 */
export function invoicePaymentUri(invoice: Invoice, demo = false): string | null {
  if (demo || invoice.status !== "open" || !invoice.payTo) return null;
  if (invoice.expiresAt && Date.parse(invoice.expiresAt) <= Date.now()) return null;
  if (BigInt(invoice.amountZat) < 1n || BigInt(invoice.amountZat) > 2100000000000000n) return null;
  const payload = invoice.paymentPayload;
  if (payload) {
    if (payload.format !== "zip321" || payload.network !== "testnet" || payload.spendable !== true || payload.mock !== false) return null;
    if (invoice.network !== "testnet" || !isValidatedTestnetAddress(invoice.payTo)) return null;
    const parsed = parseZip321(payload.uri);
    if (!parsed || parsed.address !== invoice.payTo || parsed.amountZat !== BigInt(invoice.amountZat)) return null;
    return payload.uri;
  }
  if (!isSaplingTestnetAddress(invoice.payTo)) return null;
  const amount = formatZec(invoice.amountZat, { unit: false }).replaceAll(",", "");
  return `zcash:${encodeURIComponent(invoice.payTo)}?amount=${amount}&label=${encodeURIComponent(invoice.reference)}`;
}

export function InvoiceRequest({ invoice, demo }: { invoice: Invoice; demo: boolean }) {
  const uri = invoicePaymentUri(invoice, demo);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const payable = invoice.status === "open";
  return (
    <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950 p-4" data-testid="invoice-request">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{invoice.reference}</h3>
        <Badge tone={payable ? "info" : "neutral"}>{invoice.status.replaceAll("_", " ")}</Badge>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-zinc-400">{invoice.id}</p>
      <p className="mt-2 text-sm">Request {formatZec(invoice.amountZat)}</p>
      {uri && payable ? (
        <>
          <div className="mx-auto my-4 w-fit rounded-xl bg-white p-4">
            <QRCodeSVG value={uri} size={176} level="M" title={demo ? "Demo invoice QR, not a real payment address" : "Scan this invoice with a Zcash wallet"} />
          </div>
          <p className="mb-3 text-xs text-zinc-300">{demo ? "DEMO QR ONLY. This is a simulated address. Do not send funds." : "Testnet only. Scan with a Zcash testnet wallet, or copy the payment request. Never pay an invoice twice."}</p>
          <label className="block text-xs text-zinc-400">Payment request
            <textarea readOnly value={uri} rows={3} className="mt-1 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200" />
          </label>
          <Button className="mt-2" variant="secondary" onClick={async () => {
            try { await navigator.clipboard.writeText(uri); setCopied(true); setError(null); }
            catch { setError("Copy is unavailable. Select the payment request above and copy it manually."); }
          }}>{copied ? "Copied payment request" : "Copy payment request"}</Button>
          <p role="status" className="mt-2 text-xs text-emerald-300">{copied ? "Ready to share with your customer." : ""}</p>
        </>
      ) : <div className="mt-3 rounded-lg border border-dashed border-zinc-600 p-4 text-sm text-zinc-300" data-testid="invoice-no-qr">{!payable ? "This invoice is no longer payable. Create a new invoice for a new payment." : demo || invoice.paymentPayload?.format === "veilpay-mock-v1" ? "DEMO ONLY. No payment QR or wallet request is generated. Do not send funds." : "No validated, unexpired testnet payment request is available. No payment QR is generated; anything that fails validation fails closed."}</div>}
      <p className="mt-2 text-xs text-zinc-400">Sharing a request does not confirm payment. Status changes only when the backend verifies receipt.</p>
      {invoice.expiresAt && <p className="mt-1 text-xs text-zinc-400">Expires: {fmtTime(invoice.expiresAt)}</p>}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
