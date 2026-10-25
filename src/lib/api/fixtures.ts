/**
 * Seed data for MOCK mode. Every object here must parse with the v1.1 contract schemas
 * (asserted in fixtures.test.ts). Mock payments follow the contract MOCK MODE rules:
 * txid null, pool null, mockRef set, Verification.method "mock" + mock true.
 * Nothing here is chain data. Confirmations are simulated counters.
 */
import type { Health, Invoice, Payment, Policy, PrivacyLens, Verification } from "@/lib/contract/schemas";

export const MERCHANT_ID = "mer_juniper01";
export const MERCHANT_NAME = "Juniper Coffee Roasters";
export const AGENT_ID = "agt_procure0001";
export const AGENT_NAME = "Office procurement agent";
const OTHER_MERCHANT = "mer_unlisted01";

const T0 = Date.parse("2026-10-24T09:00:00.000Z");
export const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

export const PRIVACY_LENS: PrivacyLens = {
  publicChainSees: ["that a shielded transaction exists", "block time", "fee", "transaction structure"],
  hiddenOnChain: ["amount", "sender address", "recipient address", "memo", "which invoice it pays"],
  merchantSees: ["amount received for this invoice", "invoice reference", "confirmations"],
  customerSees: ["the agent's own payments", "policy decisions", "payment status and timeline"],
};

export function seedHealth(): Health {
  return {
    status: "ok",
    network: "testnet",
    wallet: "ready",
    walletBackend: "mock",
    chainHeight: null,
    confirmationsRequired: 1,
    mode: "mock",
    reconciler: { lastRunAt: at(58), unresolved: 2 },
    chainWatcher: { lastBlockAt: null, watchDepth: 100, deepReorgAlert: false },
  };
}

export function seedPolicy(): Policy {
  return {
    perTxLimitZat: "25000000",
    totalBudgetZat: "100000000",
    allowedMerchantIds: [MERCHANT_ID],
    requestTtlSeconds: 900,
    version: 3,
    updatedAt: at(-120),
  };
}

export function seedInvoices(): Invoice[] {
  const inv = (
    id: string,
    reference: string,
    amountZat: string,
    status: Invoice["status"],
    created: number,
    expires: number,
  ): Invoice => ({
    id,
    merchantId: MERCHANT_ID,
    reference,
    amountZat,
    payTo: "mock-address-not-on-chain",
    status,
    createdAt: at(created),
    expiresAt: at(expires),
  });
  return [
    inv("inv_beans00001", "INV-1001 single-origin beans", "12000000", "open", 0, 240),
    inv("inv_espresso01", "INV-1002 espresso machine", "75000000", "open", 1, 240),
    inv("inv_pastry0001", "INV-0990 pastries", "4000000", "paid", -60, 30),
    inv("inv_mugs000001", "INV-0991 branded mugs", "9000000", "paid", -50, 30),
    inv("inv_filter0001", "INV-0992 filter papers", "2000000", "paid_late", -90, -30),
    inv("inv_grinder001", "INV-0993 grinder service", "15000000", "paid_late", -80, -20),
    inv("inv_milk000001", "INV-0994 oat milk", "3000000", "paid_late", -70, -10),
    inv("inv_cups000001", "INV-0995 compostable cups", "6000000", "open", -40, 200),
    inv("inv_syrup00001", "INV-0996 syrups", "5000000", "open", -30, 200),
    inv("inv_kettle0001", "INV-0997 kettle", "8000000", "open", -20, 200),
    inv("inv_tamper0001", "INV-0998 tamper", "3500000", "open", -15, 200),
    inv("inv_scale00001", "INV-0999 scale", "7000000", "expired", -200, -100),
    inv("inv_apron00001", "INV-0989 aprons", "6500000", "open", -10, 200),
  ];
}

type PaymentSeed = Partial<Payment> & Pick<Payment, "id" | "invoiceId" | "amountZat" | "reference" | "status">;

let decisionSeq = 0;
function decision(result: "authorized" | "rejected", minutes: number, violations: Payment["decision"]["violations"] = []) {
  decisionSeq += 1;
  return {
    id: `dec_mock${String(decisionSeq).padStart(6, "0")}`,
    result,
    policyVersion: 3,
    evaluatedAt: at(minutes),
    violations,
    auditHash: `mock-audit-${String(decisionSeq).padStart(4, "0")}`,
  };
}

function payment(seed: PaymentSeed, created: number): Payment {
  return {
    agentId: AGENT_ID,
    merchantId: MERCHANT_ID,
    merchantName: MERCHANT_NAME,
    pool: null,
    txid: null,
    confirmations: 0,
    failure: null,
    privacy: PRIVACY_LENS,
    walletOperation: null,
    createdAt: at(created),
    decision: decision("authorized", created),
    timeline: [
      { status: "requested", kind: "status", at: at(created) },
      { status: "authorized", kind: "status", at: at(created) },
    ],
    ...seed,
  };
}

