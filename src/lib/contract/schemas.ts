/**
 * Zod schemas for the latest reviewed VeilPay OpenAPI integration contract.
 *
 * Hand-written, one schema per `components/schemas` entry. `contract-sync.test.ts`
 * parses the YAML and fails if any required field, enum value, or property name
 * drifts from the contract, so these cannot silently diverge.
 *
 * Every response from the API (live or mock) is parsed through these schemas.
 */
import { z } from "zod";

const dateTime = z.iso.datetime({ offset: true });

/** Integer zatoshi as a decimal string. 1 ZEC = "100000000". */
export const Zatoshi = z.string().regex(/^(0|[1-9][0-9]{0,15})$/, "zatoshi must be an integer string");

export const Health = z.object({
  status: z.enum(["ok", "degraded", "down"]),
  network: z.enum(["testnet", "regtest", "mainnet"]),
  wallet: z.enum(["ready", "syncing", "unavailable", "broadcast_disabled", "operator_required"]),
  walletBackend: z.enum(["zingolib", "zingo", "zingo-cli", "zallet", "mock"]),
  chainHeight: z.number().int().nullable(),
  confirmationsRequired: z.number().int().min(1),
  mode: z.enum(["real", "mock", "disabled", "testnet_manual"]),
  reconciler: z.object({
    lastRunAt: dateTime.nullable(),
    unresolved: z.number().int(),
  }),
  chainWatcher: z.object({
    /** false = no independent header watcher; other fields then assert nothing about chain safety. */
    supported: z.boolean().optional(),
    lastBlockAt: dateTime.nullable(),
    watchDepth: z.number().int(),
    deepReorgAlert: z.boolean(),
  }),
});

/** Operator-only observation boundary. It is deliberately not exposed by the customer UI. */
export const MainnetReadOnlySnapshot = z.object({
  network: z.literal("mainnet"),
  address: z.string(),
  availableZat: Zatoshi,
  sync: z.object({
    walletReportedHeight: z.number().int().min(1),
    stale: z.literal(false),
  }),
  chainEvidence: z.object({
    trusted: z.literal(false),
    height: z.null(),
    reason: z.string(),
  }),
  observations: z.array(z.object({
    txid: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["confirmed", "mempool", "transmitted", "calculated", "failed"]),
    blockHeight: z.number().int().min(0),
    confirmations: z.number().int().min(0),
  })),
});

export const SessionContext = z.enum(["customer", "merchant"]);
export const AccountType = z.enum(["individual", "freelancer", "merchant", "team", "business"]);

export const Session = z.object({
  authenticated: z.boolean().default(true),
  context: SessionContext.nullable(),
  accountId: z.string().nullable().optional(),
  accountType: AccountType.nullable().optional(),
  agentId: z.string().nullable().optional(),
  merchantId: z.string().nullable().optional(),
  expiresAt: dateTime.nullable(),
  csrfToken: z.string().nullable(),
});

export const AccountRegister = z.object({
  displayName: z.string().min(1).max(64),
  accountType: AccountType,
});

export const DemoSessionRequest = z.object({ context: SessionContext });

export const AgentStatus = z.enum(["active", "paused"]);

export const PolicyRules = z.object({
  perTxLimitZat: Zatoshi,
  totalBudgetZat: Zatoshi,
  allowedMerchantIds: z.array(z.string()).min(1),
  requestTtlSeconds: z.number().int().min(30).max(86400).optional(),
  /** Once elapsed, the backend rejects every new request under this policy. */
  expiresAt: dateTime.optional(),
});

export const Policy = PolicyRules.extend({
  version: z.number().int().min(1),
  updatedAt: dateTime,
});

export const PolicyUpdate = PolicyRules.extend({
  expectedVersion: z.number().int().min(1),
});

export const PolicyUsage = z.object({
  spentZat: Zatoshi,
  reservedZat: Zatoshi,
  remainingZat: Zatoshi,
  approvedCount: z.number().int(),
  rejectedCount: z.number().int(),
  pendingCount: z.number().int(),
});

export const AgentCreate = z.object({
  name: z.string().max(64),
  policy: PolicyRules,
});

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  status: AgentStatus,
  policy: Policy,
  usage: PolicyUsage,
  createdAt: dateTime,
});
export const AgentList = z.object({ items: z.array(Agent) });

export const AgentPatch = z.object({ status: AgentStatus });

export const PaymentRequestCreate = z.object({
  agentId: z.string(),
  invoiceId: z.string(),
  amountZat: Zatoshi,
  reference: z.string().max(64),
  expiresAt: dateTime.optional(),
});

export const PaymentStatus = z.enum([
  "requested",
  "rejected",
  "authorized",
  "submitted",
  "confirming",
  "confirmed",
  "failed",
  "expired",
]);

