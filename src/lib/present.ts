/**
 * Presentation only: maps backend-owned fields to copy and tone. Nothing here computes,
 * advances or guesses a status; every function takes what the backend returned and labels it.
 */
import type {
  Failure,
  Health,
  Payment,
  PaymentStatus,
  TimelineEvent,
  Verification,
  VerificationState,
  ViolationCode,
  WalletOperation,
} from "@/lib/contract/schemas";

export type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger" | "review";

/** Contract UI copy: authorized = "approved, not paid"; confirming = "sent, awaiting confirmation"; only confirmed = "paid". */
export const STATUS_COPY: Record<PaymentStatus, { label: string; tone: Tone; help: string }> = {
  requested: { label: "Requested", tone: "neutral", help: "The agent asked to pay. Policy is being evaluated by the backend." },
  rejected: { label: "Blocked by policy", tone: "danger", help: "The backend policy refused this payment. No funds moved." },
  authorized: { label: "Approved, not paid", tone: "info", help: "Policy approved it and the amount is reserved. Nothing has been sent yet." },
  submitted: { label: "Submitted", tone: "progress", help: "Handed to the wallet for a shielded send." },
  confirming: { label: "Sent, awaiting confirmation", tone: "progress", help: "Broadcast. Waiting for the required confirmations." },
  confirmed: { label: "Paid", tone: "success", help: "Confirmed on chain to the required depth." },
  failed: { label: "Failed", tone: "danger", help: "A definitive failure. The reservation was released." },
  expired: { label: "Expired", tone: "neutral", help: "The approval expired before it was executed. The reservation was released." },
};

export const VIOLATION_COPY: Record<ViolationCode, string> = {
  CAP_EXCEEDED: "Over the per-transaction cap",
  BUDGET_EXCEEDED: "Over the remaining budget",
  MERCHANT_NOT_ALLOWED: "Merchant not on the allowlist",
  AGENT_PAUSED: "Agent is paused",
  REQUEST_EXPIRED: "Request expired",
  AMOUNT_MISMATCH: "Amount does not match the invoice",
  INVOICE_NOT_PAYABLE: "Invoice is not open for payment",
  POLICY_VERSION_CHANGED: "Policy changed since approval",
};

export const FAILURE_COPY: Record<Failure["code"], string> = {
  REJECTED_BY_WALLET_PRE_BROADCAST: "The wallet refused before creating a transaction",
  INSUFFICIENT_FUNDS: "The wallet did not have enough shielded funds",
  BROADCAST_REJECTED: "The network rejected the transaction",
  EXPIRED_UNMINED: "The transaction expired without being mined",
  OUTCOME_UNKNOWN: "Outcome unknown",
  WALLET_BROADCAST_DISABLED: "Broadcasting is disabled; no transaction was created",
};

export const WALLET_OP_COPY: Record<NonNullable<WalletOperation>["state"], string> = {
  pending: "Recorded, wallet has not acknowledged",
  broadcast: "Wallet returned an operation reference",
  mined: "Mined",
  final: "Final",
  failed_definitive: "Failed (definitive)",
  unknown: "Unknown",
};

export const WALLET_PHASE_COPY: Record<NonNullable<NonNullable<WalletOperation>["phase"]>, string> = {
  awaiting_operator: "Staged, waiting for the operator",
  preparing: "Operator is preparing the transaction",
  prepared: "Signed offline, not broadcast",
  submitting: "Operator is submitting, outcome not known yet",
  observing: "Submitted, watching wallet and chain",
};

export const PROVISIONAL_RECONCILIATION =
  "Reconciliation is provisional: it is not yet validated against the real Zcash wallet's history and recovery.";

/**
 * How to present a payment whose send outcome is unresolved.
 * - operator: backend says walletOperation.needsOperator = true  -> "Requires operator review"
 * - reconciling: OUTCOME_UNKNOWN (or a pending/unknown wallet op) without needsOperator -> "Being reconciled"
 * Both are shown as NOT failed and NOT paid, and never offer a resend.
 */
export type Unresolved = { kind: "operator" | "awaiting-operator" | "reconciling"; title: string; body: string } | null;

/** Manual testnet phases before the chain can show anything: a txid in phase=prepared is signed, NOT broadcast. */
const PRE_BROADCAST_PHASES = new Set(["awaiting_operator", "preparing", "prepared", "submitting"]);

export function awaitingOperatorConfirmation(op: WalletOperation | undefined | null): boolean {
  if (!op) return false;
  if (op.phase) return PRE_BROADCAST_PHASES.has(op.phase);
  return op.requiresOperatorConfirmation === true;
}

