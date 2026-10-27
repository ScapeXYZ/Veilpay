import type {
  Acknowledgment,
  AccountRegister,
  Agent,
  AgentCredentialIssued,
  AgentCredentialList,
  AgentList,
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
import type { z } from "zod";

export type ApiMode = "mock" | "live";

/** One method per OpenAPI v1.1 operation. Nothing outside the contract. */
export interface ApiClient {
  readonly mode: ApiMode;
  getHealth(): Promise<Health>;
  registerAccount(body: z.infer<typeof AccountRegister>): Promise<Session>;
  createDemoSession(context: SessionContext): Promise<Session>;
  getSession(): Promise<Session>;
  /** Revokes the current server session and clears its HttpOnly cookie. */
  logout(): Promise<Session>;
  listAgents(): Promise<z.infer<typeof AgentList>>;
  createAgent(body: { name: string; policy: PolicyRules }, idempotencyKey: string): Promise<Agent>;
  getAgent(agentId: string): Promise<Agent>;
  listAgentCredentials(agentId: string): Promise<z.infer<typeof AgentCredentialList>>;
  createAgentCredential(agentId: string): Promise<z.infer<typeof AgentCredentialIssued>>;
  revokeAgentCredential(agentId: string, credentialId: string): Promise<void>;
  rotateAgentCredential(agentId: string, credentialId: string): Promise<z.infer<typeof AgentCredentialIssued>>;
  deleteAgentIntegrationActivity(agentId: string): Promise<z.infer<typeof import("@/lib/contract/schemas").AgentIntegrationActivityDeletion>>;
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
