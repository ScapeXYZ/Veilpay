"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";
import type { InvoiceCreate, PaymentRequestCreate, PolicyUpdate, SessionContext } from "@/lib/contract/schemas";
import { ApiError, newIdempotencyKey, type ApiClient } from "./types";

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const c = useContext(ApiContext);
  if (!c) throw new Error("ApiContext missing");
  return c;
}

const POLL_MS = 4000;

export const qk = {
  health: ["health"] as const,
  session: ["session"] as const,
  agent: (id: string) => ["agent", id] as const,
  payments: ["payments"] as const,
  payment: (id: string) => ["payment", id] as const,
  invoices: ["invoices"] as const,
  verification: (id: string) => ["verification", id] as const,
};

export function useHealth() {
  const api = useApi();
  return useQuery({ queryKey: qk.health, queryFn: () => api.getHealth(), refetchInterval: 10_000, retry: 1 });
}

export function useSession() {
  const api = useApi();
  return useQuery({
    queryKey: qk.session,
    queryFn: async () => {
      try {
        return await api.getSession();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return api.createDemoSession("customer");
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useSwitchContext() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ctx: SessionContext) => api.createDemoSession(ctx),
    onSuccess: (s) => {
      qc.setQueryData(qk.session, s);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "session" && q.queryKey[0] !== "health" });
    },
  });
}

export function useAgent(agentId: string | null | undefined, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: qk.agent(agentId ?? ""),
    queryFn: () => api.getAgent(agentId!),
    enabled: !!agentId && enabled,
    refetchInterval: POLL_MS,
  });
}

export function usePayments(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: qk.payments, queryFn: () => api.listPayments({ limit: 50 }), enabled, refetchInterval: POLL_MS });
}

export function usePayment(id: string | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: qk.payment(id ?? ""),
    queryFn: () => api.getPayment(id!),
    enabled: !!id && enabled,
    refetchInterval: POLL_MS,
  });
}

export function useInvoices(enabled = true) {
  const api = useApi();
  return useQuery({ queryKey: qk.invoices, queryFn: () => api.listInvoices(), enabled, refetchInterval: POLL_MS });
}

export function useVerification(paymentId: string | null, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: qk.verification(paymentId ?? ""),
    queryFn: () => api.getVerification(paymentId!),
    enabled: !!paymentId && enabled,
    refetchInterval: POLL_MS,
    retry: false,
  });
}

function useInvalidateCustomer() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["agent"] });
    qc.invalidateQueries({ queryKey: qk.payments });
    qc.invalidateQueries({ queryKey: ["payment"] });
  };
}

/**
 * Payment request with a stable Idempotency-Key per logical submit: the key is minted when
 * the user starts a submit and reused if the same body is retried after a network error.
 */
export function useRequestPayment() {
  const api = useApi();
  const invalidate = useInvalidateCustomer();
  return useMutation({
    mutationFn: ({ body, key }: { body: PaymentRequestCreate; key: string }) => api.requestPayment(body, key),
    onSettled: invalidate,
  });
}

const executeKeys = new Map<string, string>();
/** One Idempotency-Key per payment execute. A retry after 503 reuses it, so it can never cause a second send. */
export function executeKeyFor(paymentId: string): string {
  let k = executeKeys.get(paymentId);
  if (!k) {
    k = newIdempotencyKey();
    executeKeys.set(paymentId, k);
  }
  return k;
}

export function useExecutePayment() {
  const api = useApi();
  const invalidate = useInvalidateCustomer();
  return useMutation({
    mutationFn: (paymentId: string) => api.executePayment(paymentId, executeKeyFor(paymentId)),
    onSettled: invalidate,
  });
}

export function useSetAgentStatus() {
  const api = useApi();
  const invalidate = useInvalidateCustomer();
  return useMutation({
    mutationFn: ({ agentId, status }: { agentId: string; status: "active" | "paused" }) => api.setAgentStatus(agentId, status),
    onSettled: invalidate,
  });
}

export function usePutPolicy() {
  const api = useApi();
  const invalidate = useInvalidateCustomer();
  return useMutation({
    mutationFn: ({ agentId, body }: { agentId: string; body: PolicyUpdate }) => api.putPolicy(agentId, body),
    onSettled: invalidate,
  });
}

export function useCreateInvoice() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: InvoiceCreate; key: string }) => api.createInvoice(body, key),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.invoices }),
  });
}

export function useAcknowledge() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId, note, key }: { paymentId: string; note?: string; key: string }) =>
      api.acknowledgePayment(paymentId, note ? { note } : {}, key),
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: qk.verification(v.paymentId) }),
  });
}

const ERROR_COPY = {
  VALIDATION_FAILED: "Check the details you entered and try again.",
  UNAUTHENTICATED: "Your session has ended. Reload the page to start again.",
  WRONG_CONTEXT: "Switch to the correct customer or merchant view to continue.",
  NOT_FOUND: "No payment found with that ID. Check it and try again.",
  VERSION_CONFLICT: "These details changed. Reload them before saving again.",
  IDEMPOTENCY_MISMATCH: "This request changed after it was submitted. Check its status before creating another.",
  INVALID_TRANSITION: "This action is not available for the current payment status. Refresh to see the latest status.",
  POLICY_REJECTED: "The spending policy blocked this payment. Review the limits and allowed merchants.",
  NOT_YET_RECEIVED: "Payment has not been received yet. Wait for backend verification before acknowledging it.",
  ALREADY_ACKNOWLEDGED: "This payment has already been acknowledged. Refresh to see its receipt.",
  WALLET_UNAVAILABLE: "The wallet is temporarily unavailable. Check this payment's status before trying again.",
  INTERNAL: "The service could not complete this action. Check the latest status before trying again.",
  OUTCOME_UNKNOWN: "The payment outcome is still being checked. Do not resend it.",
  CSRF_FAILED: "Your session could not be verified. Reload the page before trying again.",
  AMOUNT_MISMATCH: "The received amount does not match this invoice. Review the receipt before acknowledging it.",
} as const;

export function errorText(e: unknown): string {
  if (e instanceof ApiError) return ERROR_COPY[e.body.code];
  return "We could not reach the service. Check your connection and try again.";
}