export const ViolationCode = z.enum([
  "CAP_EXCEEDED",
  "BUDGET_EXCEEDED",
  "MERCHANT_NOT_ALLOWED",
  "AGENT_PAUSED",
  "REQUEST_EXPIRED",
  "AMOUNT_MISMATCH",
  "INVOICE_NOT_PAYABLE",
  "POLICY_VERSION_CHANGED",
  "POLICY_EXPIRED",
]);

export const Violation = z.object({
  code: ViolationCode,
  message: z.string(),
  limitZat: Zatoshi.optional(),
  requestedZat: Zatoshi.optional(),
});

export const Decision = z.object({
  id: z.string(),
  result: z.enum(["authorized", "rejected"]),
  policyVersion: z.number().int(),
  evaluatedAt: dateTime,
  violations: z.array(Violation),
  auditHash: z.string(),
});

export const TimelineEvent = z.object({
  status: PaymentStatus,
  at: dateTime,
  note: z.string().optional(),
  kind: z.enum(["status", "reorg", "reconciled", "policy_changed", "agent_paused", "late_receipt", "verification", "wallet"]),
});

export const FailureCode = z.enum([
  "REJECTED_BY_WALLET_PRE_BROADCAST",
  "INSUFFICIENT_FUNDS",
  "BROADCAST_REJECTED",
  "EXPIRED_UNMINED",
  "OUTCOME_UNKNOWN",
  "WALLET_BROADCAST_DISABLED",
]);

export const Failure = z.object({
  code: FailureCode,
  message: z.string().optional(),
  retriable: z.boolean(),
  definitive: z.boolean(),
});

export const PrivacyLens = z.object({
  publicChainSees: z.array(z.string()).optional(),
  hiddenOnChain: z.array(z.string()).optional(),
  merchantSees: z.array(z.string()).optional(),
  customerSees: z.array(z.string()).optional(),
});

export const WalletOperationState = z.enum([
  "pending",
  "broadcast",
  "mined",
  "final",
  "failed_definitive",
  "unknown",
]);

export const WalletOperation = z
  .object({
    id: z.string(),
    state: WalletOperationState,
    attempt: z.literal(1),
    lastReconciledAt: dateTime.nullable().optional(),
    requiresOperatorConfirmation: z.boolean().optional(),
    phase: z.enum(["awaiting_operator", "preparing", "prepared", "submitting", "observing"]).optional(),
    feeZat: Zatoshi.optional(),
    needsOperator: z.boolean(),
  })
  .nullable();

export const Payment = z.object({
  id: z.string(),
  agentId: z.string(),
  merchantId: z.string(),
  merchantName: z.string().optional(),
  invoiceId: z.string(),
  amountZat: Zatoshi,
  reference: z.string(),
  status: PaymentStatus,
  decision: Decision,
  timeline: z.array(TimelineEvent),
  pool: z.enum(["orchard", "sapling"]).nullable().optional(),
  confirmations: z.number().int().min(0).optional(),
  txid: z.string().nullable().optional(),
  failure: Failure.nullable().optional(),
  expiresAt: dateTime.optional(),
  createdAt: dateTime,
  privacy: PrivacyLens.optional(),
  /** Generated mock references are visibly non-txid identifiers. */
  mockRef: z.string().regex(/^mock_[0-9a-f]{32}$/).nullable().optional(),
  walletOperation: WalletOperation.optional(),
});

export const PaymentList = z.object({
  items: z.array(Payment),
  nextCursor: z.string().nullable().optional(),
});

/** Demo payload: never a wallet request, never rendered as a QR. */
export const MockPaymentPayload = z.object({
  format: z.literal("veilpay-mock-v1"),
  uri: z.string(),
  mock: z.literal(true),
  spendable: z.literal(false),
});

/** Real testnet ZIP-321 request. The UI still re-validates address, amount and network before any QR. */
export const Zip321PaymentPayload = z.object({
  format: z.literal("zip321"),
  uri: z.string(),
  network: z.literal("testnet"),
  mock: z.literal(false),
  spendable: z.literal(true),
});

export const Invoice = z.object({
  id: z.string(),
  merchantId: z.string(),
  reference: z.string(),
  amountZat: Zatoshi,
  payTo: z.string().optional(),
  network: z.enum(["testnet"]).optional(),
  paymentPayload: z.discriminatedUnion("format", [MockPaymentPayload, Zip321PaymentPayload]).optional(),
  status: z.enum(["open", "paid", "paid_late", "expired"]),
  expiresAt: dateTime.optional(),
  createdAt: dateTime,
});

export const InvoiceCreate = z.object({
  reference: z.string().min(1).max(64),
  amountZat: Zatoshi.refine((value) => BigInt(value) >= 1n && BigInt(value) <= 2100000000000000n, "Amount must be 1 to 2100000000000000 zatoshis"),
  expiresAt: dateTime.optional(),
});

export const InvoiceList = z.object({
  items: z.array(Invoice).optional(),
});

