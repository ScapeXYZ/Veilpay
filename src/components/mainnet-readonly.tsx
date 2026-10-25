import Link from "next/link";
import { Notice } from "./ui";

/** Shared live surface for pages whose demo data has no mainnet equivalent. */
export function MainnetReadOnlyNotice({ area }: { area: string }) {
  return (
    <Notice tone="neutral" title={`${area} is unavailable until a verified mainnet observer is connected`}>
      VeilPay does not create demo sessions, budgets, invoices, payment requests, or simulated confirmations on mainnet.
      <span className="mt-2 block">Connect Noir Wallet on the <Link href="/app" className="text-accent-300 underline">Overview</Link> to view wallet-reported addresses, balances, and local wallet activity. Sending remains disabled.</span>
    </Notice>
  );
}
