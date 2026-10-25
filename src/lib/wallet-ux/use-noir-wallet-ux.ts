"use client";

/**
 * React hook driving the wallet UX state machine through the existing read-only
 * Noir Wallet adapter. Only adapter methods are used: getAccounts (silent),
 * connect (user click only), getBalance, disconnect, onAccountsChanged.
 * No signing, sending or history calls exist on this path. Wallet data stays in
 * memory and is never persisted or sent to the VeilPay API.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { NoirWalletAdapter, detectNoirWallet, noirWalletErrorState } from "@/lib/noir-wallet";
import { initialWalletState, isMobileBrowser, walletReducer, type WalletNetwork, type WalletState } from "./wallet-state";

export type NoirWalletUx = WalletState & {
  expected: WalletNetwork | null;
  connect: () => Promise<void>;
  select: (accountId: string) => void;
  disconnect: () => Promise<void>;
  retry: () => void;
};

export function useNoirWalletUx(expected: WalletNetwork | null): NoirWalletUx {
  const [state, dispatch] = useReducer(walletReducer, initialWalletState);
  const adapter = useRef<NoirWalletAdapter | null>(null);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);

  const loadAccounts = useCallback(async (a: NoirWalletAdapter, net: WalletNetwork, afterChange = false) => {
    const gen = generation.current;
    const connection = await a.getAccounts();
    if (gen !== generation.current) return;
    if (!connection || connection.accounts.length === 0) dispatch(afterChange ? { type: "accounts_changed", payload: null } : { type: "restore_none" });
    else dispatch({ type: "accounts", accounts: connection.accounts, expected: net, afterChange });
  }, []);

  const start = useCallback(() => {
    void attempt; // bump to re-run detection (retry)
    generation.current += 1;
    if (!expected) {
      dispatch({ type: "off" });
      return () => undefined;
    }
    const provider = detectNoirWallet();
    if (!provider) {
      dispatch({ type: "provider_missing", mobile: isMobileBrowser(typeof navigator === "undefined" ? undefined : navigator) });
      return () => undefined;
    }
    const a = new NoirWalletAdapter(provider);
    adapter.current = a;
    // Silent restore only: never opens the extension.
    loadAccounts(a, expected).catch((e) => dispatch({ type: "error", kind: noirWalletErrorState(e) }));
    const unsubscribe = a.onAccountsChanged((payload) => {
      generation.current += 1;
      dispatch({ type: "accounts_changed", payload });
      const isList = Array.isArray(payload) && payload.length > 0;
      if (isList) loadAccounts(a, expected, true).catch((e) => dispatch({ type: "error", kind: noirWalletErrorState(e) }));
    });
    return () => {
      unsubscribe();
      if (adapter.current === a) adapter.current = null;
    };
  }, [expected, loadAccounts, attempt]);

  useEffect(() => {
    let cleanup: () => void = () => undefined;
    let live = true;
    // Deferred so the effect body itself never sets state synchronously.
    void Promise.resolve().then(() => {
      if (live) cleanup = start();
    });
    return () => {
      live = false;
      cleanup();
    };
  }, [start]);

  // Fetch the balance for the selected account whenever one is pending.
  useEffect(() => {
    const a = adapter.current;
    const id = state.selectedId;
    if (state.status !== "connected" || !state.balanceLoading || !a || !id) return;
    let live = true;
    a.getBalance(id)
      .then((result) => live && dispatch({ type: "balance", accountId: id, result }))
      .catch((e) => live && dispatch({ type: "error", kind: noirWalletErrorState(e) }));
    return () => {
      live = false;
    };
  }, [state.status, state.balanceLoading, state.selectedId]);

  const connect = useCallback(async () => {
    if (!expected) return;
    const a = adapter.current ?? (() => {
      const p = detectNoirWallet();
      return p ? new NoirWalletAdapter(p) : null;
    })();
    if (!a) {
      dispatch({ type: "provider_missing", mobile: isMobileBrowser(typeof navigator === "undefined" ? undefined : navigator) });
      return;
    }
    adapter.current = a;
    generation.current += 1;
    dispatch({ type: "connect_start" });
    try {
      // The only authorization request, reachable from a button click.
      await a.connect();
      await loadAccounts(a, expected);
    } catch (e) {
      dispatch({ type: "error", kind: noirWalletErrorState(e) });
    }
  }, [expected, loadAccounts]);

  const select = useCallback((accountId: string) => dispatch({ type: "select", accountId }), []);

  const disconnect = useCallback(async () => {
    const a = adapter.current;
    generation.current += 1;
    if (!a) {
      dispatch({ type: "disconnected" });
      return;
    }
    try {
      await a.disconnect();
      dispatch({ type: "disconnected" });
    } catch (e) {
      dispatch({ type: "error", kind: noirWalletErrorState(e) });
    }
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, expected, connect, select, disconnect, retry };
}
