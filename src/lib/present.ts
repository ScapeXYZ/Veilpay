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
  confirmed: { label: "Paid", tone: "success", help: "The server reports it confirmed to the required depth." },
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

export function timelineTitle(e: TimelineEvent, simulated = false): string {
  switch (e.kind) {
    case "reorg":
      return `Reorg: back to ${statusLabel(e.status, simulated).toLowerCase()}`;
    case "reconciled":
      return `Reconciled: ${statusLabel(e.status, simulated).toLowerCase()}`;
    case "policy_changed":
      return `Policy changed: ${statusLabel(e.status, simulated).toLowerCase()}`;
    case "agent_paused":
      return `Agent paused: ${statusLabel(e.status, simulated).toLowerCase()}`;
    case "late_receipt":
      return `${statusLabel(e.status, simulated)} (late receipt)`;
    case "verification":
      return `Merchant verification: ${statusLabel(e.status, simulated).toLowerCase()}`;
    case "wallet":
      return `Wallet event: ${statusLabel(e.status, simulated).toLowerCase()}`;
    default:
      return statusLabel(e.status, simulated);
  }
}

export const VERIFICATION_COPY: Record<VerificationState, { label: string; tone: Tone; help: string }> = {
  not_seen: { label: "Not seen", tone: "neutral", help: "No receipt for this invoice has been seen yet." },
  pending: { label: "Pending", tone: "progress", help: "A receipt is visible but not at the required confirmations." },
  received: { label: "Received", tone: "success", help: "VeilPay's receipt scan reports the invoice amount at the required confirmations." },
  late: { label: "Received late", tone: "warning", help: "A receipt was reported after the invoice expired." },
  amount_mismatch: { label: "Amount mismatch", tone: "danger", help: "The received amount does not equal the invoice amount." },
  expired: { label: "Invoice expired", tone: "neutral", help: "The invoice expired with no receipt." },
  underpaid: { label: "Underpaid", tone: "danger", help: "Less than the invoice amount was reported. Cannot be acknowledged." },
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
  const sim = isSimulatedVerification(v);
  const conf = sim ? "simulated confirmations" : "confirmations";
  // The backend's own current-observation verdict can only narrow eligibility, never widen it.
  if (v.acknowledgmentEligible === false && (v.state === "received" || v.state === "late"))
    return { allowed: false, reason: "VeilPay cannot confirm this receipt yet, so it cannot be marked as received." };
  if (v.state === "received")
    return { allowed: true, reason: sim ? "The simulated payment matches the invoice." : "VeilPay's scan reports the invoice amount at the required confirmations." };
  if (v.state === "amount_mismatch") return { allowed: false, reason: "The amount does not match the invoice, so it cannot be marked as received." };
  if (v.state === "late") {
    if (v.confirmations < v.confirmationsRequired)
      return { allowed: false, reason: `Paid late, ${v.confirmations} of ${v.confirmationsRequired} ${conf} so far. Wait for the rest.` };
    if (!v.receivedZat || !v.expectedZat || v.receivedZat !== v.expectedZat)
      return { allowed: false, reason: "Paid late, and the amount does not match the invoice." };
    return { allowed: true, reason: sim ? "Paid late, but the simulated payment matches the invoice amount." : "Paid late, but VeilPay's scan reports the exact amount at the required confirmations." };
  }
  return { allowed: false, reason: sim ? "The simulated payment has not reached the required simulated confirmations yet." : "The payment has not been confirmed yet." };
}

/* ---------- Simulation-aware presentation (one place, so badges, details, timeline, activity and receipts agree) ---------- */

/** A receipt check is simulated when the backend marks it mock or used the mock method. */
export function isSimulatedVerification(v: Pick<Verification, "mock" | "method">): boolean {
  return v.mock === true || v.method === "mock";
}

/** A payment is simulated when the app is in a mock mode, or the backend gave it a practice reference. */
export function isSimulatedPayment(p: Pick<Payment, "mockRef">, modeIsMock: boolean): boolean {
  return modeIsMock || !!p.mockRef;
}

