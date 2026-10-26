/**
 * MOCK backend: an in-process stand-in for the VeilPay backend, implementing the same
 * ApiClient interface as the live client. It simulates server-side behaviour described in
 * the v1.1 contract (policy evaluation, budget reservation, idempotency, single-send execute,
 * role separation) so the UI can be exercised end to end without a wallet.
 *
 * Rules:
 * - Every response is parsed through the contract Zod schema before it is returned.
 * - No chain data is ever produced: txid null, pool null, mockRef set, Verification.method "mock".
 * - Confirmations only move when the reviewer presses a clearly labelled mock control.
 * - State lives in memory only (reload = reset). Nothing is written to storage.
 */
import type { z } from "zod";
import * as S from "@/lib/contract/schemas";
import { addZat, cmpZat, fromBig, subZatFloor, toBig } from "@/lib/zat";
import {
  AGENT_ID,
  AGENT_NAME,
  MERCHANT_ID,
  MERCHANT_NAME,
  PRIVACY_LENS,
  seedHealth,
  seedInvoices,
  seedPayments,
  seedPolicy,
  seedVerificationOverrides,
} from "./fixtures";
import { ApiError, type ApiClient } from "./types";

type Ctx = S.SessionContext;

export interface MockControls {
  /** Simulate the next backend/chain event for a payment (mock only, labelled in the UI). */
  advance(paymentId: string): Promise<void>;
  /** Simulate a shallow reorg: a confirming/confirmed payment drops back to confirming at 0 confirmations (mock only). */
  reorg(paymentId: string): Promise<void>;
  setDeepReorgAlert(on: boolean): void;
  reset(): void;
  /** Payment ids addressed to the demo merchant (mock-only discovery, see docs/contract-changes.md #1). */
  merchantPaymentIds(): string[];
}

