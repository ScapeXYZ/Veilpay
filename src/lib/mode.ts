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

const MAINNET_REASON = "Mainnet is read-only in VeilPay. Sending, payment requests, invoices and rule changes are turned off.";
const UNKNOWN_REASON = "VeilPay cannot tell which network the server is on, so nothing that changes money or rules is offered.";

export function networkModeOf(health: Health | undefined, clientMode: "mock" | "live", healthError = false): NetworkMode {
  if (clientMode === "mock")
    return {
      kind: "mock",
      label: "Simulation · No funds move",
      detail: "A practice copy of VeilPay running in your browser. No real money, wallet or network is involved.",
      canWrite: true,
      canExecute: true,
      writeBlockedReason: null,
      executeBlockedReason: null,
    };
  if (!health || healthError)
    return {
      kind: "unknown",
      label: "Server unreachable · Status unknown",
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
      detail: "VeilPay only watches the real Zcash network. It does not send, request or invoice there.",
      canWrite: false,
      canExecute: false,
      writeBlockedReason: MAINNET_REASON,
      executeBlockedReason: MAINNET_REASON,
    };
  if (health.network !== "testnet")
    return {
      kind: "unknown",
      label: `${health.network} · Unsupported network`,
      detail: "VeilPay only sends on the Zcash test network.",
      canWrite: false,
      canExecute: false,
      writeBlockedReason: UNKNOWN_REASON,
      executeBlockedReason: UNKNOWN_REASON,
    };
  if (health.mode === "mock")
    return { ...networkModeOf(undefined, "mock"), detail: "The server is in practice mode. No real money moves." };
  if (health.mode === "disabled" || health.wallet === "broadcast_disabled")
    return {
      kind: "disabled",
      label: "Testnet · Sending turned off",
      detail: "This server cannot send payments or check merchant receipts on its own.",
      canWrite: true,
      canExecute: false,
      writeBlockedReason: null,
      executeBlockedReason: "Sending is turned off on this server.",
    };
  if (health.mode === "testnet_manual" || health.wallet === "operator_required")
    return {
      kind: "testnet_manual",
      label: "Testnet · Test funds · Operator execution",
      detail: "An operator sends approved payments from a separate terminal. This app never signs or sends.",
      canWrite: true,
      canExecute: true,
      writeBlockedReason: null,
      executeBlockedReason: null,
    };
  return {
    kind: "testnet",
    label: "Testnet · Test funds only",
    detail: "Real test-network wallet. Test coins have no real value.",
    canWrite: true,
    canExecute: true,
    writeBlockedReason: null,
    executeBlockedReason: null,
  };
}
