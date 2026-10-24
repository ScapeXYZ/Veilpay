"use client";

import clsx from "clsx";
import { ArrowLeft, ArrowRight, FlaskConical, RotateCcw, SkipForward } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { DecisionPanel, PaymentDetail } from "@/components/payment";
import { PublicShell } from "@/components/public-shell";
import { RequestComposer } from "@/components/request-composer";
import { Badge, Button, Card, Skeleton, Zec } from "@/components/ui";
import { VerificationCard } from "@/components/verification-card";
import { MockApiClient } from "@/lib/api/mock";
import { SEED_IDS } from "@/lib/api/fixtures";
import { useAgent, usePayment, useSession, useSwitchContext } from "@/lib/api/hooks";
import type { Payment } from "@/lib/contract/schemas";
import { Providers } from "../providers";

const STEPS = [
  "Simulation",
  "Owner policy",
  "Blocked overspend",
  "Allowed request",
  "Operator stage",
  "Confirmations",
  "Merchant verifies",
  "What stayed hidden",
  "What was simulated",
] as const;

function Frame({ title, say, children }: { title: string; say: ReactNode; children?: ReactNode }) {
  return (
    <Card testId="demo-frame">
      <div className="mb-1 flex items-center gap-2"><Badge tone="neutral" className="!bg-fuchsia-950 !text-fuchsia-300 !ring-fuchsia-800"><FlaskConical size={11} aria-hidden /> Simulation</Badge></div>
      <h2 className="text-xl font-semibold text-zinc-50">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-[15px] text-zinc-400">{say}</p>
      {children && <div className="mt-5">{children}</div>}
    </Card>
  );
}

function useCtx(ctx: "customer" | "merchant") {
  const { data: s } = useSession();
  const sw = useSwitchContext();
  const { mutate, isPending } = sw;
  useEffect(() => {
    if (s && s.context !== ctx && !isPending) mutate(ctx);
  }, [s, ctx, mutate, isPending]);
  return s?.context === ctx ? s : null;
}

function PolicyStep() {
  const s = useCtx("customer");
  const { data: a } = useAgent(s?.agentId, !!s);
  return (
    <Frame title="The owner sets the limits" say="A per-payment cap, a total budget and an allowlist of merchants. The backend enforces them on every request, and again right before anything is staged.">
      {!a ? <Skeleton className="h-24" /> : (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="demo-policy">
          <div className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">Per-payment cap</dt><dd className="mt-1 text-lg"><Zec zat={a.policy.perTxLimitZat} /></dd></div>
          <div className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">Total budget</dt><dd className="mt-1 text-lg"><Zec zat={a.policy.totalBudgetZat} /></dd></div>
          <div className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">Allowed merchants</dt><dd className="mt-1 truncate font-mono text-sm text-zinc-200">{a.policy.allowedMerchantIds.join(", ") || "none"}</dd></div>
        </dl>
      )}
    </Frame>
  );
}

/** The composer only renders once the customer session (with its agent) exists, so a fast click can never race the bootstrap. */
function Ready({ children }: { children: ReactNode }) {
  const s = useCtx("customer");
  return s?.agentId ? <>{children}</> : <Skeleton className="h-40" />;
}

function BlockedStep({ blocked, setBlocked }: { blocked: Payment | null; setBlocked: (p: Payment) => void }) {
  return (
    <Frame title="The agent tries to overspend" say="It asks for 0.75 ZEC against a 0.25 ZEC cap. Watch the backend answer with the exact limit. No funds move and nothing is reserved.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Ready><RequestComposer preset={{ invoiceId: SEED_IDS.blockedDemoInvoice, zec: "0.75", reference: "INV-1002 espresso machine" }} cta="Agent: request 0.75 ZEC" onResult={setBlocked} testId="demo-blocked" /></Ready>
        <div>{blocked ? <DecisionPanel d={blocked.decision} /> : <p className="text-sm text-zinc-500">Send the request to see the decision.</p>}</div>
      </div>
    </Frame>
  );
}

function AllowedStep({ payment, setPayment }: { payment: Payment | null; setPayment: (p: Payment) => void }) {
  return (
    <Frame title="A request inside the policy" say="0.12 ZEC to an allowed merchant. Approved means reserved, not paid.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {payment ? <p className="text-sm text-zinc-400">Request sent. Continue to stage it.</p> : (
          <Ready><RequestComposer preset={{ invoiceId: SEED_IDS.happyDemoInvoice, zec: "0.12", reference: "INV-1001 single-origin beans" }} cta="Agent: request 0.12 ZEC" onResult={setPayment} testId="demo-allowed" /></Ready>
        )}
        <div>{payment ? <DecisionPanel d={payment.decision} /> : <p className="text-sm text-zinc-500">Send the request to see the decision.</p>}</div>
      </div>
    </Frame>
  );
}

function LivePayment({ id, title, say }: { id: string | null; title: string; say: string }) {
  const s = useCtx("customer");
  const { data: p } = usePayment(s ? id : null);
  return (
    <Frame title={title} say={say}>
      {!id ? <p className="text-sm text-zinc-500">Go back one step and send the allowed request first.</p> : !p ? <Skeleton className="h-48" /> : <PaymentDetail p={p} />}
    </Frame>
  );
}

function MerchantStep({ id }: { id: string | null }) {
  const s = useCtx("merchant");
  return (
    <Frame title="The merchant verifies its own receipt" say="Juniper Coffee checks this invoice with its own viewing key. The customer hands over nothing. An acknowledgment is the merchant's statement, not settlement proof.">
      {!id ? <p className="text-sm text-zinc-500">No payment to verify yet.</p> : !s ? <Skeleton className="h-40" /> : <VerificationCard paymentId={id} />}
    </Frame>
  );
}

