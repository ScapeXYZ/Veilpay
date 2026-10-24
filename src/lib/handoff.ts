"use client";

import { createContext, useContext } from "react";
import { hmrSingleton } from "./hmr-singleton";

/**
 * In-memory hand-off between the customer and merchant views of the same demo browser.
 * The contract gives a merchant no way to list payments for its invoices, and gives a
 * customer no way to look up an invoice, so ids travel here (never in URLs or storage).
 * See docs/contract-changes.md #1 and #2.
 *
 * Lives outside app/providers.tsx so that file exports only a component: a hook exported next to
 * a component makes Fast Refresh fall back to a full page reload on every edit.
 */
export type Handoff = {
  paymentIds: string[];
  invoiceIds: string[];
  addPayment: (id: string) => void;
  addInvoice: (id: string) => void;
};

export const HandoffContext = hmrSingleton("HandoffContext", () => createContext<Handoff | null>(null));

export function useHandoff(): Handoff {
  const h = useContext(HandoffContext);
  if (!h) throw new Error("HandoffContext missing");
  return h;
}