export function seedPayments(): Payment[] {
  decisionSeq = 0;
  return [
    payment(
      {
        id: "pay_confirmed0001",
        invoiceId: "inv_pastry0001",
        amountZat: "4000000",
        reference: "pastries for standup",
        status: "confirmed",
        confirmations: 3,
        mockRef: "mock_00000000000000000000000000000001",
        walletOperation: { id: "wop_mock0001", state: "final", attempt: 1, lastReconciledAt: at(-30), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-58) },
          { status: "authorized", kind: "status", at: at(-58) },
          { status: "submitted", kind: "status", at: at(-57) },
          { status: "confirming", kind: "status", at: at(-56) },
          { status: "confirmed", kind: "status", at: at(-50) },
        ],
      },
      -58,
    ),
    payment(
      {
        id: "pay_confirming001",
        invoiceId: "inv_cups000001",
        amountZat: "6000000",
        reference: "compostable cups",
        status: "confirming",
        confirmations: 0,
        mockRef: "mock_00000000000000000000000000000002",
        walletOperation: { id: "wop_mock0002", state: "broadcast", attempt: 1, lastReconciledAt: at(55), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(50) },
          { status: "authorized", kind: "status", at: at(50) },
          { status: "submitted", kind: "status", at: at(51) },
          { status: "confirming", kind: "status", at: at(52) },
        ],
      },
      50,
    ),
    payment(
      {
        id: "pay_reconcile0001",
        invoiceId: "inv_syrup00001",
        amountZat: "5000000",
        reference: "syrups restock",
        status: "submitted",
        mockRef: "mock_00000000000000000000000000000003",
        failure: {
          code: "OUTCOME_UNKNOWN",
          message: "The wallet did not confirm whether the send happened. The backend is reconciling; it will not resend.",
          retriable: false,
          definitive: false,
        },
        walletOperation: { id: "wop_mock0003", state: "pending", attempt: 1, lastReconciledAt: at(57), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(40) },
          { status: "authorized", kind: "status", at: at(40) },
          { status: "submitted", kind: "status", at: at(41), note: "Process restarted after the wallet operation was recorded." },
        ],
      },
      40,
    ),
    payment(
      {
        id: "pay_operator00001",
        invoiceId: "inv_kettle0001",
        amountZat: "8000000",
        reference: "kettle replacement",
        status: "submitted",
        mockRef: "mock_00000000000000000000000000000004",
        failure: {
          code: "OUTCOME_UNKNOWN",
          message: "Unresolved past the reconcile window. An operator must review it; it will never be resent automatically.",
          retriable: false,
          definitive: false,
        },
        walletOperation: { id: "wop_mock0004", state: "unknown", attempt: 1, lastReconciledAt: at(58), needsOperator: true },
        timeline: [
          { status: "requested", kind: "status", at: at(-150) },
          { status: "authorized", kind: "status", at: at(-150) },
          { status: "submitted", kind: "status", at: at(-149) },
        ],
      },
      -150,
    ),
    payment(
      {
        id: "pay_reorged000001",
        invoiceId: "inv_mugs000001",
        amountZat: "9000000",
        reference: "branded mugs",
        status: "confirming",
        confirmations: 0,
        mockRef: "mock_00000000000000000000000000000005",
        walletOperation: { id: "wop_mock0005", state: "broadcast", attempt: 1, lastReconciledAt: at(58), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-48) },
          { status: "authorized", kind: "status", at: at(-48) },
          { status: "submitted", kind: "status", at: at(-47) },
          { status: "confirming", kind: "status", at: at(-46) },
          { status: "confirmed", kind: "status", at: at(-40) },
          { status: "confirming", kind: "reorg", at: at(20), note: "Block dropped from the best chain; confirmations recounted." },
        ],
      },
      -48,
    ),
    payment(
      {
        id: "pay_reorgfail0001",
        invoiceId: "inv_tamper0001",
        amountZat: "3500000",
        reference: "tamper",
        status: "failed",
        mockRef: "mock_00000000000000000000000000000006",
        failure: {
          code: "EXPIRED_UNMINED",
          message: "After a reorg the transaction passed its expiry height and is absent from chain and mempool.",
          retriable: false,
          definitive: true,
        },
        walletOperation: { id: "wop_mock0006", state: "failed_definitive", attempt: 1, lastReconciledAt: at(45), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-15) },
          { status: "authorized", kind: "status", at: at(-15) },
          { status: "submitted", kind: "status", at: at(-14) },
          { status: "confirming", kind: "status", at: at(-13) },
          { status: "confirmed", kind: "status", at: at(-8) },
          { status: "confirming", kind: "reorg", at: at(10), note: "Block dropped from the best chain." },
          { status: "failed", kind: "reconciled", at: at(45), note: "Expiry height passed; transaction not found." },
        ],
      },
      -15,
    ),
    payment(
      {
        id: "pay_bcastrej0001",
        invoiceId: "inv_apron00001",
        amountZat: "6500000",
        reference: "aprons",
        status: "failed",
        mockRef: "mock_00000000000000000000000000000007",
        failure: {
          code: "BROADCAST_REJECTED",
          message: "The node rejected the transaction and the wallet confirms it is not pending.",
          retriable: false,
          definitive: true,
        },
        walletOperation: { id: "wop_mock0007", state: "failed_definitive", attempt: 1, lastReconciledAt: at(-5), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-10) },
          { status: "authorized", kind: "status", at: at(-10) },
          { status: "submitted", kind: "status", at: at(-9) },
          { status: "failed", kind: "status", at: at(-9) },
        ],
      },
      -10,
    ),
    payment(
      {
        id: "pay_rejected00001",
        invoiceId: "inv_espresso01",
        amountZat: "75000000",
        reference: "espresso machine",
        status: "rejected",
        decision: decision("rejected", 5, [
          {
            code: "CAP_EXCEEDED",
            message: "Payment blocked: requested amount exceeds the authorized transaction limit.",
            limitZat: "25000000",
            requestedZat: "75000000",
          },
        ]),
        timeline: [
          { status: "requested", kind: "status", at: at(5) },
          { status: "rejected", kind: "status", at: at(5) },
        ],
      },
      5,
    ),
    payment(
      {
        id: "pay_expired00001",
        invoiceId: "inv_scale00001",
        amountZat: "7000000",
        reference: "scale",
        status: "expired",
        timeline: [
          { status: "requested", kind: "status", at: at(-200) },
          { status: "authorized", kind: "status", at: at(-200) },
          { status: "expired", kind: "status", at: at(-185) },
        ],
      },
      -200,
    ),
    payment(
      {
        id: "pay_latepaid0001",
        invoiceId: "inv_filter0001",
        amountZat: "2000000",
        reference: "filter papers",
        status: "confirmed",
        confirmations: 2,
        mockRef: "mock_00000000000000000000000000000010",
        walletOperation: { id: "wop_mock0010", state: "final", attempt: 1, lastReconciledAt: at(-20), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-35) },
          { status: "authorized", kind: "status", at: at(-35) },
          { status: "submitted", kind: "status", at: at(-34) },
          { status: "confirming", kind: "status", at: at(-25), note: "Mined after the invoice expired." },
          { status: "confirmed", kind: "late_receipt", at: at(-22) },
        ],
      },
      -35,
    ),
    payment(
      {
        id: "pay_lateshort001",
        invoiceId: "inv_grinder001",
        amountZat: "15000000",
        reference: "grinder service",
        status: "confirmed",
        confirmations: 2,
        mockRef: "mock_00000000000000000000000000000011",
        walletOperation: { id: "wop_mock0011", state: "final", attempt: 1, lastReconciledAt: at(-12), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-30) },
          { status: "authorized", kind: "status", at: at(-30) },
          { status: "submitted", kind: "status", at: at(-29) },
          { status: "confirming", kind: "status", at: at(-18) },
          { status: "confirmed", kind: "late_receipt", at: at(-14) },
        ],
      },
      -30,
    ),
    payment(
      {
        id: "pay_latewait0001",
        invoiceId: "inv_milk000001",
        amountZat: "3000000",
        reference: "oat milk",
        status: "confirming",
        confirmations: 0,
        mockRef: "mock_00000000000000000000000000000012",
        walletOperation: { id: "wop_mock0012", state: "broadcast", attempt: 1, lastReconciledAt: at(56), needsOperator: false },
        timeline: [
          { status: "requested", kind: "status", at: at(-25) },
          { status: "authorized", kind: "status", at: at(-25) },
          { status: "submitted", kind: "status", at: at(-24) },
          { status: "confirming", kind: "late_receipt", at: at(-5) },
        ],
      },
      -25,
    ),
  ];
}

/** Per-payment verification overrides (everything else is derived by the mock backend from status). */
export function seedVerificationOverrides(): Record<string, Partial<Verification>> {
  return {
    pay_latepaid0001: { state: "late", late: true, receivedZat: "2000000", confirmations: 2 },
    pay_lateshort001: { state: "amount_mismatch", late: true, receivedZat: "12000000", confirmations: 2 },
    pay_latewait0001: { state: "late", late: true, receivedZat: "3000000", confirmations: 0 },
    pay_expired00001: { state: "expired" },
  };
}

export const SEED_IDS = {
  blockedDemoInvoice: "inv_espresso01",
  happyDemoInvoice: "inv_beans00001",
  otherMerchant: OTHER_MERCHANT,
};
