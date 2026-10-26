/**
 * Pure wallet-UX state machine layered on top of the read-only Noir Wallet
 * adapter (`@/lib/noir-wallet`). No SDK calls happen here: the hook in
 * `use-noir-wallet-ux.ts` performs adapter calls and dispatches events.
 *
 * Safety rules encoded here:
 * - A balance is only ever shown from the adapter, for the selected account,
 *   and only when the wallet says that account is synced. Anything else is
 *   "Unavailable", never 0.
 * - Wrong or unconfirmed network fails closed: accounts and balances are dropped.
 * - Any lock, disconnect or account change drops balances; nothing is reused.
 */
import { noirNetworkOfAddress, type NoirAccount, type NoirBalance } from "@/lib/noir-wallet";
import type { NetworkModeKind } from "@/lib/mode";

export type WalletNetwork = "mainnet" | "testnet";
export type DetectedNetwork = WalletNetwork | "mismatch" | "unknown";

export type WalletStatus =
  | "off" // practice simulation or server network unknown: wallet connection is not offered
  | "checking"
  | "mobile_unsupported"
  | "not_installed"
  | "disconnected"
  | "connecting"
  | "connected"
  | "account_changed"
  | "locked"
  | "rejected"
  | "wrong_network"
  | "error";

export type BalanceValues = { shielded?: string; transparent?: string; available?: string; total?: string };
export type BalanceView = { synced: boolean; values: BalanceValues };

export type WalletState = {
  status: WalletStatus;
  accounts: NoirAccount[];
  selectedId: string | null;
  balance: BalanceView | null;
  balanceLoading: boolean;
  /** Network read from the wallet's addresses when the check failed. */
  detectedNetwork: DetectedNetwork | null;
};

export type WalletEvent =
  | { type: "off" }
  | { type: "provider_missing"; mobile: boolean }
  | { type: "restore_none" }
  | { type: "connect_start" }
  | { type: "accounts"; accounts: NoirAccount[]; expected: WalletNetwork; afterChange?: boolean }
  | { type: "balance"; accountId: string; result: NoirBalance }
  | { type: "error"; kind: "rejected" | "locked" | "syncing" | "failed" }
  | { type: "accounts_changed"; payload: unknown }
  | { type: "select"; accountId: string }
  | { type: "disconnected" };

export const initialWalletState: WalletState = {
  status: "checking",
  accounts: [],
  selectedId: null,
  balance: null,
  balanceLoading: false,
  detectedNetwork: null,
};

const cleared = (status: WalletStatus, detectedNetwork: DetectedNetwork | null = null): WalletState => ({
  status,
  accounts: [],
  selectedId: null,
  balance: null,
  balanceLoading: false,
  detectedNetwork,
});

/** Which wallet network the VeilPay server mode expects; null = do not offer a wallet. */
export function expectedWalletNetwork(kind: NetworkModeKind): WalletNetwork | null {
  if (kind === "mainnet_readonly") return "mainnet";
  if (kind === "testnet" || kind === "testnet_manual" || kind === "disabled") return "testnet";
  return null;
}

/** Network from a Zcash address prefix (HRP). The SDK has no documented network getter. */
export function networkOfAddress(address: string | undefined | null): WalletNetwork | null {
  return noirNetworkOfAddress(address);
}

export function networkOfAccount(account: NoirAccount): DetectedNetwork {
  const nets = [networkOfAddress(account.addresses?.shielded), networkOfAddress(account.addresses?.transparent)].filter(
    (n): n is WalletNetwork => n !== null,
  );
  if (nets.length === 0) return "unknown";
  return nets.every((n) => n === nets[0]) ? nets[0] : "mismatch";
}

export function networkOfAccounts(accounts: NoirAccount[]): DetectedNetwork {
  const nets = accounts.map(networkOfAccount);
  if (nets.some((n) => n === "unknown")) return "unknown";
  if (nets.some((n) => n === "mismatch")) return "mismatch";
  return nets.every((n) => n === nets[0]) ? nets[0] : "mismatch";
}

