"use client";

import { PageHeader } from "@/components/shell";
import { Card, Notice } from "@/components/ui";
import { NoirWalletCard } from "@/components/noir-wallet-card";
import { ADDRESS_FACT, AddressChip } from "@/components/sealed/address-chip";
import { useNetworkMode } from "@/lib/api/data-source";

function WalletOff({ kind }: { kind: string }) {
  if (kind === "mock")
    return (
      <Notice tone="neutral" title="Wallet connection is off in the practice simulation" testId="wallet-off-mock">
        This practice copy of VeilPay never reads a real wallet. Real Noir Wallet connection appears only when VeilPay runs against a mainnet or testnet server.
      </Notice>
    );
  return (
    <Notice tone="warning" title="Wallet connection paused" testId="wallet-off-unknown">
      VeilPay cannot confirm which network the server is on, so it does not offer a wallet connection. Nothing is read from any wallet.
    </Notice>
  );
}

/** What VeilPay reads and what it never sees, in the same sealed/open language as the chips. */
function ReadsSheet() {
  return (
    <Card testId="wallet-reads-sheet" title={<span className="font-display text-lg">What this page reads</span>}>
      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium text-zinc-400">Reads, only after you click Connect</div>
          <ul className="mt-2 flex flex-col gap-1.5 text-zinc-300">
            <li>Account names you share from Noir Wallet</li>
            <li>Their shielded and transparent addresses</li>
            <li>Balances as the wallet reports them, or &ldquo;Unavailable&rdquo;</li>
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium text-zinc-400">Never sees or does</div>
          <ul className="mt-2 flex flex-col gap-1.5 text-zinc-300">
            <li>Your keys or seed phrase</li>
            <li>Transaction memos; wallet activity is displayed only as Noir Wallet reports it</li>
            <li>Signing or sending. This build can&apos;t send from your wallet.</li>
          </ul>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-xs text-zinc-400">
        <span className="flex flex-wrap items-center gap-2"><AddressChip kind="shielded" testId="reads-chip-shielded" /> {ADDRESS_FACT.shielded}</span>
        <span className="flex flex-wrap items-center gap-2"><AddressChip kind="transparent" testId="reads-chip-transparent" /> {ADDRESS_FACT.transparent}</span>
      </div>
    </Card>
  );
}

export default function WalletPage() {
  const mode = useNetworkMode();
  const walletAvailable = mode.kind === "mainnet_readonly" || mode.kind === "testnet" || mode.kind === "testnet_manual" || mode.kind === "disabled" || mode.kind === "unknown";
  const networkLabel = mode.kind === "mainnet_readonly" ? "mainnet" : mode.kind === "testnet" || mode.kind === "testnet_manual" || mode.kind === "disabled" ? "testnet" : "wallet";
  return (
    <>
      <PageHeader title="Wallet & privacy" subtitle={networkLabel === "wallet" ? "Connect Noir Wallet to view its reported data once network health is confirmed. VeilPay never signs, sends, registers, or stores wallet data here." : `Connect Noir Wallet to view its ${networkLabel}-reported data. VeilPay never signs, sends, registers, or stores wallet data here.`} />
      {/* Overview and this route deliberately mount one canonical read-only
          observation component. No separate setup state can retain a stale
          account, balance, or network decision. */}
      {walletAvailable ? <NoirWalletCard allowWhenBackendUnavailable /> : <WalletOff kind={mode.kind} />}
      <ReadsSheet />
    </>
  );
}
