"use client";

import clsx from "clsx";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DecisionPanel, PaymentDetail } from "@/components/payment";
import { RequestComposer, type RequestPreset } from "@/components/request-composer";
import { PageHeader, RequireContext } from "@/components/shell";
import { Card, Notice } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { useApi, usePayment } from "@/lib/api/hooks";
import { SEED_IDS } from "@/lib/api/fixtures";
import type { Payment } from "@/lib/contract/schemas";

const STEPS = ["Review invoice", "Policy check", "Stage", "Observe", "Merchant verifies"] as const;

function stepOf(p: Payment | null): number {
  if (!p) return 0;
  if (p.status === "rejected") return 1;
  if (p.status === "authorized") return 2;
  if (p.status === "confirmed") return 4;
  return 3;
}

function Rail({ at, blocked }: { at: number; blocked: boolean }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Payment steps" data-testid="payment-steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? "step" : undefined}
          className={clsx("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset",
            i === at ? (blocked ? "bg-rose-950 text-rose-200 ring-rose-900" : "bg-accent-950 text-accent-200 ring-accent-900")
              : i < at ? "text-zinc-300 ring-zinc-700" : "text-zinc-500 ring-zinc-800")}>
          <span className="font-mono">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

function NewPayment() {
  const api = useApi();
  const mode = useNetworkMode();
  const mock = api.mode === "mock";
  const presets: { id: string; label: string; p: RequestPreset }[] = mock
    ? [
        { id: "within", label: "Within policy · 0.12 ZEC", p: { invoiceId: SEED_IDS.happyDemoInvoice, zec: "0.12", reference: "INV-1001 single-origin beans" } },
        { id: "over", label: "Over the cap · 0.75 ZEC", p: { invoiceId: SEED_IDS.blockedDemoInvoice, zec: "0.75", reference: "INV-1002 espresso machine" } },
      ]
    : [{ id: "blank", label: "Blank", p: { invoiceId: "", zec: "", reference: "" } }];
  const [preset, setPreset] = useState(presets[0]);
  const [created, setCreated] = useState<Payment | null>(null);
  const { data: live } = usePayment(created && created.status !== "rejected" ? created.id : null);
  const p = live ?? created;

  if (mode.kind === "mainnet_readonly")
    return (
      <Notice tone="info" title={<span className="flex items-center gap-2"><Lock size={14} aria-hidden /> No new payments on mainnet</span>} testId="new-payment-mainnet">
        VeilPay observes mainnet; it does not request, stage or send there. Existing observations are in <Link href="/app/activity" className="text-accent-300 underline">Activity</Link>.
      </Notice>
    );

  return (
    <div className="flex flex-col gap-5">
      <Rail at={stepOf(p)} blocked={p?.status === "rejected"} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card title="1 · Review the invoice" testId="review-card">
          {presets.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Sample requests">
              {presets.map((x) => (
                <button key={x.id} onClick={() => { setPreset(x); setCreated(null); }} aria-pressed={preset.id === x.id}
                  className={clsx("rounded-md px-2.5 py-1 text-xs ring-1 ring-inset", preset.id === x.id ? "bg-zinc-800 text-zinc-50 ring-zinc-600" : "text-zinc-400 ring-zinc-800 hover:bg-zinc-900")}>
                  {x.label}
                </button>
              ))}
            </div>
          )}
          <RequestComposer key={preset.id} preset={preset.p} cta="Request payment (policy check)" onResult={setCreated} testId="request-new" />
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-zinc-800 pt-4 text-sm">
            <dt className="text-zinc-500">Network</dt><dd className="text-zinc-200">{mode.kind === "mock" ? "Simulation" : "Testnet"}</dd>
            <dt className="text-zinc-500">Receiver</dt><dd className="text-zinc-300">Resolved by the backend from the invoice. Never put in a URL.</dd>
            <dt className="text-zinc-500">Network fee</dt><dd className="text-zinc-400" data-testid="fee-unavailable">Unavailable · not estimated in the browser</dd>
            <dt className="text-zinc-500">Total debit</dt><dd className="text-zinc-400">Amount plus a fee the operator approves</dd>
          </dl>
        </Card>
        <div className="flex flex-col gap-4">
          {!p ? (
            <Card title="What happens next">
              <ol className="space-y-2 text-sm text-zinc-400">
                <li>2. The backend checks cap, budget, merchant and invoice. A rejection names the exact limit and moves no funds.</li>
                <li>3. Approved means reserved, not paid.{mode.kind === "testnet_manual" ? " It is then staged for an operator." : ""}</li>
                <li>4. Only confirmations the backend observes count.</li>
                <li>5. The merchant verifies the receipt for its own invoice.</li>
              </ol>
            </Card>
          ) : p.status === "rejected" ? (
            <Card title="2 · Policy check" testId="new-rejected">
              <DecisionPanel d={p.decision} />
              <p className="mt-3 text-sm text-zinc-400">No transfer happened and nothing was reserved. The limit is the owner&apos;s; change the policy only if the owner agrees, never to get one request through.</p>
            </Card>
          ) : (
            <Card testId="new-approved">
              <PaymentDetail p={p} />
              <Link href={`/app/payments/${p.id}`} className="mt-4 inline-flex items-center gap-1 text-sm text-accent-300 hover:text-accent-200" data-testid="open-payment">
                Open payment page <ArrowRight size={13} aria-hidden />
              </Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function NewPaymentPage() {
  return (
    <>
      <PageHeader title="New payment request" subtitle="One decision at a time: the exact request, the backend's policy result, then evidence. Nothing is paid until it is observed." />
      <RequireContext ctx="customer">
        <NewPayment />
      </RequireContext>
    </>
  );
}
