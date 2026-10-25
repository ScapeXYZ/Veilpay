"use client";

import clsx from "clsx";
import { Eye, EyeOff, Globe, Server, Store, User } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/shell";
import { SourceTag } from "@/components/source";
import { Card, Notice, Zec } from "@/components/ui";
import { usePayments, useSession } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { isSimulatedPayment, paymentStatusLabel, privacyEvidence } from "@/lib/present";
import { useNetworkMode } from "@/lib/api/data-source";
import { Term } from "@/components/term";

const LENSES = [
  { id: "public", label: "Anyone online", icon: Globe },
  { id: "merchant", label: "Merchant", icon: Store },
  { id: "owner", label: "You (owner)", icon: User },
  { id: "operator", label: "Operator", icon: Server },
] as const;
type LensId = (typeof LENSES)[number]["id"];

function List({ title, items, icon, testId, tone }: { title: string; items?: string[]; icon: ReactNode; testId: string; tone: string }) {
  return (
    <div className={clsx("rounded-xl border p-4", tone)} data-testid={testId}>
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">{icon}{title}</div>
      {items && items.length > 0 ? (
        <ul className="space-y-1.5 text-sm text-zinc-300">
          {items.map((i) => (
            <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-zinc-500" aria-hidden />{i}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">Not available for this payment.</p>
      )}
    </div>
  );
}

function OperatorLens() {
  return (
    <div className="rounded-xl border border-orange-900/70 bg-orange-950/10 p-4" data-testid="lens-operator">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100"><Server size={16} className="text-orange-300" aria-hidden />What the operator holds</div>
      <ul className="space-y-2 text-sm text-zinc-300">
        <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-orange-300" aria-hidden />The merchant&apos;s <Term k="viewingKey">viewing key</Term>, to check its receipts on the server. It covers the whole merchant account and is held for them, so it is not proof about one single payment.</li>
        <li className="flex gap-2"><Eye size={15} className="mt-0.5 shrink-0 text-orange-300" aria-hidden />The test wallet that sends payments. You do not hold its keys yourself.</li>
        <li className="flex gap-2"><EyeOff size={15} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />Never in this browser: wallet recovery phrases, spending keys, viewing keys, or transaction IDs in a link.</li>
      </ul>
    </div>
  );
}

function Lens({ p, lens }: { p: Payment; lens: LensId }) {
  const l = p.privacy;
  if (lens === "operator") return <OperatorLens />;
  if (lens === "public")
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <List testId="lens-public" title="Anyone looking at the network sees" items={l?.publicChainSees} icon={<Globe size={16} className="text-zinc-400" aria-hidden />} tone="border-zinc-800 bg-zinc-950/40" />
        <List testId="lens-hidden" title="Designed to stay private" items={l?.hiddenOnChain} icon={<EyeOff size={16} className="text-emerald-400" aria-hidden />} tone="border-emerald-900/70 bg-emerald-950/15" />
      </div>
    );
  if (lens === "merchant") return <List testId="lens-merchant" title="The merchant sees" items={l?.merchantSees} icon={<Store size={16} className="text-accent-300" aria-hidden />} tone="border-accent-900 bg-accent-950/30" />;
  return <List testId="lens-customer" title="You, the owner, see" items={l?.customerSees} icon={<User size={16} className="text-sky-300" aria-hidden />} tone="border-sky-900 bg-sky-950/20" />;
}

export default function PrivacyPage() {
  const { data: s } = useSession();
  const { data } = usePayments(s?.context === "customer");
  const withLens = (data?.items ?? []).filter((p) => p.privacy);
  const [selId, setSelId] = useState<string | null>(null);
  const [lens, setLens] = useState<LensId>("public");
  const modeIsMock = useNetworkMode().kind === "mock";
  const sel = withLens.find((p) => p.id === selId) ?? withLens.find((p) => p.pool) ?? withLens[0];
  return (
    <>
      <PageHeader title="Privacy" subtitle="Who is meant to see what about a payment. VeilPay is designed for shielded Zcash, where amounts, sender, receiver and notes are not public. This page explains the design; it does not verify it on a real network." />
      {!sel ? (
        <Notice tone="neutral" title="No payment to show yet">
          Open this page in the owner view, or make a payment first.
        </Notice>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card title="Payment" className="!p-3" action={<SourceTag />}>
            <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto" role="listbox" aria-label="Payment for the privacy lens">
              {withLens.map((p) => (
                <button key={p.id} role="option" aria-selected={p.id === sel.id} onClick={() => setSelId(p.id)}
                  className={clsx("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm", p.id === sel.id ? "bg-zinc-800 ring-1 ring-zinc-700" : "hover:bg-zinc-950")}>
                  <span className="min-w-0"><span className="block truncate text-zinc-100">{p.reference}</span><span className="text-xs text-zinc-500">{paymentStatusLabel(p, isSimulatedPayment(p, modeIsMock)).label}{p.pool ? ` · ${isSimulatedPayment(p, modeIsMock) ? "simulated " : ""}${p.pool}` : ""}</span></span>
                  <Zec zat={p.amountZat} className="shrink-0 text-xs text-zinc-300" />
                </button>
              ))}
            </div>
          </Card>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-1 rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800" role="tablist" aria-label="Lens">
              {LENSES.map(({ id, label, icon: Icon }) => (
                <button key={id} role="tab" aria-selected={lens === id} onClick={() => setLens(id)} data-testid={`tab-${id}`}
                  className={clsx("flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm", lens === id ? "bg-accent-950 text-accent-200 ring-1 ring-inset ring-accent-900" : "text-zinc-400 hover:text-zinc-100")}>
                  <Icon size={14} aria-hidden /> {label}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              <Lens p={sel} lens={lens} />
            </div>
            <p className="text-xs text-zinc-500" data-testid="lens-evidence">
              Based on what the VeilPay server reports for {sel.reference}
              {privacyEvidence(sel, isSimulatedPayment(sel, modeIsMock))}. Even with shielded payments, the public can see that a transaction happened, when, and its fee. This page does not check the network itself.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
