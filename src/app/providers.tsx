"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createApiClient } from "@/lib/api";
import { ApiContext } from "@/lib/api/hooks";
import type { ApiClient } from "@/lib/api/types";

/**
 * In-memory hand-off between the customer and merchant views of the same demo browser.
 * The contract gives a merchant no way to list payments for its invoices, and gives a
 * customer no way to look up an invoice, so ids travel here (never in URLs or storage).
 * See docs/contract-changes.md #1 and #2.
 */
type Handoff = {
  paymentIds: string[];
  invoiceIds: string[];
  addPayment: (id: string) => void;
  addInvoice: (id: string) => void;
};
const HandoffContext = createContext<Handoff | null>(null);

export function useHandoff(): Handoff {
  const h = useContext(HandoffContext);
  if (!h) throw new Error("HandoffContext missing");
  return h;
}

export function Providers({ children, client }: { children: ReactNode; client?: ApiClient }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 1500 } } }),
  );
  const [api] = useState<ApiClient>(() => client ?? createApiClient());
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [invoiceIds, setInvoiceIds] = useState<string[]>([]);
  const addPayment = useCallback((id: string) => setPaymentIds((s) => (s.includes(id) ? s : [id, ...s])), []);
  const addInvoice = useCallback((id: string) => setInvoiceIds((s) => (s.includes(id) ? s : [id, ...s])), []);
  const handoff = useMemo(() => ({ paymentIds, invoiceIds, addPayment, addInvoice }), [paymentIds, invoiceIds, addPayment, addInvoice]);

  return (
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api}>
        <HandoffContext.Provider value={handoff}>{children}</HandoffContext.Provider>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
}