const SIMULATED_VERIFICATION: Partial<Record<VerificationState, { label: string; help: string }>> = {
  received: { label: "Simulated match", help: "The simulated payment matches the invoice. Practice data only: no funds arrived and no chain was checked." },
  pending: { label: "Simulated, pending", help: "A simulated receipt is visible but not at the required simulated confirmations." },
  late: { label: "Simulated, late", help: "A simulated receipt was recorded after the invoice expired." },
};

/** Receipt copy for the merchant card; simulated receipts never read as funds arriving. */
export function verificationCopy(v: Pick<Verification, "state" | "mock" | "method">): { label: string; tone: Tone; help: string } {
  const base = VERIFICATION_COPY[v.state];
  if (!isSimulatedVerification(v)) return base;
  const sim = SIMULATED_VERIFICATION[v.state];
  return sim ? { ...base, ...sim } : { ...base, help: `${base.help} Simulated data, nothing real moved.` };
}

/** The merchant's "marked as received" statement. Never implies settlement or independent chain verification. */
export function ackStatement(simulated: boolean): string {
  return simulated
    ? "Simulated: a practice statement by the merchant, not proof that any funds arrived."
    : "This is the merchant's own statement, not settlement proof or an independent chain check.";
}

/** Sent-side status labels in a simulation. */
export const SIMULATED_STATUS_LABEL: Partial<Record<PaymentStatus, string>> = {
  submitted: "Simulated send",
  confirming: "Simulated, awaiting simulated confirmations",
  confirmed: "Simulated complete",
};

/** Status label for badges, details and activity rows. Unresolved states keep their own wording. */
export function paymentStatusLabel(p: Payment, simulated: boolean): { label: string; tone: Tone } {
  const b = paymentBadge(p);
  if (!simulated || unresolvedOf(p)) return b;
  return { label: SIMULATED_STATUS_LABEL[p.status] ?? b.label, tone: b.tone };
}

/** Status label for one timeline event. */
export function statusLabel(status: PaymentStatus, simulated: boolean): string {
  return (simulated && SIMULATED_STATUS_LABEL[status]) || STATUS_COPY[status].label;
}

/** "2 simulated confirmations (3 required)" / "2 of 3". */
export function confirmationsText(n: number | null | undefined, required: number | null | undefined, simulated: boolean): string {
  const c = n ?? 0;
  if (simulated) {
    const label = `${c} simulated confirmation${c === 1 ? "" : "s"}`;
    return required != null ? `${label} (${required} required)` : label;
  }
  return required != null ? `${c} of ${required}` : `${c}`;
}

const SENT_STATUSES: PaymentStatus[] = ["submitted", "confirming", "confirmed"];

/** True once anything (real or mock) was sent, judged from the status, the timeline or a reference. */
export function wasSent(p: Payment): boolean {
  return SENT_STATUSES.includes(p.status) || !!p.mockRef || !!p.txid || p.timeline.some((e) => SENT_STATUSES.includes(e.status));
}

/** Privacy row on payment details. A simulated run is mock execution, never real shielded settlement. */
export function privacyLine(p: Payment, simulated: boolean): string {
  const sent = wasSent(p);
  if (simulated) {
    if (!sent) return "Not sent yet. Nothing has been simulated for this payment.";
    return `Mock execution only${p.pool ? ` (simulated ${p.pool} pool)` : ""}. No real shielded settlement happened.`;
  }
  if (!sent) return "Not sent yet";
  return p.pool ? `${p.pool} pool, as reported by VeilPay` : "Not reported by the server";
}

/** Evidence line under the Privacy lens. A completed simulated payment never reads "not sent yet". */
export function privacyEvidence(p: Payment, simulated: boolean): string {
  const sent = wasSent(p);
  if (simulated) {
    return sent
      ? `: a simulated payment, mock execution only${p.pool ? ` (simulated ${p.pool} pool)` : ""}. No real shielded settlement happened`
      : ", not sent yet. Nothing has been simulated for this payment";
  }
  if (p.pool) return `, which reports it as sent through the ${p.pool} pool`;
  return sent ? ", which has not reported a pool" : ", not sent yet";
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

/** The API does not expose a separate update timestamp; the final timeline event is authoritative. */
export function lastUpdated(p: Payment): string {
  return p.timeline.length > 0 ? p.timeline[p.timeline.length - 1].at : p.createdAt;
}
