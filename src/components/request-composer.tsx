"use client";

import { useState } from "react";
import { useApi, useRequestPayment, useSession, errorText } from "@/lib/api/hooks";
import { newIdempotencyKey } from "@/lib/api/types";
import type { Payment } from "@/lib/contract/schemas";
import { parseZecInput } from "@/lib/zat";
import { useHandoff } from "@/app/providers";
import { Button, ErrorBox, Field, inputCls } from "./ui";

export type RequestPreset = { invoiceId: string; zec: string; reference: string };

/**
 * Agent payment request. The browser only submits; the backend evaluates policy and returns
 * the Decision. One Idempotency-Key per logical submit, reused when the same body is retried.
 */
export function RequestComposer({
  preset,
  cta,
  onResult,
  testId,
}: {
  preset: RequestPreset;
  cta: string;
  onResult: (p: Payment) => void;
  testId?: string;
}) {
  const api = useApi();
  const { data: session } = useSession();
  const handoff = useHandoff();
  const req = useRequestPayment();
  const [invoiceId, setInvoiceId] = useState(preset.invoiceId);
  const [zec, setZec] = useState(preset.zec);
  const [reference, setReference] = useState(preset.reference);
  const [attempt, setAttempt] = useState<{ body: string; key: string } | null>(null);
  const [inputErr, setInputErr] = useState<string | null>(null);

  const submit = () => {
    setInputErr(null);
    const agentId = session?.agentId;
    if (!agentId) return setInputErr("This session has no agent. Switch to the customer context.");
    const amountZat = parseZecInput(zec);
    if (!amountZat) return setInputErr("Enter a ZEC amount with at most 8 decimals.");
    if (!invoiceId.trim()) return setInputErr("Enter the invoice id the merchant gave you.");
    const body = { agentId, invoiceId: invoiceId.trim(), amountZat, reference: reference.slice(0, 64) };
    const bodyKey = JSON.stringify(body);
    const key = attempt && attempt.body === bodyKey && req.isError ? attempt.key : newIdempotencyKey();
    setAttempt({ body: bodyKey, key });
    req.mutate(
      { body, key },
      {
        onSuccess: (p) => {
          if (p.status !== "rejected") handoff.addPayment(p.id);
          onResult(p);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_0.7fr]">
        <Field label="Invoice id" hint={api.mode === "live" ? "From the merchant (create one in the Merchant view)." : undefined}>
          <input className={inputCls} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Amount (ZEC)">
          <input className={`${inputCls} font-mono`} value={zec} onChange={(e) => setZec(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <Field label="Reference">
        <input className={inputCls} value={reference} maxLength={64} onChange={(e) => setReference(e.target.value)} />
      </Field>
      {handoff.invoiceIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="text-zinc-500">Invoices created this session:</span>
          {handoff.invoiceIds.map((id) => (
            <button key={id} className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300 hover:bg-zinc-700" onClick={() => setInvoiceId(id)}>
              {id}
            </button>
          ))}
        </div>
      )}
      <div>
        <Button onClick={submit} busy={req.isPending} data-testid={testId ? `${testId}-submit` : undefined}>
          {cta}
        </Button>
      </div>
      {(inputErr || req.error) && <ErrorBox>{inputErr ?? errorText(req.error)}</ErrorBox>}
    </div>
  );
}