function err(status: number, code: S.ErrorCode, message: string): never {
  throw new ApiError(status, S.ApiErrorBody.parse({ code, message, requestId: `req_mock_${Date.now()}` }));
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

let seq = 0;
function mockId(prefix: string): string {
  seq += 1;
  return `${prefix}_mock${Date.now().toString(36)}${String(seq).padStart(4, "0")}`;
}

export class MockApiClient implements ApiClient, MockControls {
  readonly mode = "mock" as const;
  private latencyMs: number;
  private now: () => Date;
  private session: S.Session | null = null;
  private health!: S.Health;
  private policy!: S.Policy;
  private agentStatus!: S.AgentStatus;
  private agentCreatedAt!: string;
  private payments!: S.Payment[];
  private invoices!: S.Invoice[];
  private verificationOverrides!: Record<string, Partial<S.Verification>>;
  private acknowledged!: Map<string, S.Acknowledgment>;
  private idem!: Map<string, { bodyKey: string; result: unknown }>;

  constructor(opts: { latencyMs?: number; now?: () => Date } = {}) {
    this.latencyMs = opts.latencyMs ?? 120;
    this.now = opts.now ?? (() => new Date());
    this.reset();
  }

  reset() {
    this.health = seedHealth();
    this.policy = seedPolicy();
    this.agentStatus = "active";
    this.agentCreatedAt = "2026-10-20T08:00:00.000Z";
    this.payments = seedPayments();
    this.invoices = seedInvoices();
    this.verificationOverrides = seedVerificationOverrides();
    this.acknowledged = new Map();
    this.idem = new Map();
    // the session is kept across a scenario reset so the reviewer is not logged out
  }

  // ---------- helpers ----------

  private async respond<T extends z.ZodType>(schema: T, value: unknown): Promise<z.infer<T>> {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    return schema.parse(clone(value));
  }

  private iso() {
    return this.now().toISOString();
  }

  private requireCtx(ctx: Ctx) {
    if (!this.session) err(401, "UNAUTHENTICATED", "No demo session. Start one first.");
    if (this.session.context !== ctx) err(403, "WRONG_CONTEXT", `This action needs the ${ctx} context.`);
  }

  private idempotent<T>(op: string, key: string, body: unknown, run: () => T): T {
    S.IdempotencyKeyHeader.parse(key);
    const scope = `${this.session?.context}:${op}:${key}`;
    const bodyKey = JSON.stringify(body ?? null);
    const hit = this.idem.get(scope);
    if (hit) {
      if (hit.bodyKey !== bodyKey) err(409, "IDEMPOTENCY_MISMATCH", "This Idempotency-Key was used with a different request.");
      if (hit.result instanceof ApiError) throw hit.result;
      return clone(hit.result) as T;
    }
    try {
      const result = run();
      this.idem.set(scope, { bodyKey, result: clone(result) });
      return result;
    } catch (e) {
      // Errors replay too, except a pre-transition WALLET_UNAVAILABLE (contract: not cached).
      if (e instanceof ApiError && e.body.code !== "WALLET_UNAVAILABLE") this.idem.set(scope, { bodyKey, result: e });
      throw e;
    }
  }

  private usage(): S.PolicyUsage {
    let spent = 0n;
    let reserved = 0n;
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    for (const p of this.payments) {
      const amt = toBig(p.amountZat);
      if (p.status === "confirmed") {
        spent += amt;
        approved += 1;
      } else if (p.status === "authorized" || p.status === "submitted" || p.status === "confirming") {
        reserved += amt;
        pending += 1;
      } else if (p.status === "rejected") {
        rejected += 1;
      }
    }
    const budget = toBig(this.policy.totalBudgetZat);
    const used = spent + reserved;
    return {
      spentZat: fromBig(spent),
      reservedZat: fromBig(reserved),
      remainingZat: fromBig(used > budget ? 0n : budget - used),
      approvedCount: approved,
      rejectedCount: rejected,
      pendingCount: pending,
    };
  }

  private agent(): S.Agent {
    return {
      id: AGENT_ID,
      name: AGENT_NAME,
      status: this.agentStatus,
      policy: this.policy,
      usage: this.usage(),
      createdAt: this.agentCreatedAt,
    };
  }

  private findPayment(id: string): S.Payment {
    const p = this.payments.find((x) => x.id === id);
    if (!p) err(404, "NOT_FOUND", "Payment not found.");
    return p;
  }

  /** Server-side policy evaluation (simulated). The UI never runs this; it only renders the Decision. */
  private evaluate(amountZat: string, invoice: S.Invoice | undefined, ownReservation: string): S.Violation[] {
    const v: S.Violation[] = [];
    if (this.agentStatus === "paused") {
      v.push({ code: "AGENT_PAUSED", message: "Payment blocked: this agent is paused by its owner." });
    }
    if (!invoice || invoice.status !== "open") {
      v.push({ code: "INVOICE_NOT_PAYABLE", message: "Payment blocked: the invoice is not open for payment." });
    } else {
      if (!this.policy.allowedMerchantIds.includes(invoice.merchantId)) {
        v.push({ code: "MERCHANT_NOT_ALLOWED", message: "Payment blocked: this merchant is not on the agent's allowlist." });
      }
      if (cmpZat(amountZat, invoice.amountZat) !== 0) {
        v.push({
          code: "AMOUNT_MISMATCH",
          message: "Payment blocked: the amount does not match the invoice.",
          requestedZat: amountZat,
        });
      }
    }
    if (cmpZat(amountZat, this.policy.perTxLimitZat) > 0) {
      v.push({
        code: "CAP_EXCEEDED",
        message: "Payment blocked: requested amount exceeds the authorized transaction limit.",
        limitZat: this.policy.perTxLimitZat,
        requestedZat: amountZat,
      });
    }
    const u = this.usage();
    const reservedOther = subZatFloor(u.reservedZat, ownReservation);
    if (cmpZat(addZat(u.spentZat, reservedOther, amountZat), this.policy.totalBudgetZat) > 0) {
      v.push({
        code: "BUDGET_EXCEEDED",
        message: "Payment blocked: this would exceed the agent's total budget.",
        limitZat: subZatFloor(this.policy.totalBudgetZat, addZat(u.spentZat, reservedOther)),
        requestedZat: amountZat,
      });
    }
    return v;
  }

  private decision(result: "authorized" | "rejected", violations: S.Violation[]): S.Decision {
    return {
      id: mockId("dec"),
      result,
      policyVersion: this.policy.version,
      evaluatedAt: this.iso(),
      violations,
      auditHash: `mock-audit-${Math.random().toString(16).slice(2, 10)}`,
    };
  }

  private verificationFor(p: S.Payment): S.Verification {
    const inv = this.invoices.find((i) => i.id === p.invoiceId);
    const required = this.health.confirmationsRequired;
    const base: S.Verification = {
      paymentId: p.id,
      invoiceId: p.invoiceId,
      reference: inv?.reference ?? p.reference,
      state: "not_seen",
      expectedZat: inv?.amountZat ?? p.amountZat,
      confirmations: 0,
      confirmationsRequired: required,
      method: "mock",
      checkedAt: this.iso(),
      mock: true,
    };
    if (p.status === "confirmed") {
      base.state = "received";
      base.receivedZat = p.amountZat;
      base.confirmations = p.confirmations ?? required;
    } else if (p.status === "confirming" || p.status === "submitted") {
      base.state = "pending";
      base.confirmations = p.confirmations ?? 0;
      if (p.status === "confirming") base.receivedZat = p.amountZat;
    } else if (p.status === "expired") {
      base.state = "expired";
    }
    return { ...base, ...this.verificationOverrides[p.id], checkedAt: this.iso() };
  }

  // ---------- ApiClient (one method per contract operation) ----------

  async getHealth() {
    return this.respond(S.Health, this.health);
  }

  async createDemoSession(context: Ctx) {
    S.DemoSessionRequest.parse({ context });
    this.session = {
      authenticated: true,
      context,
      agentId: context === "customer" ? AGENT_ID : null,
      merchantId: context === "merchant" ? MERCHANT_ID : null,
      expiresAt: new Date(this.now().getTime() + 8 * 3600_000).toISOString(),
      csrfToken: `mock-csrf-${Math.random().toString(36).slice(2, 12)}`,
    };
    return this.respond(S.Session, this.session);
  }

  async registerAccount(_body: z.infer<typeof S.AccountRegister>) {
    // Explicitly fixture-only: live registration always goes to Rust.
    void _body;
    return this.createDemoSession("customer");
  }

  async getSession() {
    if (!this.session) err(401, "UNAUTHENTICATED", "No demo session.");
    return this.respond(S.Session, this.session);
  }

  async createAgent(body: { name: string; policy: S.PolicyRules }, idempotencyKey: string): Promise<S.Agent> {
    this.requireCtx("customer");
    S.AgentCreate.parse(body);
    // The seeded demo has exactly one agent; registering another is out of scope for the mock.
    return this.idempotent("createAgent", idempotencyKey, body, () =>
      err(409, "INVALID_TRANSITION", "The demo session already has its seeded agent."),
    );
  }

  async listAgents() {
    this.requireCtx("customer");
    return this.respond(S.AgentList, { items: [this.agent()] });
  }

  async getAgent(agentId: string) {
    this.requireCtx("customer");
    if (agentId !== AGENT_ID) err(404, "NOT_FOUND", "Agent not found.");
    return this.respond(S.Agent, this.agent());
  }

  async setAgentStatus(agentId: string, status: S.AgentStatus) {
    this.requireCtx("customer");
    if (agentId !== AGENT_ID) err(404, "NOT_FOUND", "Agent not found.");
    this.agentStatus = S.AgentStatus.parse(status);
    return this.respond(S.Agent, this.agent());
  }

  async getPolicy(agentId: string) {
    this.requireCtx("customer");
    if (agentId !== AGENT_ID) err(404, "NOT_FOUND", "Agent not found.");
    return this.respond(S.Policy, this.policy);
  }

  async putPolicy(agentId: string, body: S.PolicyUpdate) {
    this.requireCtx("customer");
    if (agentId !== AGENT_ID) err(404, "NOT_FOUND", "Agent not found.");
    const b = S.PolicyUpdate.parse(body);
    if (b.expectedVersion !== this.policy.version) {
      err(409, "VERSION_CONFLICT", "The policy changed since you loaded it. Reload and try again.");
    }
    const { expectedVersion: _ignored, ...rules } = b;
    void _ignored;
    this.policy = { ...rules, version: this.policy.version + 1, updatedAt: this.iso() };
    return this.respond(S.Policy, this.policy);
  }

  async requestPayment(body: S.PaymentRequestCreate, idempotencyKey: string) {
    this.requireCtx("customer");
    const b = S.PaymentRequestCreate.parse(body);
    if (b.agentId !== AGENT_ID) err(404, "NOT_FOUND", "Agent not found.");
    const result = this.idempotent("requestPayment", idempotencyKey, b, () => {
      const invoice = this.invoices.find((i) => i.id === b.invoiceId);
      const violations = this.evaluate(b.amountZat, invoice, "0");
      const ok = violations.length === 0;
      const t = this.iso();
      const p: S.Payment = {
        id: mockId("pay"),
        agentId: b.agentId,
        merchantId: invoice?.merchantId ?? "mer_unknown0001",
        merchantName: invoice?.merchantId === MERCHANT_ID ? MERCHANT_NAME : undefined,
        invoiceId: b.invoiceId,
        amountZat: b.amountZat,
        reference: b.reference,
        status: ok ? "authorized" : "rejected",
        decision: this.decision(ok ? "authorized" : "rejected", violations),
        timeline: [
          { status: "requested", kind: "status", at: t },
          { status: ok ? "authorized" : "rejected", kind: "status", at: t },
        ],
        pool: null,
        txid: null,
        confirmations: 0,
        failure: null,
        expiresAt: new Date(this.now().getTime() + (this.policy.requestTtlSeconds ?? 900) * 1000).toISOString(),
        createdAt: t,
        privacy: PRIVACY_LENS,
        mockRef: null,
        walletOperation: null,
      };
      this.payments.unshift(p);
      return p;
    });
    return this.respond(S.Payment, result);
  }

  async listPayments(params: { status?: S.PaymentStatus; cursor?: string; limit?: number } = {}) {
    this.requireCtx("customer");
    const items = this.payments.filter((p) => !params.status || p.status === params.status);
    return this.respond(S.PaymentList, { items: items.slice(0, params.limit ?? 50), nextCursor: null });
  }

  async getPayment(paymentId: string) {
    this.requireCtx("customer");
    return this.respond(S.Payment, this.findPayment(paymentId));
  }

  async executePayment(paymentId: string, idempotencyKey: string) {
    this.requireCtx("customer");
    const result = this.idempotent(`execute:${paymentId}`, idempotencyKey, null, () => {
      const p = this.findPayment(paymentId);
      // Different-key duplicate of an execute that already won: 202 with current state, never a second send.
      if (p.status === "submitted" || p.status === "confirming" || p.status === "confirmed") return clone(p);
      if (p.status !== "authorized") err(409, "INVALID_TRANSITION", `Only an authorized payment can be executed (this one is ${p.status}).`);
      // Re-check at execute, reusing this payment's own reservation (BUDGET RESERVATION).
      const violations = this.evaluate(p.amountZat, this.invoices.find((i) => i.id === p.invoiceId), p.amountZat);
      const t = this.iso();
      if (violations.length > 0) {
        p.status = "rejected";
        p.decision = this.decision("rejected", violations);
        p.timeline.push({ status: "rejected", kind: "status", at: t, note: "Re-checked at execute against the current policy." });
        err(409, "POLICY_REJECTED", violations[0].message);
      }
      p.status = "submitted";
      p.mockRef = `mock_${crypto.randomUUID().replaceAll("-", "")}`;
      p.walletOperation = { id: mockId("wop"), state: "broadcast", attempt: 1, lastReconciledAt: null, needsOperator: false };
      p.timeline.push({ status: "submitted", kind: "status", at: t, note: "Mock wallet accepted the send. No chain transaction exists." });
      return clone(p);
    });
    return this.respond(S.Payment, result);
  }

  async getVerification(paymentId: string) {
    this.requireCtx("merchant");
    const p = this.payments.find((x) => x.id === paymentId);
    if (!p || p.merchantId !== MERCHANT_ID) err(404, "NOT_FOUND", "Payment not found.");
    return this.respond(S.Verification, this.verificationFor(p));
  }

  async acknowledgePayment(paymentId: string, body: { note?: string }, idempotencyKey: string) {
    this.requireCtx("merchant");
    const b = S.AcknowledgmentCreate.parse(body);
    const result = this.idempotent(`ack:${paymentId}`, idempotencyKey, b, () => {
      const p = this.payments.find((x) => x.id === paymentId);
      if (!p || p.merchantId !== MERCHANT_ID) err(404, "NOT_FOUND", "Payment not found.");
      if (this.acknowledged.has(paymentId)) err(409, "ALREADY_ACKNOWLEDGED", "This payment was already acknowledged.");
      const v = this.verificationFor(p);
      if (v.state === "amount_mismatch") err(409, "AMOUNT_MISMATCH", "The received amount does not match the invoice.");
      const lateOk =
        v.state === "late" && v.confirmations >= v.confirmationsRequired && !!v.receivedZat && v.receivedZat === v.expectedZat;
      if (v.state !== "received" && !lateOk) err(409, "NOT_YET_RECEIVED", "Receipt is not verified yet.");
      const ack: S.Acknowledgment = {
        paymentId,
        merchantId: MERCHANT_ID,
        at: this.iso(),
        note: b.note,
        signature: `mock-signature-${Math.random().toString(16).slice(2, 14)}`,
        statementType: "merchant_acknowledgment_simulation_not_settlement_proof",
      };
      this.acknowledged.set(paymentId, ack);
      return ack;
    });
    return this.respond(S.Acknowledgment, result);
  }

  async createInvoice(body: S.InvoiceCreate, idempotencyKey: string) {
    this.requireCtx("merchant");
    const b = S.InvoiceCreate.parse(body);
    const result = this.idempotent("createInvoice", idempotencyKey, b, () => {
      const inv: S.Invoice = {
        id: mockId("inv"),
        merchantId: MERCHANT_ID,
        reference: b.reference,
        amountZat: b.amountZat,
        payTo: "mock-address-not-on-chain",
        status: "open",
        createdAt: this.iso(),
        expiresAt: b.expiresAt ?? new Date(this.now().getTime() + 3600_000).toISOString(),
      };
      inv.paymentPayload = { format: "veilpay-mock-v1", uri: `veilpay-mock:${inv.id}?amountZat=${inv.amountZat}`, mock: true, spendable: false };
      this.invoices.unshift(inv);
      return inv;
    });
    return this.respond(S.Invoice, result);
  }

  async listInvoices() {
    this.requireCtx("merchant");
    return this.respond(S.InvoiceList, { items: this.invoices });
  }

  async getInvoice(invoiceId: string) {
    this.requireCtx("merchant");
    const invoice = this.invoices.find((item) => item.id === invoiceId && item.merchantId === MERCHANT_ID);
    if (!invoice) err(404, "NOT_FOUND", "Invoice not found.");
    if (invoice.status === "open" && invoice.expiresAt && Date.parse(invoice.expiresAt) <= this.now().getTime()) invoice.status = "expired";
    return this.respond(S.Invoice, invoice);
  }

  // ---------- MockControls (never part of the live client) ----------

  async advance(paymentId: string) {
    const p = this.findPayment(paymentId);
    const t = this.iso();
    const required = this.health.confirmationsRequired;
    if (p.status === "submitted" && p.failure?.code !== "OUTCOME_UNKNOWN") {
      p.status = "confirming";
      p.confirmations = 0;
      p.timeline.push({ status: "confirming", kind: "status", at: t, note: "Mock event: simulated, no chain read." });
    } else if (p.status === "confirming") {
      p.confirmations = (p.confirmations ?? 0) + 1;
      if (p.confirmations >= required) {
        p.status = "confirmed";
        if (p.walletOperation) p.walletOperation = { ...p.walletOperation, state: "mined" };
        p.timeline.push({ status: "confirmed", kind: "status", at: t, note: "Mock event: simulated confirmation counter." });
        const inv = this.invoices.find((i) => i.id === p.invoiceId);
        if (inv && inv.status === "open") inv.status = "paid";
      }
    }
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async reorg(paymentId: string) {
    const p = this.findPayment(paymentId);
    if (p.status !== "confirmed" && p.status !== "confirming") return;
    const wasConfirmed = p.status === "confirmed";
    p.status = "confirming";
    p.confirmations = 0;
    if (p.walletOperation) p.walletOperation = { ...p.walletOperation, state: "broadcast" };
    p.timeline.push({ status: "confirming", kind: "reorg", at: this.iso(), note: "Mock event: block dropped from the best chain; confirmations recounted." });
    // spent goes back to reserved exactly once: usage is derived from status, so confirmed -> confirming moves it.
    if (wasConfirmed) {
      const inv = this.invoices.find((i) => i.id === p.invoiceId);
      if (inv && inv.status === "paid") inv.status = "open";
    }
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  setDeepReorgAlert(on: boolean) {
    this.health = { ...this.health, chainWatcher: { ...this.health.chainWatcher, deepReorgAlert: on } };
  }

  merchantPaymentIds() {
    return this.payments.filter((p) => p.merchantId === MERCHANT_ID && p.status !== "rejected").map((p) => p.id);
  }
}
