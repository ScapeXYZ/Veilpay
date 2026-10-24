"use client";

import { ArrowRight, Ban, CheckCircle2, EyeOff, FileCheck2, Lock, ScrollText, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PublicShell } from "@/components/public-shell";
import { Badge } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";

function ModeNote() {
  const m = useNetworkMode();
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-xs" data-testid="landing-mode">
      <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
        <Lock size={12} aria-hidden /> Main Zcash network: watch only, sending disabled
      </div>
      <div className="text-zinc-400">
        Right now: <span className="text-zinc-200">{m.label}</span>
      </div>
    </div>
  );
}

function PreviewRow({ tone, icon, title, amount, note, label }: { tone: "blocked" | "allowed"; icon: ReactNode; title: string; amount: string; note: string; label: string }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "blocked" ? "border-rose-900/70 bg-rose-950/20" : "border-emerald-900/70 bg-emerald-950/15"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          {icon} {title}
        </div>
        <Badge tone="neutral" className="!bg-fuchsia-950 !text-fuchsia-300 !ring-fuchsia-800">{label}</Badge>
      </div>
      <div className="mt-2 font-mono text-xl text-zinc-50 tabular">{amount}</div>
      <p className="mt-1 text-xs text-zinc-400">{note}</p>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg bg-accent-950 text-accent-300 ring-1 ring-accent-900">{icon}</div>
      <h3 className="font-semibold text-zinc-50">{title}</h3>
      <p className="mt-1.5 text-sm text-zinc-400">{children}</p>
    </div>
  );
}

export default function Landing() {
  return (
    <PublicShell>
      <section className="veil">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-14 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-24">
          <div>
            <Badge tone="info" className="mb-5">Private Zcash payments · Zecathon 2026</Badge>
            <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight text-zinc-50 sm:text-5xl lg:text-[54px]" data-testid="hero-title">
              Give AI agents permission to pay, not permission to overspend.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-300">VeilPay lets your AI agent pay for things within limits you set. Every payment is checked against your rules, kept private, and confirmed by the merchant.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/demo" data-testid="cta-demo" className="inline-flex items-center gap-2 rounded-lg bg-accent-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-accent-300">
                Watch the 2-minute demo <ArrowRight size={15} aria-hidden />
              </Link>
              <Link href="/app" data-testid="cta-dashboard" className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-900">
                Open VeilPay
              </Link>
            </div>
          </div>
          <div className="flex flex-col gap-3" aria-label="Product preview (simulation)">
            <PreviewRow tone="blocked" label="Simulation" icon={<Ban size={16} className="text-rose-400" aria-hidden />} title="Blocked: over the max per payment" amount="0.75000000 ZEC" note="Your limit is 0.25 ZEC. No money moved." />
            <PreviewRow tone="allowed" label="Simulation" icon={<CheckCircle2 size={16} className="text-emerald-400" aria-hidden />} title="Allowed: within your rules" amount="0.12000000 ZEC" note="Ready to send. It counts as paid once the network confirms it." />
            <ModeNote />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 lg:px-8">
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="How it works">
          {[
            { n: 1, t: "Set the rules", d: "A max per payment, a total budget, and which merchants the agent may pay.", i: <ShieldCheck size={16} aria-hidden /> },
            { n: 2, t: "The agent asks to pay", d: "VeilPay approves it, or blocks it and shows exactly which rule it broke.", i: <ScrollText size={16} aria-hidden /> },
            { n: 3, t: "The merchant confirms", d: "The merchant checks that its invoice was paid, without seeing anything else.", i: <Store size={16} aria-hidden /> },
          ].map((s) => (
            <li key={s.n} className="flex gap-3 rounded-2xl border border-zinc-800 p-4">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-zinc-800 font-mono text-xs text-zinc-200">{s.n}</span>
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-zinc-50">{s.i} {s.t}</div>
                <p className="mt-1 text-sm text-zinc-400">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 pb-16 md:grid-cols-3 lg:px-8">
        <Feature icon={<ShieldCheck size={17} aria-hidden />} title="Rules the agent cannot bend">
          Your rules live on the VeilPay server, not in the agent. Every payment is checked, then checked again right before it is sent.
        </Feature>
        <Feature icon={<EyeOff size={17} aria-hidden />} title="Private by default">
          Amount, sender, receiver and notes stay hidden from the public. Only the fact that a payment happened, and when, can be seen.
        </Feature>
        <Feature icon={<FileCheck2 size={17} aria-hidden />} title="No pretend “paid”">
          A payment shows as paid only when the network confirms it. Approved, sent, confirmed and merchant-checked are always shown separately.
        </Feature>
      </section>
    </PublicShell>
  );
}
