"use client";

import { Activity, ArrowRight, Ban, CheckCircle2, Compass, Eye, FlaskConical, Lock, PlayCircle, RotateCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { MockControlsPanel } from "@/components/mock-controls";
import { useOnboarding } from "@/lib/onboarding";
import { PageHeader } from "@/components/shell";
import { GLOSSARY } from "@/components/term";
import { Button, Card, ErrorBox } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useLogout, useSession } from "@/lib/api/hooks";
import { MainnetReadOnlyNotice } from "@/components/mainnet-readonly";

function Answer({ icon, q, children }: { icon: ReactNode; q: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-t border-zinc-800 py-4 first:border-t-0 first:pt-0">
      <span className="mt-0.5 shrink-0 text-accent-300">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">{q}</h3>
        <p className="mt-1 text-sm text-zinc-400">{children}</p>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const tour = useOnboarding();
  const mode = useNetworkMode();
  const mock = mode.kind === "mock";
  const testnet = mode.kind === "testnet" || mode.kind === "testnet_manual" || mode.kind === "disabled";
  const { data: session } = useSession();
  const logout = useLogout();
  if (mode.kind === "mainnet_readonly" || mode.kind === "unknown") {
    return <><PageHeader title={mode.kind === "unknown" ? "Server status unavailable" : "Mainnet safety"} subtitle={mode.kind === "unknown" ? "Wallet observation remains local and read-only. Server-backed features are disabled." : "VeilPay observes mainnet wallet data only. It does not create payment requests, invoices, or transactions."} /><MainnetReadOnlyNotice area="Interactive demos" unknown={mode.kind === "unknown"} /></>;
  }
  return (
    <>
      <PageHeader title={mock ? "Help & demo" : "Safety & settings"} subtitle={mock ? "What VeilPay does, in plain words, a tour of the app and a practice run you can replay." : "How VeilPay keeps wallet observation, agent policies, payment requests, and settlement evidence separate."} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card testId="help-intro">
          <h2 className="text-lg font-semibold text-zinc-50">VeilPay in 30 seconds</h2>
          <ol className="mt-3 space-y-2.5 text-[15px] text-zinc-300">
            <li className="flex gap-3"><span className="font-semibold tabular-nums text-accent-300">1</span>You set spending rules for your AI agent: a max per payment, a total budget, and which merchants it may pay.</li>
            <li className="flex gap-3"><span className="font-semibold tabular-nums text-accent-300">2</span>When the agent wants to pay an invoice, VeilPay checks the rules. Over a limit? Blocked, with the exact reason, and no money moves.</li>
            <li className="flex gap-3"><span className="font-semibold tabular-nums text-accent-300">3</span>Approved payments are intended to be shielded Zcash payments and count as paid only after actual confirmation evidence.{mock ? " In this demo, sending and confirmations are simulated." : testnet ? " This release does not request a Noir Wallet signature or send from the browser." : " On the main network VeilPay is read-only and sends nothing."}</li>
            <li className="flex gap-3"><span className="font-semibold tabular-nums text-accent-300">4</span>The merchant checks on its side that its invoice was paid. The design keeps the amount and who paid out of public view;{mock ? " this demo does not prove that on a real network." : " VeilPay does not verify that on the network yet."}</li>
          </ol>
        </Card>
        <div className="flex flex-col gap-5">
          {mock && <Card testId="help-demo" className="flex flex-col">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50"><PlayCircle size={16} className="text-accent-300" aria-hidden /> {mock ? "Interactive demo" : "Practice demo (separate from your wallet)"}</div>
            <p className="mt-2 text-sm text-zinc-400">A step-by-step simulation in your browser: a blocked overspend, an allowed payment, simulated confirmations and the merchant check. It is not a video, nothing real moves, and you can replay it any time.</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-fuchsia-300"><FlaskConical size={12} aria-hidden /> Simulation only</p>
            <Link href="/demo" data-testid="help-start-demo" className="mt-4 inline-flex items-center justify-center gap-2 self-start rounded-lg bg-accent-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-accent-300">
              Try interactive demo <ArrowRight size={14} aria-hidden />
            </Link>
          </Card>}
          <Card testId="help-tour" className="flex flex-col">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50"><Compass size={16} className="text-accent-300" aria-hidden /> Quick tour</div>
            <p className="mt-2 text-sm text-zinc-400">A short guided walk through Spending rules, Payments, Merchant, Activity and Privacy. Skip it whenever you like.</p>
            <button type="button" onClick={tour.start} data-testid="help-restart-onboarding" className="mt-4 inline-flex items-center justify-center gap-2 self-start rounded-lg bg-zinc-800 px-3.5 py-2 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
              <RotateCcw size={14} aria-hidden /> Restart the tour
            </button>
          </Card>
        </div>
      </div>

      <Card title="Safety, in plain words" testId="help-safety">
        <Answer icon={<Lock size={16} aria-hidden />} q="Can VeilPay spend real money?">No. On the main Zcash network VeilPay only watches: sending, payment requests, invoices and rule changes are turned off. Payments happen only on the test network, where coins have no value.</Answer>
        <Answer icon={<Ban size={16} aria-hidden />} q="What happens when the agent asks for too much?">The payment is blocked before anything moves. You see which rule it broke and the exact limit.</Answer>
        <Answer icon={<RotateCcw size={16} aria-hidden />} q="Can a payment be sent twice?">No. If VeilPay cannot tell whether a send reached the network, it marks the outcome as unknown and never resends. An operator resolves it.</Answer>
        <Answer icon={<CheckCircle2 size={16} aria-hidden />} q="When is a payment “paid”?">Only when the VeilPay server reports the required network confirmations.{mock && " In practice mode those confirmations are simulated."} Approved, sent, confirmed and checked by the merchant are always shown as separate steps.</Answer>
        <Answer icon={<ShieldCheck size={16} aria-hidden />} q="Is the wallet balance my agent's money?">No. The wallet is shared, so VeilPay does not show its balance as your agent&apos;s funds. Your agent&apos;s limit is the budget in Spending rules.</Answer>
      </Card>

      {session?.authenticated && (
        <Card title="Session" testId="session-settings">
          <p className="text-sm text-zinc-400">This logs out of the VeilPay workspace only. It does not disconnect Noir Wallet or send wallet information to VeilPay.</p>
          <Button className="mt-4" variant="secondary" busy={logout.isPending} onClick={() => logout.mutate()} data-testid="logout-session">Log out and revoke this session</Button>
          {logout.error && <div className="mt-3"><ErrorBox>{errorText(logout.error)}</ErrorBox></div>}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Link href="/app/activity" className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700" data-testid="help-activity">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50"><Activity size={16} className="text-accent-300" aria-hidden /> Activity</div>
          <p className="mt-1.5 text-sm text-zinc-400">The full history of your agent&apos;s payments, with filters for blocked, waiting and unknown outcomes.</p>
        </Link>
        <Link href="/app/privacy" className="group rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-zinc-700" data-testid="help-privacy">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-50"><Eye size={16} className="text-accent-300" aria-hidden /> Privacy</div>
          <p className="mt-1.5 text-sm text-zinc-400">Who can see what about a payment: the public, the merchant, you, and the operator.</p>
        </Link>
      </div>

      <Card title="Words you might see" testId="help-glossary">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
          {Object.values(GLOSSARY).map((g) => (
            <div key={g.term}>
              <dt className="text-sm font-medium text-zinc-100">{g.term}</dt>
              <dd className="mt-0.5 text-sm text-zinc-400">{g.def}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <MockControlsPanel />
    </>
  );
}
