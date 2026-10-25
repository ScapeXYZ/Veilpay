export type InvoiceStatus = "open" | "paid" | "paid_late" | "expired";

/**
 * Merchant invoice badge text. In practice mode a paid invoice was paid by a simulated
 * payment, so the badge says so in words: "Simulated paid", "Simulated paid late".
 * Open and expired keep their existing text.
 */
export function invoiceBadgeText(status: InvoiceStatus, simulated: boolean): string {
  if (status === "paid") return simulated ? "Simulated paid" : "Paid";
  if (status === "paid_late") return simulated ? "Simulated paid late" : "Paid late";
  return status;
}
