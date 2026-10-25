"use client";

import { PlugZap, RefreshCw, ShieldCheck, Unplug, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoirWalletAdapter, noirWalletErrorState, type NoirAccount, type NoirBalance, waitForNoirWallet } from "@/lib/noir-wallet";
import { useNetworkMode } from "@/lib/api/data-source";
import { Badge, Button, Card, Notice } from "./ui";

type State = "checking" | "unavailable" | "disconnected" | "connecting" | "connected" | "locked" | "rejected" | "syncing" | "failed";
type Connected = { adapter: NoirWalletAdapter; accounts: NoirAccount[]; selectedId: string; balance: NoirBalance | null };

function accountName(account: NoirAccount) {
  return account.label || `Account ${account.accountId}`;
}

function amount(value: string | undefined) {
  return value === undefined ? "Not reported" : `${value} ZEC`;
}

/**
 * A client-only, read-only connection card. It is not rendered in VeilPay's
 * mock/regtest simulation, keeping the demo harness independent of extensions.
 */
export function NoirWalletCard() {
  const mode = useNetworkMode();
  const [state, setState] = useState<State>("checking");
  const [connected, setConnected] = useState<Connected | null>(null);
  const adapter = useRef<NoirWalletAdapter | null>(null);

  const clear = useCallback((next: State) => {
    setConnected(null);
    setState(next);
  }, []);

  const load = useCallback(async (nextAdapter: NoirWalletAdapter, preferredId?: string, nullMeansLocked = false) => {
    const connection = await nextAdapter.getAccounts();
    if (!connection || connection.accounts.length === 0) {
      clear(nullMeansLocked ? "locked" : "disconnected");
      return;
    }
    const selectedId = connection.accounts.some((account) => account.id === preferredId)
      ? preferredId!
      : connection.accounts[0].id;
    setConnected({ adapter: nextAdapter, accounts: connection.accounts, selectedId, balance: null });
    setState("connected");
    try {
      const balance = await nextAdapter.getBalance(selectedId);
      const selected = balance.accounts.find((account) => account.id === selectedId);
      setConnected((current) => current?.adapter === nextAdapter && current.selectedId === selectedId ? { ...current, balance } : current);
      setState(selected?.synced === false ? "syncing" : "connected");
    } catch (error) {
      const next = noirWalletErrorState(error);
      if (next === "locked") clear(next);
      else setState(next);
    }
  }, [clear]);

  useEffect(() => {
    if (mode.kind === "mock") return;
    let active = true;
    let unsubscribe: (() => void) | undefined;

    // The extension may inject after React hydrates. The SDK waits for its
    // official initialization event once, without opening an authorization UI.
    void waitForNoirWallet().then((provider) => {
      if (!active) return;
      if (!provider) {
        clear("unavailable");
        return;
      }
      const nextAdapter = new NoirWalletAdapter(provider);
      adapter.current = nextAdapter;
      // Silent restoration only. This does not request access or open the extension.
      void load(nextAdapter).catch((error) => clear(noirWalletErrorState(error)));
      unsubscribe = nextAdapter.onAccountsChanged((accountState) => {
        // Never reuse an account or balance after authorization/lock state changes.
        const locked = Array.isArray(accountState) && accountState.length === 0;
        clear(locked ? "locked" : "checking");
        void load(nextAdapter, undefined, locked).catch((error) => clear(noirWalletErrorState(error)));
      });
    });
    return () => {
      active = false;
      unsubscribe?.();
      adapter.current = null;
    };
  }, [clear, load, mode.kind]);

  const connect = async () => {
    const provider = adapter.current ? null : await waitForNoirWallet();
    const nextAdapter = adapter.current ?? (provider ? new NoirWalletAdapter(provider) : null);
    if (!nextAdapter) return clear("unavailable");
    adapter.current = nextAdapter;
    setState("connecting");
    try {
      // This is the only authorization-requesting call, reached by the button below.
      await nextAdapter.connect();
      await load(nextAdapter);
    } catch (error) {
      clear(noirWalletErrorState(error));
    }
  };

  const selectAccount = async (selectedId: string) => {
    if (!connected) return;
    setConnected({ ...connected, selectedId, balance: null });
    setState("checking");
    try {
      const balance = await connected.adapter.getBalance(selectedId);
      const selected = balance.accounts.find((account) => account.id === selectedId);
      setConnected((current) => current ? { ...current, selectedId, balance } : current);
      setState(selected?.synced === false ? "syncing" : "connected");
    } catch (error) {
      clear(noirWalletErrorState(error));
    }
  };

  const disconnect = async () => {
    if (!connected) return;
    setState("checking");
    try {
      await connected.adapter.disconnect();
      clear("disconnected");
    } catch (error) {
      setState(noirWalletErrorState(error));
    }
  };

  if (mode.kind === "mock") return null;
  const selectedBalance = connected?.balance?.accounts.find((account) => account.id === connected.selectedId)?.balance ?? connected?.balance ?? null;
  const isSynced = connected?.balance?.accounts.find((account) => account.id === connected.selectedId)?.synced;

  return (
    <Card title={<span className="flex items-center gap-2"><Wallet size={15} aria-hidden /> Noir Wallet</span>} testId="noir-wallet-card"
      action={<Badge tone={state === "connected" ? "success" : state === "syncing" || state === "checking" || state === "connecting" ? "progress" : "neutral"}>{state === "connected" ? "Connected" : state === "syncing" ? "Syncing" : "Read-only"}</Badge>}>
      {state === "unavailable" && <Notice tone="neutral" title="Noir Wallet was not detected on this page">Confirm that the official extension is enabled and allowed to access this site, then reload. VeilPay will not request access automatically.</Notice>}
      {state === "disconnected" && <p className="text-sm text-zinc-400">Connect an account to view Noir Wallet-reported balances. VeilPay cannot spend, sign, or broadcast from this screen.</p>}
      {state === "locked" && <p className="text-sm text-amber-200">Noir Wallet is locked. Unlock it in the extension, then reconnect.</p>}
      {state === "rejected" && <p className="text-sm text-zinc-400">Connection was declined. No account information was retained.</p>}
      {state === "failed" && <p className="text-sm text-rose-200">Noir Wallet could not provide account information. Nothing was saved or sent to VeilPay.</p>}
      {(state === "checking" || state === "connecting") && <p className="flex items-center gap-2 text-sm text-zinc-400"><RefreshCw size={14} className="animate-spin" aria-hidden /> Checking existing authorization without opening the wallet…</p>}
      {connected && (
        <div className="space-y-4">
          {connected.accounts.length > 1 && <label className="block text-sm text-zinc-300">Authorized account
            <select value={connected.selectedId} onChange={(event) => void selectAccount(event.target.value)} className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100" data-testid="noir-account-select">
              {connected.accounts.map((account) => <option key={account.id} value={account.id}>{accountName(account)}</option>)}
            </select>
          </label>}
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3" data-testid="noir-balances">
            <div><dt className="text-xs text-zinc-500">Shielded</dt><dd className="mt-1 font-medium tabular-nums text-zinc-100">{amount(selectedBalance?.shielded)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Available</dt><dd className="mt-1 font-medium tabular-nums text-zinc-100">{amount(selectedBalance?.available ?? selectedBalance?.spendable)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Total</dt><dd className="mt-1 font-medium tabular-nums text-zinc-100">{amount(selectedBalance?.total)}</dd></div>
          </dl>
          <p className="text-xs text-zinc-500" data-testid="noir-balance-source">Source: Noir Wallet-reported balance for the selected authorized account. {state === "syncing" || isSynced === false ? "Wallet sync is incomplete; do not rely on these amounts." : "Wallet reports this account as synced."} This is not a VeilPay budget or a settlement record.</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!connected && <Button onClick={() => void connect()} busy={state === "connecting"} data-testid="connect-noir-wallet"><PlugZap size={14} aria-hidden /> Connect Noir Wallet</Button>}
        {connected && <Button variant="secondary" onClick={() => void disconnect()} data-testid="disconnect-noir-wallet"><Unplug size={14} aria-hidden /> Disconnect and revoke site access</Button>}
      </div>
      <p className="mt-3 flex gap-2 text-xs text-zinc-500"><ShieldCheck size={14} className="shrink-0" aria-hidden /> This read-only connection never sends seed phrases, spending keys, viewing keys, wallet history, balances, or account data to VeilPay&apos;s backend, logs, analytics, or browser storage. Payments remain disabled.</p>
    </Card>
  );
}
