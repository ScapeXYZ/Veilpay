"use client";

import clsx from "clsx";
import { Building2, Check, FileText, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge, Button, Card, Notice } from "@/components/ui";
import {
  BUSINESS_CATEGORIES, BUSINESS_NAME_MAX, clearBusinessDraft, loadBusinessDraft, saveBusinessDraft, validateBusinessName,
  type BusinessCategory, type BusinessDraft,
} from "@/lib/wallet-ux/business-draft";
import type { NoirWalletUx } from "@/lib/wallet-ux/use-noir-wallet-ux";
import { accountName, truncateAddress } from "@/lib/wallet-ux/wallet-state";

const STEPS = ["Business", "Payout account", "Review", "Saved"] as const;

const LOCAL_ONLY =
  "Local draft, not registered. It is saved only in this browser. VeilPay does not register your business or payout address, and nothing is sent, signed or paid.";

export function BusinessOnboarding({ wallet }: { wallet: NoirWalletUx }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<BusinessCategory>("Online store");
  const [touched, setTouched] = useState(false);
  const [payoutId, setPayoutId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BusinessDraft | null>(null);
  const nameId = useId();

  useEffect(() => {
    // Deferred: hydrate the local draft after mount (localStorage is client-only).
    void Promise.resolve().then(() => {
      const d = loadBusinessDraft();
      if (d) {
        setDraft(d);
        setName(d.businessName);
        setCategory(d.category);
        setStep(3);
      }
    });
  }, []);

  const connected = wallet.status === "connected";
  const shieldedAccounts = useMemo(() => (connected ? wallet.accounts.filter((a) => !!a.addresses?.shielded) : []), [connected, wallet.accounts]);
  const payout = shieldedAccounts.find((a) => a.id === payoutId) ?? null;
  const nameError = validateBusinessName(name);

  // Forget an in-memory payout choice if the wallet disconnects, locks or changes accounts.
  useEffect(() => {
    if (payoutId && !shieldedAccounts.some((a) => a.id === payoutId)) void Promise.resolve().then(() => setPayoutId(null));
  }, [payoutId, shieldedAccounts]);

  const save = () => {
    const d = saveBusinessDraft({ businessName: name, category });
    setDraft(d);
    setStep(3);
  };
  const remove = () => {
    clearBusinessDraft();
    setDraft(null);
    setName("");
    setTouched(false);
    setPayoutId(null);
    setStep(0);
  };

  return (
    <Card testId="business-onboarding"
      title={<span className="flex items-center gap-2"><Building2 size={15} aria-hidden /> Business setup</span>}
      action={<Badge tone="warning" testId="draft-badge">Local draft · Not registered</Badge>}>
      <ol className="mb-4 grid grid-cols-4 gap-1.5" aria-label="Business setup steps">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined}
            className={clsx("rounded-lg px-2 py-1.5 text-center text-[11px] sm:text-xs",
              i === step ? "bg-accent-950 text-accent-200 ring-1 ring-accent-800" : i < step ? "bg-zinc-900 text-zinc-300" : "bg-zinc-950 text-zinc-500 ring-1 ring-zinc-800")}>
            <span className="block font-semibold">{i + 1}</span>{label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <form className="space-y-4" data-testid="onboarding-step-business"
          onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!nameError) setStep(1); }}>
          <div>
            <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-zinc-300">Business name</label>
            <input id={nameId} value={name} maxLength={BUSINESS_NAME_MAX + 20} onChange={(e) => setName(e.target.value)} onBlur={() => setTouched(true)}
              aria-invalid={touched && !!nameError} aria-describedby={`${nameId}-err`} autoComplete="organization"
              className="block w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-zinc-100" data-testid="business-name" />
            <p id={`${nameId}-err`} className="mt-1 text-xs text-rose-300">{touched && nameError ? nameError : ""}</p>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-zinc-300">What you sell</legend>
            <div className="grid grid-cols-2 gap-2">
              {BUSINESS_CATEGORIES.map((c) => (
                <label key={c} className={clsx("flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm", category === c ? "border-accent-700 bg-accent-950/40 text-zinc-100" : "border-zinc-800 text-zinc-300")}>
                  <input type="radio" name="business-category" value={c} checked={category === c} onChange={() => setCategory(c)} /> {c}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex justify-end"><Button type="submit" data-testid="onboarding-next">Next</Button></div>
        </form>
      )}

      {step === 1 && (
        <div className="space-y-4" data-testid="onboarding-step-payout">
          <p className="text-sm text-zinc-300">Choose which shielded address customers would pay. It comes from your connected Noir Wallet.</p>
          {!connected ? (
            <Notice tone="neutral" title="Connect Noir Wallet first" testId="payout-needs-wallet">Connect above to pick a payout account. You can also skip this and save the draft without one.</Notice>
          ) : shieldedAccounts.length === 0 ? (
            <Notice tone="warning" title="No shielded address shared">The authorized accounts did not share a shielded address, so none can be picked here.</Notice>
          ) : (
            <fieldset className="space-y-2">
              <legend className="sr-only">Payout account</legend>
              {shieldedAccounts.map((a) => (
                <label key={a.id} className={clsx("flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm", payoutId === a.id ? "border-accent-700 bg-accent-950/40" : "border-zinc-800 bg-zinc-950")}>
                  <input type="radio" name="payout-account" checked={payoutId === a.id} onChange={() => setPayoutId(a.id)} className="mt-1" data-testid={`payout-${a.id}`} />
                  <span className="min-w-0">
                    <span className="block font-medium text-zinc-100">{accountName(a)}</span>
                    <span className="font-mono text-xs text-zinc-400" title={a.addresses.shielded}>{truncateAddress(a.addresses.shielded)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <p className="text-xs text-zinc-500">The payout choice is kept on this page only. It is not saved in the draft and not registered with VeilPay.</p>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
            <Button onClick={() => setStep(2)} data-testid="onboarding-next">{payout ? "Next" : "Skip for now"}</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4" data-testid="onboarding-step-review">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">Business</dt><dd className="mt-0.5 break-words text-zinc-100">{name.trim()}</dd></div>
            <div className="rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">What you sell</dt><dd className="mt-0.5 text-zinc-100">{category}</dd></div>
            <div className="rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800"><dt className="text-xs text-zinc-500">Payout account</dt>
              <dd className="mt-0.5 text-zinc-100">{payout ? <>{accountName(payout)} <span className="font-mono text-xs text-zinc-400">{truncateAddress(payout.addresses.shielded)}</span></> : <span className="text-zinc-400">Not chosen</span>}</dd></div>
          </dl>
          <Notice tone="warning" title="Saving creates a local draft only" testId="review-disclosure">{LOCAL_ONLY}</Notice>
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={save} data-testid="onboarding-save"><FileText size={14} aria-hidden /> Save local draft</Button>
          </div>
        </div>
      )}

      {step === 3 && draft && (
        <div className="space-y-4" data-testid="onboarding-step-saved">
          <Notice tone="success" title={<span className="flex items-center gap-2"><Check size={14} aria-hidden /> Draft saved in this browser</span>}>
            <span data-testid="saved-summary">{draft.businessName} · {draft.category}</span>
          </Notice>
          <p className="text-sm text-zinc-300" data-testid="saved-disclosure">{LOCAL_ONLY}</p>
          <p className="text-xs text-zinc-500">The payout account is not stored. Pick it again after reconnecting your wallet.</p>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="secondary" onClick={() => setStep(0)} data-testid="onboarding-edit">Edit draft</Button>
            <Button variant="ghost" onClick={remove} data-testid="onboarding-delete"><Trash2 size={14} aria-hidden /> Delete draft</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
