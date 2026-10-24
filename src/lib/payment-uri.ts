import type { Invoice } from "@/lib/contract/schemas";
import { formatZec } from "@/lib/zat";
import { isSaplingTestnetAddress, isValidatedTestnetAddress, parseZip321 } from "@/lib/zcash-address";

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
