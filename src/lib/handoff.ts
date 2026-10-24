"use client";

import { createContext, useContext } from "react";
import { hmrSingleton } from "./hmr-singleton";

type Handoff = { paymentIds: string[]; invoiceIds: string[]; addPayment: (id: string) => void; addInvoice: (id: string) => void };
export const HandoffContext = hmrSingleton("HandoffContext", () => createContext<Handoff | null>(null));
export function useHandoff(): Handoff {
  const handoff = useContext(HandoffContext);
  if (!handoff) throw new Error("HandoffContext missing");
  return handoff;
}
