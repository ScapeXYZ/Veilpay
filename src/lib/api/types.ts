import type {
  Acknowledgment,
  Agent,
  AgentStatus,
  ApiErrorBody,
  Health,
  Invoice,
  InvoiceCreate,
  InvoiceList,
  Payment,
  PaymentList,
  PaymentRequestCreate,
  PaymentStatus,
  Policy,
  PolicyRules,
  PolicyUpdate,
  Session,
  SessionContext,
  Verification,
} from "@/lib/contract/schemas";

export type ApiMode = "mock" | "live";

/** One method per OpenAPI v1.1 operation. Nothing outside the contract. */
export interface ApiClient {
  readonly mode: ApiMode;
  getHealth(): Promise<Health>;
  createDemoSession(context: SessionContext): Promise<Session>;
  getSession(): Promise<Session>;
  createAgent(body: { name: string; policy: PolicyRules }, idempotencyKey: string): Promise<Agent>;
  getAgent(agentId: string): Promise<Agent>;
  setAgentStatus(agentId: string, status: AgentStatus): Promise<Agent>;
  getPolicy(agentId: string): Promise<Policy>;
  putPolicy(agentId: string, body: PolicyUpdate): Promise<Policy>;
  requestPayment(body: PaymentRequestCreate, idempotencyKey: string): Promise<Payment>;
  listPayments(params?: { status?: PaymentStatus; cursor?: string; limit?: number }): Promise<PaymentList>;
  getPayment(paymentId: string): Promise<Payment>;
  executePayment(paymentId: string, idempotencyKey: string): Promise<Payment>;
  getVerification(paymentId: string): Promise<Verification>;
  acknowledgePayment(paymentId: string, body: { note?: string }, idempotencyKey: string): Promise<Acknowledgment>;
  createInvoice(body: InvoiceCreate, idempotencyKey: string): Promise<Invoice>;
  listInvoices(): Promise<InvoiceList>;
  getInvoice(invoiceId: string): Promise<Invoice>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function newIdempotencyKey(): string {
  return `idem_${crypto.randomUUID()}`;
}
