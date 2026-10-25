"use client";

import clsx from "clsx";
import { Check, Copy, PlugZap, RefreshCw, ShieldCheck, Unplug, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import type { NoirWalletUx } from "@/lib/wallet-ux/use-noir-wallet-ux";
import { accountName, formatWalletZec, shieldedKind, truncateAddress, walletStatusCopy, type WalletStatus } from "@/lib/wallet-ux/wallet-state";

const BADGE: Record<WalletStatus, { label: string; tone: "neutral" | "progress" | "success" | "warning" | "danger" }> = {
  off: { label: "Off", tone: "neutral" },
  checking: { label: "Checking", tone: "progress" },
  mobile_unsupported: { label: "Desktop only", tone: "neutral" },
  not_installed: { label: "Not installed", tone: "neutral" },
  disconnected: { label: "Not connected", tone: "neutral" },
  connecting: { label: "Connecting", tone: "progress" },
  connected: { label: "Connected · Read-only", tone: "success" },
  account_changed: { label: "Accounts changed", tone: "warning" },
  locked: { label: "Locked", tone: "warning" },
  rejected: { label: "Declined", tone: "neutral" },
  wrong_network: { label: "Wrong network", tone: "danger" },
  error: { label: "Error", tone: "danger" },
};

function BalanceRow({ label, value, synced, testId }: { label: string; value: string | undefined; synced: boolean; testId: string }) {
  const text = formatWalletZec(value, synced);
  return (
    <div className="rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={clsx("mt-0.5 font-medium tabular-nums", text === "Unavailable" ? "text-zinc-400" : "text-zinc-100")} data-testid={testId}>{text}</dd>
    </div>
  );
}

function AddressCopy({ value, name, testId }: { value: string; name: string; testId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" data-testid={testId} aria-label={`Copy shielded address of ${name}`}
        onClick={() => navigator.clipboard.writeText(value).then(() => setState("copied"), () => setState("failed"))}
        className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
        {state === "copied" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {state === "copied" ? "Copied" : "Copy address"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-zinc-500" data-testid={`${testId}-status`}>
        {state === "copied" ? "Copied to clipboard" : state === "failed" ? "Copy blocked. Hover the address to see it in full." : ""}
      </span>
    </span>
  );
}

export function AccountPicker({ wallet }: { wallet: NoirWalletUx }) {
  const { accounts, selectedId, status } = wallet;
  if (accounts.length === 0) return null;
  return (
    <fieldset className="space-y-2" data-testid="wallet-account-picker">
      <legend className="mb-1 text-sm font-medium text-zinc-300">
        {status === "account_changed" ? "Pick an account again" : "Authorized accounts"}
      </legend>
      {accounts.map((account) => {
        const active = status === "connected" && account.id === selectedId;
        const kind = shieldedKind(account.addresses?.shielded);
        return (
          <div key={account.id}
            className={clsx("flex flex-col gap-2 rounded-xl border p-3 text-sm sm:flex-row sm:items-center sm:justify-between",
              active ? "border-accent-700 bg-accent-950/40" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700")}
            data-testid={`wallet-account-${account.id}`}>
            <label className="flex min-w-0 cursor-pointer items-start gap-3">
              <input type="radio" name="wallet-account" value={account.id} checked={active}
                onChange={() => wallet.select(account.id)} className="mt-1 accent-current" aria-describedby={`addr-${account.id}`} />
              <span className="min-w-0">
                <span className="block font-medium text-zinc-100">{accountName(account)}</span>
                <span id={`addr-${account.id}`} className="mt-1 block space-y-0.5 text-xs text-zinc-400">
                  {account.addresses?.shielded && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="success">Shielded{kind ? ` · ${kind}` : ""}</Badge>
                      <span className="font-mono" title={account.addresses.shielded}>{truncateAddress(account.addresses.shielded)}</span>
                    </span>
                  )}
                  {account.addresses?.transparent && (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="warning">Transparent · public</Badge>
                      <span className="font-mono" title={account.addresses.transparent}>{truncateAddress(account.addresses.transparent)}</span>
                    </span>
                  )}
                </span>
              </span>
            </label>
            {account.addresses?.shielded && (
              <span className="shrink-0 self-start sm:self-center">
                <AddressCopy value={account.addresses.shielded} name={accountName(account)} testId={`copy-${account.id}`} />
              </span>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}

export function WalletPanel({ wallet }: { wallet: NoirWalletUx }) {
  const { status, balance, balanceLoading, detectedNetwork, expected } = wallet;
  const copy = walletStatusCopy(status, detectedNetwork, expected);
  const badge = BADGE[status];
  const showConnect = status === "disconnected" || status === "rejected" || status === "locked" || status === "connecting" || status === "wrong_network";
  const synced = balance?.synced === true;

  return (
    <Card testId="wallet-ux-panel"
      title={<span className="flex items-center gap-2"><Wallet size={15} aria-hidden /> Noir Wallet</span>}
      action={<Badge tone={badge.tone} testId="wallet-status-badge">{badge.label}</Badge>}>
      <div className="space-y-4" aria-live="polite">
        <Notice tone={copy.tone} title={copy.title} testId={`wallet-state-${status}`}>{copy.body}</Notice>

        {(status === "connected" || status === "account_changed") && <AccountPicker wallet={wallet} />}

        {status === "connected" && (
          <section aria-label="Wallet-reported balance" data-testid="wallet-balance">
            {balanceLoading ? (
              <p className="flex items-center gap-2 text-sm text-zinc-400"><RefreshCw size={14} className="animate-spin" aria-hidden /> Reading balance from Noir Wallet…</p>
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                  <BalanceRow label="Shielded" value={balance?.values.shielded} synced={synced} testId="wallet-balance-shielded" />
                  <BalanceRow label="Available" value={balance?.values.available} synced={synced} testId="wallet-balance-available" />
                  <BalanceRow label="Total" value={balance?.values.total} synced={synced} testId="wallet-balance-total" />
                </dl>
                <p className="mt-2 text-xs text-zinc-500" data-testid="wallet-balance-note">
                  {synced
                    ? "Reported by Noir Wallet for this account, which it says is synced. Not a VeilPay budget and not a settlement record."
                    : "Noir Wallet has not finished syncing this account, so amounts are shown as Unavailable rather than 0."}
                </p>
              </>
            )}
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {showConnect && (
            <Button onClick={() => void wallet.connect()} busy={status === "connecting"} data-testid="wallet-connect">
              <PlugZap size={14} aria-hidden /> {status === "disconnected" || status === "connecting" ? "Connect Noir Wallet" : "Connect again"}
            </Button>
          )}
          {status === "error" && (
            <Button variant="secondary" onClick={wallet.retry} data-testid="wallet-retry"><RefreshCw size={14} aria-hidden /> Try again</Button>
          )}
          {(status === "connected" || status === "account_changed") && (
            <Button variant="secondary" onClick={() => void wallet.disconnect()} data-testid="wallet-disconnect">
              <Unplug size={14} aria-hidden /> Disconnect and revoke site access
            </Button>
          )}
        </div>

        <p className="flex gap-2 text-xs text-zinc-500">
          <ShieldCheck size={14} className="shrink-0" aria-hidden />
          Read-only. VeilPay never asks for seed phrases or keys, never signs or sends, and does not read your transaction history. Wallet data stays on this page and is not saved.
        </p>
      </div>
    </Card>
  );
}
