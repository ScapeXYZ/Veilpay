"use client";

import clsx from "clsx";
import { PlayCircle, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DEMO_STEPS } from "@/lib/demo-steps";


export function DemoGuide() {
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(0);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 self-start text-xs text-zinc-500 hover:text-zinc-300" data-testid="demo-guide-open">
        <PlayCircle size={14} aria-hidden /> Guided demo
      </button>
    );
  const cur = DEMO_STEPS[step];
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3" data-testid="demo-guide">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <PlayCircle size={14} aria-hidden /> Two-minute demo
        </div>
        <button onClick={() => setOpen(false)} aria-label="Hide guide" className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>
      <ol className="mt-2 flex gap-1 overflow-x-auto">
        {DEMO_STEPS.map((s, i) => (
          <li key={i}>
            <Link
              href={s.href}
              onClick={() => setStep(i)}
              className={clsx(
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs",
                i === step ? "bg-amber-400 text-zinc-950" : path === s.href ? "bg-zinc-800 text-zinc-200" : "text-zinc-400 hover:bg-zinc-800",
              )}
            >
              <span className="font-mono">{i + 1}</span> {s.title}
            </Link>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-zinc-300">
        {cur.say} <span className="text-xs text-zinc-500">({cur.ctx} view)</span>
      </p>
      {step < DEMO_STEPS.length - 1 && (
        <Link href={DEMO_STEPS[step + 1].href} onClick={() => setStep(step + 1)} className="mt-1 inline-block text-xs text-accent-300 hover:text-accent-200" data-testid="demo-next">
          Next: {DEMO_STEPS[step + 1].title} →
        </Link>
      )}
    </div>
  );
}
