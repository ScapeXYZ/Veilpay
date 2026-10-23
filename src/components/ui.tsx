"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Tone } from "@/lib/present";
import { formatZec } from "@/lib/zat";

const TONE: Record<Tone, string> = {
  neutral: "bg-zinc-800 text-zinc-300 ring-zinc-700",
  info: "bg-sky-950 text-sky-300 ring-sky-800",
  progress: "bg-indigo-950 text-indigo-300 ring-indigo-800",
  success: "bg-emerald-950 text-emerald-300 ring-emerald-800",
  warning: "bg-amber-950 text-amber-300 ring-amber-800",
  danger: "bg-rose-950 text-rose-300 ring-rose-800",
  review: "bg-orange-950 text-orange-200 ring-orange-700",
};

export function Badge({ tone = "neutral", children, className, testId }: { tone?: Tone; children: ReactNode; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[tone], className)}
    >
      {children}
    </span>
  );
}

export function Card({ children, className, title, action, testId }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className={clsx("rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 shadow-sm", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean };

export function Button({ variant = "primary", busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-amber-400 text-zinc-950 hover:bg-amber-300",
        variant === "secondary" && "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700 hover:bg-zinc-700",
        variant === "ghost" && "text-zinc-300 hover:bg-zinc-800",
        variant === "danger" && "bg-rose-600 text-white hover:bg-rose-500",
        className,
      )}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Zec({ zat, className, testId }: { zat: string; className?: string; testId?: string }) {
  return (
    <span data-testid={testId} className={clsx("font-mono tabular-nums", className)} title={`${zat} zat`}>
      {formatZec(zat)}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-zinc-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-400 focus:outline-none";

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-rose-900 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
      {children}
    </div>
  );
}

export function Notice({ tone = "info", title, children, testId }: { tone?: Tone; title: ReactNode; children?: ReactNode; testId?: string }) {
  const border: Record<Tone, string> = {
    neutral: "border-zinc-700 bg-zinc-900",
    info: "border-sky-900 bg-sky-950/40",
    progress: "border-indigo-900 bg-indigo-950/40",
    success: "border-emerald-900 bg-emerald-950/40",
    warning: "border-amber-800 bg-amber-950/40",
    danger: "border-rose-900 bg-rose-950/40",
    review: "border-orange-700 bg-orange-950/50",
  };
  return (
    <div data-testid={testId} role="status" className={clsx("rounded-xl border px-4 py-3", border[tone])}>
      <div className="text-sm font-semibold text-zinc-100">{title}</div>
      {children && <div className="mt-1 text-sm text-zinc-300">{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-zinc-800/70", className)} />;
}

export function Meter({ parts, total }: { parts: { pct: number; cls: string; label: string }[]; total: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800" role="img" aria-label={`budget of ${formatZec(total)}`}>
      <div className="flex h-full">
        {parts.map((p) => (
          <div key={p.label} className={p.cls} style={{ width: `${p.pct}%` }} title={p.label} />
        ))}
      </div>
    </div>
  );
}