export const VerificationState = z.enum([
  "not_seen",
  "pending",
  "received",
  "late",
  "amount_mismatch",
  "expired",
  "underpaid",
  "duplicate",
  "conflicting",
  "reorged",
]);

export const Verification = z.object({
  paymentId: z.string(),
  invoiceId: z.string(),
  reference: z.string().optional(),
  state: VerificationState,
  expectedZat: Zatoshi.optional(),
  receivedZat: Zatoshi.optional(),
  confirmations: z.number().int(),
  confirmationsRequired: z.number().int(),
  method: z.enum(["merchant_ivk_scan", "merchant_wallet_scan", "mock"]),
  checkedAt: dateTime,
  mock: z.boolean(),
  late: z.boolean().optional(),
  network: z.enum(["testnet"]).optional(),
  txid: z.string().nullable().optional(),
  blockHeight: z.number().int().optional(),
  tipHeight: z.number().int().optional(),
  acknowledgmentEligible: z.boolean().optional(),
  acknowledgmentValid: z.boolean().optional(),
});

export const AcknowledgmentCreate = z.object({ note: z.string().max(280).optional() });

export const Acknowledgment = z.object({
  paymentId: z.string(),
  merchantId: z.string(),
  at: dateTime,
  note: z.string().optional(),
  signature: z.string(),
  evidence: Verification.optional(),
  statementType: z.enum([
    "merchant_acknowledgment_not_settlement_proof",
    "merchant_acknowledgment_simulation_not_settlement_proof",
  ]).optional(),
  invalidatedAt: dateTime.optional(),
  invalidationReason: z.string().optional(),
});

export const ErrorCode = z.enum([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "WRONG_CONTEXT",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_MISMATCH",
  "INVALID_TRANSITION",
  "POLICY_REJECTED",
  "NOT_YET_RECEIVED",
  "ALREADY_ACKNOWLEDGED",
  "WALLET_UNAVAILABLE",
  "INTERNAL",
  "OUTCOME_UNKNOWN",
  "CSRF_FAILED",
  "AMOUNT_MISMATCH",
  "VERIFICATION_UNAVAILABLE",
]);

export const ApiErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  requestId: z.string().optional(),
});

/** Path-parameter patterns from components/parameters. */
export const AgentIdParam = z.string().regex(/^agt_[A-Za-z0-9]{10,32}$/);
export const PaymentIdParam = z.string().regex(/^pay_[A-Za-z0-9]{10,32}$/);
export const IdempotencyKeyHeader = z.string().min(8).max(128);

/** Map from contract schema name to Zod schema (used by contract-sync test). */
export const contractSchemas = {
  Zatoshi,
  Health,
  MainnetReadOnlySnapshot,
  Session,
  AgentStatus,
  AgentCreate,
  Agent,
  PolicyRules,
  Policy,
  PolicyUpdate,
  PolicyUsage,
  PaymentRequestCreate,
  PaymentStatus,
  ViolationCode,
  Violation,
  Decision,
  TimelineEvent,
  Payment,
  PrivacyLens,
  Invoice,
  Verification,
  Acknowledgment,
  Error: ApiErrorBody,
  WalletOperation,
} as const;

export type Health = z.infer<typeof Health>;
export type MainnetReadOnlySnapshot = z.infer<typeof MainnetReadOnlySnapshot>;
export type Session = z.infer<typeof Session>;
export type SessionContext = z.infer<typeof SessionContext>;
export type AgentStatus = z.infer<typeof AgentStatus>;
export type PolicyRules = z.infer<typeof PolicyRules>;
export type Policy = z.infer<typeof Policy>;
export type PolicyUpdate = z.infer<typeof PolicyUpdate>;
export type PolicyUsage = z.infer<typeof PolicyUsage>;
export type Agent = z.infer<typeof Agent>;
export type PaymentRequestCreate = z.infer<typeof PaymentRequestCreate>;
export type PaymentStatus = z.infer<typeof PaymentStatus>;
export type ViolationCode = z.infer<typeof ViolationCode>;
export type Violation = z.infer<typeof Violation>;
export type Decision = z.infer<typeof Decision>;
export type TimelineEvent = z.infer<typeof TimelineEvent>;
export type Failure = z.infer<typeof Failure>;
export type PrivacyLens = z.infer<typeof PrivacyLens>;
export type WalletOperation = z.infer<typeof WalletOperation>;
export type Payment = z.infer<typeof Payment>;
export type PaymentList = z.infer<typeof PaymentList>;
export type Invoice = z.infer<typeof Invoice>;
export type InvoiceCreate = z.infer<typeof InvoiceCreate>;
export type InvoiceList = z.infer<typeof InvoiceList>;
export type Verification = z.infer<typeof Verification>;
export type VerificationState = z.infer<typeof VerificationState>;
export type Acknowledgment = z.infer<typeof Acknowledgment>;
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
export type ErrorCode = z.infer<typeof ErrorCode>;
