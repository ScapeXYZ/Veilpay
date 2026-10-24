"use client";

import clsx from "clsx";
import { Activity, ArrowLeft, ArrowRight, Check, ListOrdered, ShieldCheck, Sparkles, Store, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { OnboardingContext } from "@/lib/onboarding";
import { readUiPref, writeUiPref, type UiPrefKey } from "@/lib/ui-prefs";

/**
 * Optional first-time tour for /app. It never blocks the page (non-modal), opens by itself only on the
 * first visit to /app, and can always be skipped. "Don't show this again" and finishing the tour are
 * remembered in localStorage; Skip only closes it for this browser session. Help & demo can restart it.
 */
export const ONBOARDING_STORAGE_KEY: UiPrefKey = "veilpay.onboarding.v1"; // "hidden" | "done"
export const ONBOARDING_SESSION_KEY: UiPrefKey = "veilpay.onboarding.session"; // "closed"
const CHANGE_EVENT = "veilpay-onboarding-change";

export const ONBOARDING_STEPS = [
  {
    id: "welcome",
    href: "/app",
    icon: Sparkles,
    title: "Welcome to VeilPay",
    body: "VeilPay lets an AI agent pay invoices only within limits you set. This short tour shows where things are. In this build every payment is a simulation, so no real money moves.",
  },
  {
    id: "rules",
    href: "/app/spending-rules",
    icon: ShieldCheck,
    title: "Spending rules",
    body: "Set a max per payment, a total budget and the merchants your agent may pay. Every payment request is checked against these rules before anything happens.",
  },
  {
    id: "payments",
    href: "/app/payments",
    icon: ListOrdered,
    title: "Payments",
    body: "Every request your agent made, newest first. Approved, sent and paid are separate steps, and a blocked request shows exactly which rule it broke.",
  },
  {
    id: "merchant",
    href: "/app/merchant",
    icon: Store,
    title: "Merchant",
    body: "The merchant side creates invoices and checks whether they were paid. It opens as a separate demo session, not a real sign-in.",
  },
  {
    id: "activity",
    href: "/app/activity",
    icon: Activity,
    title: "Activity and Privacy",
    body: "Activity is the full payment history with filters. Privacy explains who is meant to see what about a payment. Both are under More.",
  },
] as const;

type Snapshot = { stored: string | null; sessionClosed: boolean; ready: boolean };
const SERVER_SNAPSHOT = "ssr";

function readRaw(): string {
  try {
    return `${readUiPref("local", ONBOARDING_STORAGE_KEY) ?? ""}|${readUiPref("session", ONBOARDING_SESSION_KEY) ?? ""}`;
  } catch {
    // Storage blocked (private mode, policy): treat as "already seen" so the tour never nags.
    return "hidden|closed";
  }
}
function parse(raw: string): Snapshot {
  if (raw === SERVER_SNAPSHOT) return { stored: null, sessionClosed: true, ready: false };
  const [stored, session] = raw.split("|");
  return { stored: stored || null, sessionClosed: session === "closed", ready: true };
}
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}
function write(store: "local" | "session", key: UiPrefKey, value: string | null) {
  writeUiPref(store, key, value);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}


export function OnboardingProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const snap = parse(useSyncExternalStore(subscribe, readRaw, () => SERVER_SNAPSHOT));
  const [step, setStep] = useState(0);
  // null = the user has not acted yet (auto mode); true = tour running; false = closed this page view.
  const [active, setActive] = useState<boolean | null>(null);

  const autoEligible = snap.ready && !snap.stored && !snap.sessionClosed;
  const open = active === true || (active === null && autoEligible && path === "/app");

  const go = useCallback(
    (i: number) => {
      setStep(i);
      setActive(true);
      const href = ONBOARDING_STEPS[i].href;
      if (path !== href) router.push(href);
    },
    [path, router],
  );
  const close = useCallback((how: "skip" | "finish") => {
    if (how === "finish") write("local", ONBOARDING_STORAGE_KEY, "done");
    write("session", ONBOARDING_SESSION_KEY, "closed");
    setActive(false);
    setStep(0);
  }, []);
  const start = useCallback(() => go(0), [go]);

  const api = useMemo(() => ({ open, start }), [open, start]);
  return (
    <OnboardingContext.Provider value={api}>
      {children}
      {open && (
        <OnboardingPanel
          step={step}
          hideForever={snap.stored === "hidden"}
          onHideForever={(v) => write("local", ONBOARDING_STORAGE_KEY, v ? "hidden" : null)}
          onBack={() => go(Math.max(0, step - 1))}
          onNext={() => (step < ONBOARDING_STEPS.length - 1 ? go(step + 1) : close("finish"))}
          onSkip={() => close("skip")}
        />
      )}
    </OnboardingContext.Provider>
  );
}

function OnboardingPanel({ step, hideForever, onHideForever, onBack, onNext, onSkip }: {
  step: number;
  hideForever: boolean;
  onHideForever: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const s = ONBOARDING_STEPS[step];
  const last = step === ONBOARDING_STEPS.length - 1;
  const heading = useRef<HTMLHeadingElement>(null);
  const Icon = s.icon;
  // Move keyboard and screen-reader focus to the step heading whenever the step changes.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-title"
      aria-describedby="onboarding-body"
      data-testid="onboarding"
      data-step={s.id}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onSkip();
        }
      }}
      className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl shadow-black/60 sm:p-5 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[400px]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-zinc-400" data-testid="onboarding-progress">
          {step === 0 ? "Quick tour" : `Step ${step} of ${ONBOARDING_STEPS.length - 1}`}
        </span>
        <button onClick={onSkip} aria-label="Close the tour" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden>
        {ONBOARDING_STEPS.map((x, i) => (
          <span key={x.id} className={clsx("h-1 flex-1 rounded-full", i <= step ? "bg-accent-400" : "bg-zinc-700")} />
        ))}
      </div>
      <h2 id="onboarding-title" ref={heading} tabIndex={-1} style={{ outline: "none" }} className="mt-4 flex items-center gap-2 text-base font-semibold text-zinc-50 focus:outline-none">
        <Icon size={17} className="shrink-0 text-accent-300" aria-hidden /> {s.title}
      </h2>
      <p id="onboarding-body" className="mt-1.5 text-sm leading-relaxed text-zinc-300">{s.body}</p>

      <label className="mt-4 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-400">
        <input
          type="checkbox"
          checked={hideForever}
          onChange={(e) => onHideForever(e.target.checked)}
          data-testid="onboarding-hide"
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-950 accent-accent-400"
        />
        Don&apos;t show this again
      </label>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button onClick={onSkip} data-testid="onboarding-skip" className="rounded-lg px-2 py-2 text-sm text-zinc-400 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400">
          Skip tour
        </button>
        <div className="flex gap-2">
          <button onClick={onBack} disabled={step === 0} data-testid="onboarding-back"
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-200 ring-1 ring-zinc-700 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 disabled:cursor-not-allowed disabled:opacity-40">
            <ArrowLeft size={14} aria-hidden /> Back
          </button>
          <button onClick={onNext} data-testid="onboarding-next"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-400 px-3.5 py-2 text-sm font-semibold text-zinc-950 hover:bg-accent-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-200">
            {last ? <><Check size={14} aria-hidden /> Finish</> : <>Next <ArrowRight size={14} aria-hidden /></>}
          </button>
        </div>
      </div>
    </section>
  );
}
