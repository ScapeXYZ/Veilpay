"use client";

import { ArrowRight, Bot, Store } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AgentSummary } from "@/components/agent-summary";
import { DecisionPanel, PaymentDetail } from "@/components/payment";
import { RequestComposer, type RequestPreset } from "@/components/request-composer";
import { PageHeader, RequireContext } from "@/components/shell";
import { Card, Zec } from "@/components/ui";
import { useApi, usePayment, usePayments } from "@/lib/api/hooks";
import { SEED_IDS } from "@/lib/api/fixtures";
import type { Payment } from "@/lib/contract/schemas";

function presets(mock: boolean): { blocked: RequestPreset; happy: RequestPreset } {
  // Mock-only invoice ids; in live mode the invoice id comes from the merchant view.
  return {
    blocked: { invoiceId: mock ? SEED_IDS.blockedDemoInvoice : "", zec: "0.75", reference: "INV-1002 espresso machine" },
    happy: { invoiceId: mock ? SEED_IDS.happyDemoInvoice : "", zec: "0.12", reference: "INV-1001 single-origin beans" },
  };
}

function BlockedOpener() {
  const api = useApi();
  const { data: list } = usePayments();
  const [mine, setMine] = useState<Payment | null>(null);
  const latestRejected = list?.items.find((p) => p.status === "rejected");
  const shown = mine?.status === "rejected" ? mine : latestRejected;
  const p = presets(api.mode === "mock");
  return (
    <Card testId="blocked-opener" className="border-rose-950 bg-gradient-to-b from-rose-950/30 to-zinc-900/60">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-950 text-rose-300">
          <Bot size={20} aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold">The agent tried to overspend. The backend said no.</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Policy lives on the server, not in the agent and not in this page. Every request is checked before a single zatoshi can move.
          </p>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          {shown ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-zinc-300">{shown.reference}</span>
                <Zec zat={shown.amountZat} className="text-lg text-zinc-50" />
              </div>
              <DecisionPanel d={shown.decision} compact />
              <p className="text-xs text-zinc-500">Status: blocked by policy. No funds moved, nothing reserved.</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No blocked request yet. Replay one on the right.</p>
          )}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Replay it live</div>
          <RequestComposer preset={p.blocked} cta="Agent: request this payment" onResult={setMine} testId="replay-blocked" />
        </div>
      </div>
    </Card>
  );
}

function HappyPath() {
  const api = useApi();
  const [created, setCreated] = useState<Payment | null>(null);
  const { data: live } = usePayment(created?.id ?? null);
  const p = live ?? created;
  return (
    <Card testId="happy-path" title="Then a request inside the policy">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <RequestComposer preset={presets(api.mode === "mock").happy} cta="Agent: request this payment" onResult={setCreated} testId="request-happy" />
        <div>
          {p ? (
            <PaymentDetail p={p} />
          ) : (
            <ol className="space-y-2 text-sm text-zinc-400">
              <li>1. Agent requests. Backend checks cap, budget, merchant, invoice.</li>
              <li>2. Approved = reserved, not paid. Execute sends once, shielded.</li>
              <li>3. Only confirmed on chain counts as paid.</li>
              <li>4. The merchant verifies the receipt for this invoice with their own key, no customer key handed over.</li>
            </ol>
          )}
          {p && (p.status === "confirmed" || p.status === "confirming") && (
            <Link href="/merchant" className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-300 hover:text-amber-200" data-testid="go-merchant">
              <Store size={14} aria-hidden /> Verify it as the merchant <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function Overview() {
  return (
    <>
      <PageHeader
        title="Agent spending, shielded and on a leash"
        subtitle="An AI agent pays merchants in shielded ZEC. The backend enforces the owner's policy, the chain hides the details, and the merchant verifies receipt on their side."
      />
      <RequireContext ctx="customer">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-5">
            <BlockedOpener />
            <HappyPath />
          </div>
          <div className="flex flex-col gap-5">
            <AgentSummary />
          </div>
        </div>
      </RequireContext>
    </>
  );
}
