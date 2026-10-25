"use client";

import { PageHeader } from "@/components/shell";
import { Notice } from "@/components/ui";
import { BusinessOnboarding } from "@/components/wallet-ux/business-onboarding";
import { WalletPanel } from "@/components/wallet-ux/wallet-panel";
import { useNetworkMode } from "@/lib/api/data-source";
import { useNoirWalletUx } from "@/lib/wallet-ux/use-noir-wallet-ux";
import { expectedWalletNetwork } from "@/lib/wallet-ux/wallet-state";

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

export default function WalletPage() {
  const mode = useNetworkMode();
  const expected = expectedWalletNetwork(mode.kind);
  const wallet = useNoirWalletUx(expected);
  return (
    <>
      <PageHeader title="Wallet" subtitle="Connect Noir Wallet read-only and set up your business. VeilPay never signs, sends or registers anything here." />
      {expected ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <WalletPanel wallet={wallet} />
          <BusinessOnboarding wallet={wallet} />
        </div>
      ) : (
        <WalletOff kind={mode.kind} />
      )}
    </>
  );
}
