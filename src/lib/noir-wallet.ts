"use client";

/**
 * Narrow, read-only boundary around the official Noir Wallet SDK.
 *
 * This module intentionally does not expose transaction, signing, identity, or
 * history methods. Wallet data stays in component memory and is never sent to
 * the VeilPay API or persisted in browser storage.
 */
import { detectProvider, getNoirWallet } from "@noir-wallet/sdk";
import type {
  NoirWalletProvider,
  ZcashAccount,
  ZcashBalanceResult,
  ZcashConnectResult,
  TransactionHistoryEntry,
} from "@noir-wallet/sdk";

export type NoirConnection = ZcashConnectResult;
export type NoirAccount = ZcashAccount;
export type NoirBalance = ZcashBalanceResult;
export type NoirTransaction = TransactionHistoryEntry;
export type NoirProvider = NoirWalletProvider;
export type NoirWalletNetwork = "mainnet" | "testnet";

/**
 * Noir Wallet injects asynchronously and emits `noirwallet#initialized` when
 * its page-context provider is ready. Keep the SDK's short default window so a
 * missing extension never leaves this screen in a perpetual loading state.
 */
export const NOIR_PROVIDER_DETECTION_TIMEOUT_MS = 3_000;

export function detectNoirWallet(): NoirProvider | null {
  if (typeof window === "undefined") return null;
  const wallet = getNoirWallet();
  return wallet?.isNoirWallet === true ? wallet : null;
}

/**
 * Detect an already-injected provider immediately, otherwise wait once for
 * Noir Wallet's official initialization signal. This only observes injection;
 * it neither requests account access nor invokes any wallet action.
 */
export async function waitForNoirWallet(
  timeout = NOIR_PROVIDER_DETECTION_TIMEOUT_MS,
): Promise<NoirProvider | null> {
  const existing = detectNoirWallet();
  if (existing) return existing;

  try {
    await detectProvider(timeout);
    return detectNoirWallet();
  } catch {
    return null;
  }
}

/** Classify provider errors for UI without retaining or displaying raw wallet errors. */
export function noirWalletErrorState(error: unknown): "rejected" | "locked" | "syncing" | "failed" {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const code = candidate?.code;
  const message = typeof candidate?.message === "string" ? candidate.message.toLowerCase() : "";
  if (code === 4001 || /reject|declin|cancel/.test(message)) return "rejected";
  if (/locked|unlock/.test(message)) return "locked";
  if (/sync|scan|catching up/.test(message)) return "syncing";
  return "failed";
}

/**
 * Read-only adapter. `connect` is intentionally separate from detection so it
 * can only be reached from a deliberate UI action.
 */
export class NoirWalletAdapter {
  constructor(readonly provider: NoirProvider) {}

  getAccounts(): Promise<NoirConnection | null> {
    return this.provider.zcash.getAccounts();
  }

  connect(): Promise<NoirConnection> {
    return this.provider.zcash.connect();
  }

  getBalance(accountId: string): Promise<NoirBalance> {
    return this.provider.zcash.getBalance(accountId);
  }

  /**
   * Wallet-local activity, obtained through Noir Wallet's documented read API.
   * It is deliberately not correlated with, posted to, or reconciled by VeilPay.
   */
  getTransactionHistory(): Promise<NoirTransaction[]> {
    return this.provider.zcash.getTransactionHistory();
  }

  disconnect(): Promise<void> {
    return this.provider.zcash.disconnect();
  }

  onAccountsChanged(handler: (accounts: unknown) => void): () => void {
    this.provider.zcash.on("accountsChanged", handler);
    return () => this.provider.zcash.removeListener("accountsChanged", handler);
  }
}

/**
 * Noir Wallet ships mainnet and testnet as separate extensions. Although the
 * SDK documents a `chainChanged` event, it does not expose a synchronous
 * network getter for an account. Treat the returned address pair as the
 * network evidence and fail closed for unknown or mixed pairs. This is an
 * intentionally narrow prefix guard, not a full address validator.
 */
export function noirNetworkOfAddress(address: string | null | undefined): NoirWalletNetwork | null {
  const value = address?.trim().toLowerCase() ?? "";
  if (/^(u1|zs1|t1|t3)/.test(value)) return "mainnet";
  if (/^(utest1|ztestsapling1|tm|t2)/.test(value)) return "testnet";
  return null;
}

export function noirNetworkOfAccount(account: NoirAccount): NoirWalletNetwork | null {
  const networks = [
    noirNetworkOfAddress(account.addresses.transparent),
    noirNetworkOfAddress(account.addresses.shielded),
  ];
  return networks[0] && networks[0] === networks[1] ? networks[0] : null;
}

export function areNoirAccountsOnNetwork(accounts: NoirAccount[], expected: NoirWalletNetwork): boolean {
  return accounts.length > 0 && accounts.every((account) => noirNetworkOfAccount(account) === expected);
}