export function walletReducer(state: WalletState, event: WalletEvent): WalletState {
  switch (event.type) {
    case "off":
      return cleared("off");
    case "provider_missing":
      return cleared(event.mobile ? "mobile_unsupported" : "not_installed");
    case "restore_none":
      return cleared("disconnected");
    case "connect_start":
      return { ...cleared("connecting") };
    case "accounts": {
      if (event.accounts.length === 0) return cleared("disconnected");
      const detected = networkOfAccounts(event.accounts);
      if (detected !== event.expected) return cleared("wrong_network", detected);
      if (event.afterChange) {
        // Never carry a selection or balance across an account change: the user picks again.
        return { ...cleared("account_changed"), accounts: event.accounts };
      }
      const keep = state.selectedId && event.accounts.some((a) => a.id === state.selectedId) ? state.selectedId : event.accounts[0].id;
      return { status: "connected", accounts: event.accounts, selectedId: keep, balance: null, balanceLoading: true, detectedNetwork: null };
    }
    case "balance": {
      if (state.status !== "connected" || state.selectedId !== event.accountId) return state; // stale response
      const entry = event.result.accounts?.find((a) => a.id === event.accountId);
      // Without a per-account entry the wallet did not report sync status: fail closed.
      const synced = entry ? entry.synced === true : false;
      const raw = entry ? entry.balance : event.result;
      const values: BalanceValues = {
        shielded: raw.shielded,
        transparent: raw.transparent,
        available: raw.available ?? raw.spendable,
        total: raw.total,
      };
      return { ...state, balance: { synced, values }, balanceLoading: false };
    }
    case "error":
      if (event.kind === "syncing" && state.status === "connected")
        return { ...state, balance: { synced: false, values: {} }, balanceLoading: false };
      if (event.kind === "rejected") return cleared("rejected");
      if (event.kind === "locked") return cleared("locked");
      return cleared("error");
    case "accounts_changed": {
      if (Array.isArray(event.payload) && event.payload.length === 0) return cleared("locked");
      if (event.payload === null || event.payload === undefined) return cleared("disconnected");
      return { ...cleared("account_changed"), accounts: [] };
    }
    case "select": {
      if (!state.accounts.some((a) => a.id === event.accountId)) return state;
      if (state.status !== "connected" && state.status !== "account_changed") return state;
      return { ...state, status: "connected", selectedId: event.accountId, balance: null, balanceLoading: true };
    }
    case "disconnected":
      return cleared("disconnected");
  }
}

const DECIMAL = /^\d+(\.\d+)?$/;

/** Display a wallet-reported amount. Unsynced, missing or malformed = "Unavailable", never 0. */
export function formatWalletZec(value: string | undefined, synced: boolean): string {
  if (!synced || value === undefined || !DECIMAL.test(value.trim())) return "Unavailable";
  return `${value.trim()} ZEC`;
}

export function truncateAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shieldedKind(address: string | undefined): "Unified" | "Sapling" | null {
  if (!address) return null;
  const a = address.toLowerCase();
  if (a.startsWith("u")) return "Unified";
  if (a.startsWith("z")) return "Sapling";
  return null;
}

export function accountName(account: NoirAccount): string {
  return account.label?.trim() || `Account ${account.accountId}`;
}

export function isMobileBrowser(nav: { userAgent?: string; userAgentData?: { mobile?: boolean } } | undefined): boolean {
  if (!nav) return false;
  if (nav.userAgentData?.mobile === true) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? "");
}

export type StateCopy = { title: string; body: string; tone: "neutral" | "info" | "progress" | "success" | "warning" | "danger" };

export function walletStatusCopy(status: WalletStatus, detected: DetectedNetwork | null, expected: WalletNetwork | null): StateCopy {
  switch (status) {
    case "off":
      return { title: "Wallet connection is off here", body: "VeilPay only offers a wallet connection on a confirmed network. Nothing is read from any wallet.", tone: "neutral" };
    case "checking":
      return { title: "Checking Noir Wallet", body: "Looking for an existing authorization without opening the wallet.", tone: "progress" };
    case "mobile_unsupported":
      return { title: "Open VeilPay in desktop Chrome", body: "Noir Wallet is a Chrome extension for desktop. It is not available on phones, so no wallet is connected here.", tone: "neutral" };
    case "not_installed":
      return { title: "Noir Wallet is not installed", body: "Install the official Noir Wallet extension in Chrome, then reload this page. VeilPay never asks for access on its own.", tone: "neutral" };
    case "disconnected":
      return { title: "Not connected", body: "Connect to view your accounts and wallet-reported balances. VeilPay cannot spend, sign or send from this screen.", tone: "neutral" };
    case "connecting":
      return { title: "Waiting for Noir Wallet", body: "Approve the request in the Noir Wallet window. You choose which accounts to share.", tone: "progress" };
    case "connected":
      return { title: "Connected, read-only", body: "Balances come straight from Noir Wallet for the selected account. VeilPay stores none of it.", tone: "success" };
    case "account_changed":
      return { title: "Your wallet accounts changed", body: "Balances were cleared. Pick an account again to continue.", tone: "warning" };
    case "locked":
      return { title: "Noir Wallet is locked", body: "Unlock it in the extension, then connect again. No balances are shown while it is locked.", tone: "warning" };
    case "rejected":
      return { title: "Connection declined", body: "You declined in Noir Wallet. No account information was kept.", tone: "neutral" };
    case "wrong_network": {
      const want = expected === "testnet" ? "testnet" : "mainnet";
      if (detected === "mainnet" || detected === "testnet")
        return { title: `Wrong network: wallet is on ${detected}`, body: `This VeilPay server expects ${want}. Noir Wallet uses a separate extension per network; switch to the ${want} extension, then connect again.`, tone: "danger" };
      return { title: "Network could not be confirmed", body: `VeilPay could not confirm these accounts are on ${want}, so nothing is shown. Check you are using the ${want} Noir Wallet extension.`, tone: "danger" };
    }
    case "error":
      return { title: "Noir Wallet did not respond", body: "Nothing was saved or sent to VeilPay. Try again; if it keeps failing, reopen the extension.", tone: "danger" };
  }
}
