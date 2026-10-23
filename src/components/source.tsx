"use client";

import { FlaskConical, Radio, ShieldQuestion } from "lucide-react";
import { useApi, useHealth } from "@/lib/api/hooks";
import { dataSourceOf, type DataSource } from "@/lib/present";
import { Badge } from "./ui";

export function useDataSource(): DataSource {
  const api = useApi();
  const { data } = useHealth();
  return dataSourceOf(data, api.mode);
}

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
