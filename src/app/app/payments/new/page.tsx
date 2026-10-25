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
import { Term } from "@/components/term";

const STEPS = ["Invoice", "Rules check", "Ready to send", "On the network", "Merchant confirms"] as const;

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
          <span className="tabular-nums">{i + 1}.</span> {s}
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
        { id: "within", label: "Within the rules · 0.12 ZEC", p: { invoiceId: SEED_IDS.happyDemoInvoice, zec: "0.12", reference: "INV-1001 single-origin beans" } },
        { id: "over", label: "Over the limit · 0.75 ZEC", p: { invoiceId: SEED_IDS.blockedDemoInvoice, zec: "0.75", reference: "INV-1002 espresso machine" } },
      ]
    : [{ id: "blank", label: "Blank", p: { invoiceId: "", zec: "", reference: "" } }];
  const [preset, setPreset] = useState(presets[0]);
  const [created, setCreated] = useState<Payment | null>(null);
  const { data: live } = usePayment(created && created.status !== "rejected" ? created.id : null);
  const p = live ?? created;

  if (mode.kind === "mainnet_readonly")
    return <MainnetPaymentDisabled />;

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
          <RequestComposer key={preset.id} preset={preset.p} cta="Check against my rules" onResult={setCreated} testId="request-new" />
          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-zinc-800 pt-4 text-sm">
            <dt className="text-zinc-500">Network</dt><dd className="text-zinc-200">{mode.kind === "mock" ? "Practice (simulation)" : <Term k="testnet">Test network</Term>}</dd>
            <dt className="text-zinc-500">Paid to</dt><dd className="text-zinc-300">The merchant on the invoice. VeilPay looks up the address; you never paste one.</dd>
            <dt className="text-zinc-500">Network fee</dt><dd className="text-zinc-400" data-testid="fee-unavailable">Not shown yet · never guessed</dd>
            <dt className="text-zinc-500">Total</dt><dd className="text-zinc-400">The amount, plus a small network fee</dd>
          </dl>
        </Card>
        <div className="flex flex-col gap-4">
          {!p ? (
            <Card title="What happens next">
              <ol className="space-y-2 text-sm text-zinc-400">
                <li>2. VeilPay checks the amount, budget and merchant against your rules. If it is blocked you see exactly which rule, and no money moves.</li>
                <li>3. Approved means the money is set aside, not paid yet.{mode.kind === "testnet_manual" ? " An operator then sends it." : ""}</li>
                <li>4. It counts as paid only once the VeilPay server reports enough network confirmations (simulated in practice mode).</li>
                <li>5. The merchant checks that its invoice was paid.</li>
              </ol>
            </Card>
          ) : p.status === "rejected" ? (
            <Card title="2 · Rules check" testId="new-rejected">
              <DecisionPanel d={p.decision} />
              <p className="mt-3 text-sm text-zinc-400">No money moved and nothing was set aside. Raise the limit in Spending rules only if you really mean to, not just to push one payment through.</p>
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

function MainnetPaymentDisabled() {
  return (
    <Notice tone="info" title={<span className="flex items-center gap-2"><Lock size={14} aria-hidden /> No new payments on mainnet</span>} testId="new-payment-mainnet">
      VeilPay only watches the main network; it never requests or sends payments there. Existing observations are in <Link href="/app/activity" className="text-accent-300 underline">Activity</Link>.
    </Notice>
  );
}

function NewPaymentRoute() {
  const mode = useNetworkMode();
  // A confirmed mainnet report is sufficient to fail closed. Do this before
  // the customer-session gate, because mainnet intentionally has no session
  // or payment-request surface at all.
  if (mode.kind === "mainnet_readonly") return <MainnetPaymentDisabled />;
  if (mode.kind === "unknown") return <Notice tone="neutral" title="Payment requests unavailable">VeilPay cannot confirm server status, so payment requests remain disabled.</Notice>;
  return <RequireContext ctx="customer"><NewPayment /></RequireContext>;
}

export default function NewPaymentPage() {
  const mode = useNetworkMode();
  return (
    <>
      <PageHeader title="New payment request" subtitle={mode.kind === "unknown" ? "Server status is unavailable. Payment requests are disabled." : "Check a payment against your rules before anything moves. Nothing counts as paid until the VeilPay server reports enough network confirmations; in practice mode they are simulated."} />
      <NewPaymentRoute />
    </>
  );
}
