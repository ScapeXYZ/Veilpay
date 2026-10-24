"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { createApiClient } from "@/lib/api";
import { ApiContext } from "@/lib/api/hooks";
import { HandoffContext } from "@/lib/handoff";
import type { ApiClient } from "@/lib/api/types";

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
