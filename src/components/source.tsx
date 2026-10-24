"use client";

import { Eye, FlaskConical, Lock, Radio, ShieldQuestion, Wrench } from "lucide-react";
import { useDataSource, useNetworkMode } from "@/lib/api/data-source";
import type { DataSource } from "@/lib/present";
import { Badge } from "./ui";

/**
 * Persistent network-mode banner (contract MOCK MODE rule + Phase 1 mode rules). Never
 * dismissible. Mainnet always reads "Read-only · Execution disabled".
 */
export function MockBanner() {
  const m = useNetworkMode();
  const base = "sticky top-0 z-50 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-semibold tracking-wide";
  if (m.kind === "mock")
    return (
      <div data-testid="mock-banner" role="note" className={`${base} bg-fuchsia-800 text-white`}>
        <FlaskConical size={14} aria-hidden />
        <span>
          <span className="uppercase">Practice mode · No real money moves.</span>{" "}
          <span className="hidden font-normal sm:inline">Every payment, confirmation and receipt here is pretend.</span>
        </span>
      </div>
    );
  if (m.kind === "mainnet_readonly")
    return (
      <div data-testid="mainnet-banner" role="note" className={`${base} bg-accent-900 text-accent-200`}>
        <Lock size={14} aria-hidden />
        <span>
          <span className="uppercase">Mainnet · Read-only · Execution disabled.</span>{" "}
          <span className="hidden font-normal sm:inline">VeilPay only watches the real network; it never sends there.</span>
        </span>
      </div>
    );
  if (m.kind === "disabled")
    return (
      <div data-testid="disabled-banner" role="note" className={`${base} bg-amber-900 text-white`}>
        Sending is turned off. This server cannot send payments or check merchant receipts on its own.
      </div>
    );
  if (m.kind === "unknown")
    return (
      <div data-testid="unknown-banner" role="note" className={`${base} bg-zinc-700 uppercase text-white`}>
        <ShieldQuestion size={14} aria-hidden /> {m.label}. Nothing on screen should be treated as real.
      </div>
    );
  if (m.kind === "testnet_manual")
    return (
      <div data-testid="real-banner" role="note" className={`${base} bg-emerald-900 text-emerald-50`}>
        <Wrench size={14} aria-hidden /> <span className="uppercase">Testnet · Test funds · Operator execution</span>
      </div>
    );
  return (
    <div data-testid="real-banner" role="note" className={`${base} bg-emerald-900 uppercase text-emerald-50`}>
      <Radio size={14} aria-hidden /> {m.detail}
    </div>
  );
}

/** Per-element source tag, used next to every number, status and receipt. */
export function SourceTag({ source: forced, className }: { source?: DataSource; className?: string }) {
  const ambient = useDataSource();
  const mode = useNetworkMode();
  const source = forced ?? ambient;
  if (source === "mock")
    return (
      <Badge tone="neutral" className={`!bg-fuchsia-950 !text-fuchsia-300 !ring-fuchsia-800 ${className ?? ""}`} testId="source-mock">
        <FlaskConical size={11} aria-hidden /> MOCK
      </Badge>
    );
  if (source === "disabled") return <Badge tone="warning" className={className} testId="source-disabled">SENDING OFF</Badge>;
  if (source === "real")
    return (
      <Badge tone="success" className={className} testId="source-real">
        <Radio size={11} aria-hidden /> TEST NETWORK
      </Badge>
    );
  if (!forced && mode.kind === "mainnet_readonly")
    return (
      <Badge tone="info" className={className} testId="source-mainnet">
        <Eye size={11} aria-hidden /> MAINNET · WATCH ONLY
      </Badge>
    );
  return (
    <Badge tone="neutral" className={className} testId="source-unknown">
      <ShieldQuestion size={11} aria-hidden /> SOURCE UNKNOWN
    </Badge>
  );
}

/** Explains a disabled action in place. Rendered instead of / next to any write control. */
export function WriteBlocked({ reason, testId = "write-blocked" }: { reason: string | null; testId?: string }) {
  if (!reason) return null;
  return (
    <p data-testid={testId} className="flex items-start gap-1.5 text-xs text-accent-200">
      <Lock size={12} className="mt-0.5 shrink-0" aria-hidden /> {reason}
    </p>
  );
}
