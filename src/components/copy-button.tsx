"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/** One-click copy for an ID. Announces the result to screen readers; falls back to a text selection when the clipboard API is blocked. */
export function CopyButton({ value, label = "Copy", testId }: { value: string; label?: string; testId?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        data-testid={testId}
        aria-label={`${label} ID`}
        className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1 font-sans text-xs font-medium text-zinc-100 ring-1 ring-zinc-700 transition hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400"
      >
        {state === "copied" ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
        {state === "copied" ? "Copied" : label}
      </button>
      <span role="status" aria-live="polite" className="font-sans text-xs text-zinc-500" data-testid={testId ? `${testId}-status` : undefined}>
        {state === "copied" ? "Copied to clipboard" : state === "failed" ? "Copy blocked by the browser. Select the ID and copy it by hand." : ""}
      </span>
    </span>
  );
}
