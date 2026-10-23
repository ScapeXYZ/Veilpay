/**
 * Live client: same-origin /api, cookie session, X-CSRF-Token on every state change,
 * Idempotency-Key on every state POST except the /session/demo bootstrap (contract v1.1).
 * The CSRF token lives in memory only, never in localStorage or URLs.
 */
import type { z } from "zod";
import * as S from "@/lib/contract/schemas";
import { ApiError, type ApiClient } from "./types";

type Method = "GET" | "POST" | "PUT" | "PATCH";

export class LiveApiClient implements ApiClient {
  readonly mode = "live" as const;
  private csrfToken: string | null = null;

  constructor(private readonly base: string = process.env.NEXT_PUBLIC_API_BASE || "/api") {}

  private async call<T extends z.ZodType>(
    schema: T,
    method: Method,
    path: string,
    opts: { body?: unknown; idempotencyKey?: string; csrf?: boolean } = {},
  ): Promise<z.infer<T>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.csrf) {
      if (!this.csrfToken) await this.getSession();
      if (this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    }
    if (opts.idempotencyKey) headers["Idempotency-Key"] = S.IdempotencyKeyHeader.parse(opts.idempotencyKey);

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      credentials: "include",
      cache: "no-store",
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const parsed = S.ApiErrorBody.safeParse(json);
      throw new ApiError(
        res.status,
        parsed.success ? parsed.data : { code: "INTERNAL", message: `Unexpected ${res.status} response from backend.` },
      );
    }
    return schema.parse(json);
  }

  getHealth() {
    return this.call(S.Health, "GET", "/health");
  }

  async createDemoSession(context: S.SessionContext) {
    // Bootstrap exception: no CSRF token and no Idempotency-Key (Origin is sent by the browser).
    const s = await this.call(S.Session, "POST", "/session/demo", { body: S.DemoSessionRequest.parse({ context }) });
    this.csrfToken = s.csrfToken;
    return s;
  }

  async getSession() {
    const s = await this.call(S.Session, "GET", "/session");
    this.csrfToken = s.csrfToken;
    return s;
  }

  createAgent(body: { name: string; policy: S.PolicyRules }, idempotencyKey: string) {
    return this.call(S.Agent, "POST", "/agents", { body: S.AgentCreate.parse(body), idempotencyKey, csrf: true });
  }

  getAgent(agentId: string) {
    return this.call(S.Agent, "GET", `/agents/${encodeURIComponent(S.AgentIdParam.parse(agentId))}`);
  }

  setAgentStatus(agentId: string, status: S.AgentStatus) {
    return this.call(S.Agent, "PATCH", `/agents/${encodeURIComponent(S.AgentIdParam.parse(agentId))}`, {
      body: S.AgentPatch.parse({ status }),
      csrf: true,
    });
  }

  getPolicy(agentId: string) {
    return this.call(S.Policy, "GET", `/agents/${encodeURIComponent(S.AgentIdParam.parse(agentId))}/policy`);
  }

  putPolicy(agentId: string, body: S.PolicyUpdate) {
    return this.call(S.Policy, "PUT", `/agents/${encodeURIComponent(S.AgentIdParam.parse(agentId))}/policy`, {
      body: S.PolicyUpdate.parse(body),
      csrf: true,
    });
  }

  requestPayment(body: S.PaymentRequestCreate, idempotencyKey: string) {
    return this.call(S.Payment, "POST", "/payments/request", {
      body: S.PaymentRequestCreate.parse(body),
      idempotencyKey,
      csrf: true,
    });
  }

  listPayments(params: { status?: S.PaymentStatus; cursor?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.cursor) q.set("cursor", params.cursor);
    if (params.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return this.call(S.PaymentList, "GET", `/payments${qs ? `?${qs}` : ""}`);
  }

  getPayment(paymentId: string) {
    return this.call(S.Payment, "GET", `/payments/${encodeURIComponent(S.PaymentIdParam.parse(paymentId))}`);
  }

  executePayment(paymentId: string, idempotencyKey: string) {
    return this.call(S.Payment, "POST", `/payments/${encodeURIComponent(S.PaymentIdParam.parse(paymentId))}/execute`, {
      idempotencyKey,
      csrf: true,
    });
  }

  getVerification(paymentId: string) {
    return this.call(
      S.Verification,
      "GET",
      `/payments/${encodeURIComponent(S.PaymentIdParam.parse(paymentId))}/verification`,
    );
  }

  acknowledgePayment(paymentId: string, body: { note?: string }, idempotencyKey: string) {
    return this.call(
      S.Acknowledgment,
      "POST",
      `/payments/${encodeURIComponent(S.PaymentIdParam.parse(paymentId))}/acknowledgment`,
      { body: S.AcknowledgmentCreate.parse(body), idempotencyKey, csrf: true },
    );
  }

  createInvoice(body: S.InvoiceCreate, idempotencyKey: string) {
    return this.call(S.Invoice, "POST", "/merchant/invoices", {
      body: S.InvoiceCreate.parse(body),
      idempotencyKey,
      csrf: true,
    });
  }

  listInvoices() {
    return this.call(S.InvoiceList, "GET", "/merchant/invoices");
  }
}
