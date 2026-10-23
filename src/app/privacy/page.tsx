"use client";

import { Eye, EyeOff, Globe, Server, Store, User } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell";
import { SourceTag } from "@/components/source";
import { Card, Notice } from "@/components/ui";
import { usePayments, useSession } from "@/lib/api/hooks";
import type { PrivacyLens } from "@/lib/contract/schemas";

function Column({ icon, title, items, tone, testId }: { icon: ReactNode; title: string; items?: string[]; tone: string; testId: string }) {
  return (
    <div className={`rounded-xl border p-4 ${tone}`} data-testid={testId}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </div>
      {items && items.length > 0 ? (
        <ul className="space-y-1.5 text-sm text-zinc-300">
          {items.map((i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-500" />
              {i}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">Not provided by the backend.</p>
      )}
    </div>
  );
}

export default function PrivacyPage() {
  const { data: s } = useSession();
  const { data } = usePayments(s?.context === "customer");
  const sample = data?.items.find((p) => p.privacy && p.pool) ?? data?.items.find((p) => p.privacy);
  const lens: PrivacyLens | undefined = sample?.privacy;
  return (
    <>
      <PageHeader title="Privacy lens" subtitle="Who can see what about an agent payment. The lists come from the backend per payment; this page does not invent them." />
      {!lens ? (
        <Notice tone="neutral" title="Open this as the customer to load a payment's lens">
          The lens is attached to each payment by the backend. Switch to the customer context.
        </Notice>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            Lens for <span className="text-zinc-200">{sample?.reference}</span>
            {sample?.pool && <span>· {sample.pool} pool</span>}
            <SourceTag />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Column testId="lens-public" icon={<Globe size={16} className="text-zinc-400" aria-hidden />} title="Anyone watching the chain sees" items={lens.publicChainSees} tone="border-zinc-800 bg-zinc-900/60" />
            <Column testId="lens-hidden" icon={<EyeOff size={16} className="text-emerald-400" aria-hidden />} title="Hidden on chain" items={lens.hiddenOnChain} tone="border-emerald-900 bg-emerald-950/20" />
            <Column testId="lens-merchant" icon={<Store size={16} className="text-amber-300" aria-hidden />} title="The merchant sees" items={lens.merchantSees} tone="border-amber-900/70 bg-amber-950/10" />
            <Column testId="lens-customer" icon={<User size={16} className="text-sky-300" aria-hidden />} title="The agent's owner sees" items={lens.customerSees} tone="border-sky-900 bg-sky-950/20" />
          </div>
        </>
      )}
      <Card title={<span className="flex items-center gap-2"><Server size={15} aria-hidden /> What the operator holds (demo)</span>} testId="lens-operator">
        <ul className="space-y-2 text-sm text-zinc-300">
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-orange-300" aria-hidden />The merchant&apos;s incoming viewing key, to scan receipts server-side. Custodial: in production the merchant runs this.</li>
          <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-orange-300" aria-hidden />The customer wallet used for testnet sends.</li>
          <li className="flex gap-2"><EyeOff size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />Never in the browser: keys, seeds, addresses of the customer wallet, or txids in any URL.</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">Viewing keys are used for selective disclosure only. No broad key is ever published.</p>
      </Card>
    </>
  );
}
