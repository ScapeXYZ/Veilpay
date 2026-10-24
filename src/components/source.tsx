"use client";

import { FlaskConical, Radio, ShieldQuestion } from "lucide-react";
import { useHealth } from "@/lib/api/hooks";
import { useDataSource } from "@/lib/api/data-source";
import type { DataSource } from "@/lib/present";
import { Badge } from "./ui";


/** Persistent banner: contract MOCK MODE rule ("UI shows a persistent MOCK banner"). Never dismissible. */
export function MockBanner() {
  const source = useDataSource();
  const { data: health, isError } = useHealth();
  if (source === "mock") {
    return (
      <div data-testid="mock-banner" className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-fuchsia-700 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wider text-white">
        <FlaskConical size={14} aria-hidden />
        Mock mode: simulated backend. No wallet, no chain, no real funds. Every txid, confirmation and receipt here is fake.
      </div>
    );
  }
  if (source === "disabled") return (
    <div data-testid="disabled-banner" className="sticky top-0 z-50 bg-amber-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
      Broadcasting disabled. This backend cannot send funds or independently verify merchant receipts.
    </div>
  );
  if (source === "unknown" || isError) {
    return (
      <div data-testid="unknown-banner" className="sticky top-0 z-50 bg-zinc-700 px-4 py-1.5 text-center text-xs font-semibold uppercase tracking-wider text-white">
        Backend unreachable: data source unknown. Nothing on screen should be treated as real.
      </div>
    );
  }
  return (
    <div data-testid="real-banner" className="sticky top-0 z-50 bg-emerald-800 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wider text-white">
      Real {health?.network} wallet ({health?.walletBackend}). Testnet funds only, not production.
    </div>
  );
}

/** Per-element source tag, used next to every number, status and receipt. */
export function SourceTag({ source: forced, className }: { source?: DataSource; className?: string }) {
  const ambient = useDataSource();
  const source = forced ?? ambient;
  if (source === "mock")
    return (
      <Badge tone="neutral" className={`!bg-fuchsia-950 !text-fuchsia-300 !ring-fuchsia-800 ${className ?? ""}`} testId="source-mock">
        <FlaskConical size={11} aria-hidden /> MOCK
      </Badge>
    );
  if (source === "disabled") return <Badge tone="warning" className={className} testId="source-disabled">BROADCAST DISABLED</Badge>;
  if (source === "real")
    return (
      <Badge tone="success" className={className} testId="source-real">
        <Radio size={11} aria-hidden /> REAL TESTNET
      </Badge>
    );
  return (
    <Badge tone="neutral" className={className} testId="source-unknown">
      <ShieldQuestion size={11} aria-hidden /> UNKNOWN SOURCE
    </Badge>
  );
}
