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
} from "@noir-wallet/sdk";

export type NoirConnection = ZcashConnectResult;
export type NoirAccount = ZcashAccount;
export type NoirBalance = ZcashBalanceResult;
export type NoirProvider = NoirWalletProvider;

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

  disconnect(): Promise<void> {
    return this.provider.zcash.disconnect();
  }

  onAccountsChanged(handler: (accounts: unknown) => void): () => void {
    this.provider.zcash.on("accountsChanged", handler);
    return () => this.provider.zcash.removeListener("accountsChanged", handler);
  }
}
