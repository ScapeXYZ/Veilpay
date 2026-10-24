import type { Health } from "@/lib/contract/schemas";

/**
 * One server-owned network mode for the whole app. Derived from GET /health only; never a client
 * dropdown. Mainnet is ALWAYS read-only in this frontend: no request, execute, invoice, QR,
 * acknowledgment, pause or policy write, whatever any other health field says. Enabling mainnet
 * execution needs a separate agreed safety review, not a backend flag.
 */
export type NetworkModeKind = "mock" | "testnet" | "testnet_manual" | "mainnet_readonly" | "disabled" | "unknown";

export type NetworkMode = {
  kind: NetworkModeKind;
  /** Short persistent label, e.g. "Mainnet · Read-only · Execution disabled". */
  label: string;
  /** One-line explanation shown under the label. */
  detail: string;
  /** Policy writes, pause/resume, payment requests, invoices, acknowledgments. */
  canWrite: boolean;
  /** Execute (stage a shielded send). */
  canExecute: boolean;
  /** Why writes are blocked; null when allowed. */
  writeBlockedReason: string | null;
  executeBlockedReason: string | null;
};

const MAINNET_REASON = "Mainnet is read-only in VeilPay. Execution, requests, invoices and policy changes are disabled.";
const UNKNOWN_REASON = "The backend's network is unknown, so nothing that changes state is offered.";

export function networkModeOf(health: Health | undefined, clientMode: "mock" | "live", healthError = false): NetworkMode {
  if (clientMode === "mock")
    return {
      kind: "mock",
      label: "Simulation · No funds move",
      detail: "In-browser mock backend. Every txid, confirmation and receipt is simulated.",
      canWrite: true,
      canExecute: true,
      writeBlockedReason: null,
      executeBlockedReason: null,
    };
  if (!health || healthError)
    return {
      kind: "unknown",
      label: "Backend unreachable · Source unknown",
      detail: "Nothing on screen should be treated as real.",
      canWrite: false,
      canExecute: false,
      writeBlockedReason: UNKNOWN_REASON,
      executeBlockedReason: UNKNOWN_REASON,
    };
  if (health.network === "mainnet")
    return {
      kind: "mainnet_readonly",
      label: "Mainnet · Read-only · Execution disabled",
      detail: "Observations only. VeilPay does not send, request or invoice on mainnet.",
      canWrite: false,
      canExecute: false,
      writeBlockedReason: MAINNET_REASON,
      executeBlockedReason: MAINNET_REASON,
    };
  if (health.network !== "testnet")
    return {
      kind: "unknown",
      label: `${health.network} · Unsupported network`,
      detail: "This frontend only supports testnet execution.",
      canWrite: false,
      canExecute: false,
      writeBlockedReason: UNKNOWN_REASON,
      executeBlockedReason: UNKNOWN_REASON,
    };
  if (health.mode === "mock")
    return { ...networkModeOf(undefined, "mock"), detail: "The backend reports mock mode. No funds move." };
  if (health.mode === "disabled" || health.wallet === "broadcast_disabled")
    return {
      kind: "disabled",
      label: "Testnet · Broadcasting disabled",
      detail: "This backend cannot send funds or independently verify merchant receipts.",
      canWrite: true,
      canExecute: false,
      writeBlockedReason: null,
      executeBlockedReason: "Broadcasting is disabled on this backend.",
    };
  if (health.mode === "testnet_manual" || health.wallet === "operator_required")
    return {
      kind: "testnet_manual",
      label: "Testnet · Test funds · Operator execution",
      detail: "Staged payments wait for an operator in a separate terminal. This app never signs or broadcasts.",
      canWrite: true,
      canExecute: true,
      writeBlockedReason: null,
      executeBlockedReason: null,
    };
  return {
    kind: "testnet",
    label: "Testnet · Test funds only",
    detail: `Real ${health.walletBackend} testnet wallet. Not production funds.`,
    canWrite: true,
    canExecute: true,
    writeBlockedReason: null,
    executeBlockedReason: null,
  };
}