function PrivacyStep({ payment }: { payment: Payment | null }) {
  useCtx("customer");
  const l = payment?.privacy;
  return (
    <Frame title="What stayed hidden" say="Shielded payments keep amount, sender, recipient and memo off the public chain. Timing, fees and transaction structure can still be visible.">
      {!l ? <p className="text-sm text-zinc-500">No lens for this payment.</p> : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="demo-privacy">
          {[{ t: "Hidden on chain", i: l.hiddenOnChain }, { t: "Anyone watching the chain sees", i: l.publicChainSees }, { t: "The merchant sees", i: l.merchantSees }, { t: "The owner sees", i: l.customerSees }].map((c) => (
            <div key={c.t} className="rounded-xl bg-zinc-950 p-4 ring-1 ring-zinc-800">
              <div className="mb-2 text-sm font-semibold text-zinc-100">{c.t}</div>
              <ul className="space-y-1 text-sm text-zinc-300">{(c.i ?? []).map((x) => <li key={x}>· {x}</li>)}</ul>
            </div>
          ))}
        </div>
      )}
    </Frame>
  );
}

function Walkthrough({ onReset }: { onReset: () => void }) {
  const [step, setStep] = useState(0);
  const [blocked, setBlocked] = useState<Payment | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const last = STEPS.length - 1;
  const id = payment?.id ?? null;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[28px]">Guided demo</h1>
          <p className="mt-1 text-[15px] text-zinc-400">A resettable simulation in your browser. It never talks to a live backend.</p>
        </div>
        <Button variant="secondary" onClick={onReset} data-testid="demo-reset"><RotateCcw size={14} aria-hidden /> Replay from start</Button>
      </div>
      <ol className="flex flex-wrap gap-1" aria-label="Demo steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}
              className={clsx("flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs ring-1 ring-inset", i === step ? "bg-accent-950 text-accent-200 ring-accent-900" : i < step ? "text-zinc-300 ring-zinc-700" : "text-zinc-500 ring-zinc-800")}>
              <span className="font-mono">{i + 1}</span> {s}
            </button>
          </li>
        ))}
      </ol>

      <div aria-live="polite">
        {step === 0 && (
          <Frame title="Agents with permission to pay, not to overspend" say="This walkthrough runs on a mock backend inside this page. Every txid, confirmation and receipt is simulated; no wallet or chain is touched. Nine short frames, about two minutes.">
            <ul className="grid grid-cols-1 gap-2 text-sm text-zinc-300 sm:grid-cols-3">
              <li className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800">Policy enforced by the backend</li>
              <li className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800">Paid only when observed</li>
              <li className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800">Merchant checks its own receipt</li>
            </ul>
          </Frame>
        )}
        {step === 1 && <PolicyStep />}
        {step === 2 && <BlockedStep blocked={blocked} setBlocked={setBlocked} />}
        {step === 3 && <AllowedStep payment={payment} setPayment={setPayment} />}
        {step === 4 && <LivePayment id={id} title="Stage it once" say="Execute stages a single shielded send. In real testnet mode an operator signs and broadcasts outside the browser. It can never be resent." />}
        {step === 5 && <LivePayment id={id} title="Confirmations, as observed" say="Use the simulated chain events. Paid means confirmed on chain, never a timer or a toast. A reorg moves it back visibly." />}
        {step === 6 && <MerchantStep id={id} />}
        {step === 7 && <PrivacyStep payment={payment} />}
        {step === last && (
          <Frame title="What was simulated, and what is still blocked" say="Everything here ran on the mock backend. In the real product:">
            <ul className="space-y-2 text-sm text-zinc-300" data-testid="demo-final">
              <li>· Testnet sends are staged for an operator, signed and broadcast outside the browser.</li>
              <li>· Mainnet is read-only: no requests, sends, invoices or acknowledgments.</li>
              <li>· Daily budgets, fee preflight and owner approval wait for an agreed contract.</li>
              <li>· Wallet balances are never shown as an agent&apos;s funds without a verified agent-to-wallet binding.</li>
            </ul>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/app" className="inline-flex items-center gap-2 rounded-lg bg-accent-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-accent-300">Open the dashboard <ArrowRight size={14} aria-hidden /></Link>
              <Button variant="secondary" onClick={onReset}><RotateCcw size={14} aria-hidden /> Replay</Button>
            </div>
          </Frame>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} data-testid="demo-back"><ArrowLeft size={14} aria-hidden /> Back</Button>
        <div className="flex gap-2">
          {step < last && <Button variant="ghost" onClick={() => setStep(last)}><SkipForward size={14} aria-hidden /> Skip to end</Button>}
          {step < last && <Button onClick={() => setStep(step + 1)} data-testid="demo-next">Next <ArrowRight size={14} aria-hidden /></Button>}
        </div>
      </div>
    </div>
  );
}

/** Always its own mock client + query cache: the demo can never read or write a live backend. */
export default function DemoPage() {
  const [run, setRun] = useState(0);
  const [client, setClient] = useState(() => new MockApiClient());
  return (
    <Providers key={run} client={client}>
      <PublicShell>
        <Walkthrough onReset={() => { setClient(new MockApiClient()); setRun((r) => r + 1); }} />
      </PublicShell>
    </Providers>
  );
}
