"use client";

import { FlaskConical, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useNetworkMode } from "@/lib/api/data-source";

/**
 * Sealed Ledger practice / live separation. Practice mode wraps the page in a dashed
 * practice frame with a fixed line at the top; it never animates, so it never reads as
 * loading. Mainnet read-only gets solid edges and one plain read-only line. Any other mode
 * renders children unchanged (the existing banners already explain it).
 * The existing MockBanner, SourceTag and every "simulated" label stay as they are: this is
 * an extra frame, not a replacement.
 */
export function PracticeFrame({ children }: { children: ReactNode }) {
  const m = useNetworkMode();
  if (m.kind === "mock")
    return (
      <div data-testid="practice-frame" data-mode="practice" className="practice-frame flex min-w-0 flex-col gap-6 rounded-[18px] p-3 sm:p-4">
        <p data-testid="practice-line" className="flex items-center gap-2 text-xs font-medium text-practice">
          <FlaskConical size={13} aria-hidden /> Practice mode. Simulated payments, no funds move.
        </p>
        {children}
      </div>
    );
  if (m.kind === "mainnet_readonly")
    return (
      <div data-testid="live-frame" data-mode="connected-read-only" className="flex min-w-0 flex-col gap-6">
        <p data-testid="read-only-line" className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <Lock size={13} aria-hidden className="text-shield" /> Read-only. VeilPay can&apos;t sign or send from here.
        </p>
        {children}
      </div>
    );
  return <>{children}</>;
}
