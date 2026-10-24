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
  requested: { label: "Requested", tone: "neutral", help: "The agent asked to pay. VeilPay is checking it against the spending rules." },
  rejected: { label: "Blocked by rules", tone: "danger", help: "This payment broke a spending rule, so it was blocked. No money moved." },
  authorized: { label: "Approved, not paid", tone: "info", help: "It fits the spending rules and the amount is set aside. Nothing has been sent yet." },
  submitted: { label: "Sending", tone: "progress", help: "Handed to the wallet to send privately." },
  confirming: { label: "Sent, awaiting confirmation", tone: "progress", help: "On the network. Waiting for enough blocks to confirm it." },
  confirmed: { label: "Paid", tone: "success", help: "Confirmed by the network with enough blocks on top." },
  failed: { label: "Failed", tone: "danger", help: "It definitely did not go through. The set-aside amount was released." },
  expired: { label: "Expired", tone: "neutral", help: "The approval ran out before it was sent. The set-aside amount was released." },
};

export const VIOLATION_COPY: Record<ViolationCode, string> = {
  CAP_EXCEEDED: "More than the max per payment",
  BUDGET_EXCEEDED: "More than what is left in the budget",
  MERCHANT_NOT_ALLOWED: "Merchant is not on your approved list",
  AGENT_PAUSED: "The agent is paused",
  REQUEST_EXPIRED: "The request ran out of time",
  AMOUNT_MISMATCH: "Amount does not match the invoice",
  INVOICE_NOT_PAYABLE: "This invoice cannot be paid any more",
  POLICY_VERSION_CHANGED: "Spending rules changed since approval",
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
  if (u?.kind === "reconciling") return { label: "Sent, outcome unknown", tone: "warning" };
  return STATUS_COPY[p.status];
}

export function timelineTitle(e: TimelineEvent): string {
  switch (e.kind) {
    case "reorg":
      return `Network correction: back to ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "reconciled":
      return `Rechecked: ${STATUS_COPY[e.status].label.toLowerCase()}`;
    case "policy_changed":
      return `Spending rules changed: ${STATUS_COPY[e.status].label.toLowerCase()}`;
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
  reorged: { label: "Moved back by the network", tone: "warning", help: "The network replaced the block holding this receipt. Not received until it is confirmed again." },
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * "24 Oct, 09:05 UTC". Built from UTC fields, not toLocaleString: Node and each browser ship
 * different ICU data, so Intl output can differ between the server render and hydration.
 */
export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return `${pad2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

/** Last backend event time for a payment (the contract has no updatedAt). */
export function lastUpdated(p: Payment): string {
  return p.timeline.length > 0 ? p.timeline[p.timeline.length - 1].at : p.createdAt;
}
