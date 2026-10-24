import type { Invoice } from "@/lib/contract/schemas";
import { formatZec } from "@/lib/zat";
import { isSaplingTestnetAddress, isValidatedTestnetAddress, parseZip321 } from "@/lib/zcash-address";

/** Strict, testnet-only ZIP-321 gate. Mock and mainnet payloads never yield a wallet URI. */
export function invoicePaymentUri(invoice: Invoice, demo = false): string | null {
  if (demo || invoice.status !== "open" || !invoice.payTo) return null;
  if (invoice.expiresAt && Date.parse(invoice.expiresAt) <= Date.now()) return null;
  if (BigInt(invoice.amountZat) < 1n || BigInt(invoice.amountZat) > 2100000000000000n) return null;
  const payload = invoice.paymentPayload;
  if (payload) {
    if (payload.format !== "zip321" || payload.network !== "testnet" || payload.spendable !== true || payload.mock !== false) return null;
    if (invoice.network !== "testnet" || !isValidatedTestnetAddress(invoice.payTo)) return null;
    const parsed = parseZip321(payload.uri);
    return parsed && parsed.address === invoice.payTo && parsed.amountZat === BigInt(invoice.amountZat) ? payload.uri : null;
  }
  if (!isSaplingTestnetAddress(invoice.payTo)) return null;
  const amount = formatZec(invoice.amountZat, { unit: false }).replaceAll(",", "");
  return `zcash:${encodeURIComponent(invoice.payTo)}?amount=${amount}&label=${encodeURIComponent(invoice.reference)}`;
}
