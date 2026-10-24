"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { isMockClient } from "@/lib/api";
import { useApi, useHealth } from "@/lib/api/hooks";
import { Button } from "./ui";

/** Mock-only reviewer controls. Rendered only when the client is the in-process mock. */
export function MockControlsPanel() {
  const api = useApi();
  const qc = useQueryClient();
  const { data: h } = useHealth();
  if (!isMockClient(api)) return null;
  return (
    <div data-testid="mock-controls" className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-fuchsia-800 p-3 text-fuchsia-200">
      <FlaskConical size={14} aria-hidden />
      <span className="mr-2 font-semibold uppercase tracking-wide">Practice controls</span>
      <Button
        variant="secondary"
        onClick={() => {
          api.setDeepReorgAlert(!h?.chainWatcher.deepReorgAlert);
          qc.invalidateQueries();
        }}
      >
        {h?.chainWatcher.deepReorgAlert ? "Clear" : "Raise"} network-correction alert
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          api.reset();
          qc.invalidateQueries();
        }}
      >
        Reset practice data
      </Button>
    </div>
  );
}

export function MockAdvanceButton({ paymentId, label = "Simulate next network step" }: { paymentId: string; label?: string }) {
  const api = useApi();
  const qc = useQueryClient();
  if (!isMockClient(api)) return null;
  return (
    <Button
      data-testid="mock-advance"
      variant="secondary"
      className="!border-dashed !ring-fuchsia-800 !text-fuchsia-200"
      onClick={async () => {
        await api.advance(paymentId);
        qc.invalidateQueries();
      }}
    >
      <FlaskConical size={14} aria-hidden /> {label} (mock)
    </Button>
  );
}

export function MockReorgButton({ paymentId }: { paymentId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  if (!isMockClient(api)) return null;
  return (
    <Button
      data-testid="mock-reorg"
      variant="secondary"
      className="!border-dashed !ring-fuchsia-800 !text-fuchsia-200"
      onClick={async () => {
        await api.reorg(paymentId);
        qc.invalidateQueries();
      }}
    >
      <FlaskConical size={14} aria-hidden /> Simulate network correction (mock)
    </Button>
  );
}