export function unresolvedOf(p: Payment): Unresolved {
  const op = p.walletOperation ?? null;
  if (op?.needsOperator) {
    return {
      kind: "operator",
      title: "Requires operator review",
      body: "The backend could not determine whether this send happened. It is not marked failed and it will never be resent automatically. An operator will resolve it from the wallet history.",
    };
  }
  if (awaitingOperatorConfirmation(op)) {
    return {
      kind: "awaiting-operator",
      title: "Awaiting operator confirmation",
      body: "Execute only staged this payment. Signing and broadcast need separate confirmations in the operator terminal; this app never sends it. It is not paid, not failed, never resent, and the amount stays reserved.",
    };
  }
  const unknown = p.failure?.code === "OUTCOME_UNKNOWN" || op?.state === "unknown" || op?.state === "pending";
  if (unknown) {
    return {
      kind: "reconciling",
      title: "Being reconciled",
      body: "The send outcome is not confirmed yet. The backend is checking wallet history and the chain. It will not resend, and the amount stays reserved.",
    };
  }
  return null;
}

/** Badge for a payment row: unresolved state wins over the raw status label (still the backend's status). */
export function paymentBadge(p: Payment): { label: string; tone: Tone } {
  const u = unresolvedOf(p);
  if (u?.kind === "operator") return { label: "Requires operator review", tone: "review" };
  if (u?.kind === "awaiting-operator") return { label: "Awaiting operator", tone: "review" };
  if (u?.kind === "reconciling") return { label: "Submitted, outcome unknown", tone: "warning" };
  return STATUS_COPY[p.status];
}

export function timelineTitle(e: TimelineEvent): string {
  switch (e.kind) {
    case "reorg":
      return `Reorg: back to ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "reconciled":
      return `Reconciled: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "policy_changed":
      return `Policy changed: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "agent_paused":
      return `Agent paused: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "late_receipt":
      return `${STATUS_COPY[e.status].label} (late receipt)`;
    case "verification":
      return `Merchant verification: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "wallet":
      return `Wallet event: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    default:
      return STATUS_COPY[e.status].label;
  }
}

export const VERIFICATION_COPY: Record<VerificationState, { label: string; tone: Tone; help: string }> = {
  not_seen: { label: "Not seen", tone: "neutral", help: "No receipt for this invoice has been seen yet." },
  pending: { label: "Pending", tone: "progress", help: "A receipt is visible but not at the required confirmations." },
  received: { label: "Received", tone: "success", help: "The expected amount arrived with the required confirmations." },
  late: { label: "Received late", tone: "warning", help: "A receipt arrived after the invoice expired." },
  amount_mismatch: { label: "Amount mismatch", tone: "danger", help: "The received amount does not equal the invoice amount." },
  expired: { label: "Invoice expired", tone: "neutral", help: "The invoice expired with no receipt." },
  underpaid: { label: "Underpaid", tone: "danger", help: "Less than the invoice amount arrived. Cannot be acknowledged." },
  duplicate: { label: "Duplicate receipt", tone: "danger", help: "More than one matching receipt was seen. Cannot be acknowledged until resolved." },
  conflicting: { label: "Conflicting receipts", tone: "danger", help: "The merchant wallet saw observations that disagree. Cannot be acknowledged until resolved." },
  reorged: { label: "Reorged", tone: "warning", help: "The receipt dropped out of the best chain. Not received until it is observed again at depth." },
};

/**
 * Contract rule for acknowledgment eligibility, applied to the backend's Verification as-is:
 * state=received, or state=late with confirmations >= confirmationsRequired and receivedZat === expectedZat.
 * Never on amount_mismatch. The backend enforces it again (409); this only decides whether to offer the button.
 */
export function ackEligibility(v: Verification): { allowed: boolean; reason: string } {
  // The backend's own current-observation verdict can only narrow eligibility, never widen it.
  if (v.acknowledgmentEligible === false && (v.state === "received" || v.state === "late"))
    return { allowed: false, reason: "The backend says the current observation is not sufficient for a merchant statement." };
  if (v.state === "received") return { allowed: true, reason: "Receipt verified." };
  if (v.state === "amount_mismatch") return { allowed: false, reason: "Amount mismatch: cannot be acknowledged." };
  if (v.state === "late") {
    if (v.confirmations < v.confirmationsRequired)
      return { allowed: false, reason: `Late receipt with ${v.confirmations}/${v.confirmationsRequired} confirmations. Wait for the required depth.` };
    if (!v.receivedZat || !v.expectedZat || v.receivedZat !== v.expectedZat)
      return { allowed: false, reason: "Late receipt amount does not equal the invoice amount." };
    return { allowed: true, reason: "Late receipt with the exact amount and required confirmations." };
  }
  return { allowed: false, reason: "Receipt is not verified yet." };
}

export type DataSource = "mock" | "real" | "disabled" | "unknown";

export function dataSourceOf(health: Health | undefined, clientMode: "mock" | "live"): DataSource {
  if (clientMode === "mock") return "mock";
  if (!health) return "unknown";
  if (health.mode === "disabled" || health.wallet === "broadcast_disabled") return "disabled";
  if (health.mode === "mock") return "mock";
  return health.network === "testnet" ? "real" : "unknown";
}

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${month}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}
