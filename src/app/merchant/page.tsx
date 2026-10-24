"use client";

import { BadgeCheck, KeyRound, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, RequireContext } from "@/components/shell";
import { SourceTag } from "@/components/source";
import { useDataSource } from "@/lib/api/data-source";
import { Badge, Button, Card, ErrorBox, Field, Notice, Skeleton, Zec } from "@/components/ui";
import { inputCls } from "@/lib/styles";
import { isMockClient } from "@/lib/api";
import { errorText, useAcknowledge, useApi, useCreateInvoice, useInvoice, useInvoices, useVerification } from "@/lib/api/hooks";
import { newIdempotencyKey } from "@/lib/api/types";
import type { Acknowledgment } from "@/lib/contract/schemas";
import { VERIFICATION_COPY, ackEligibility, fmtTime } from "@/lib/present";
import { parseZecInput } from "@/lib/zat";
import { useHandoff } from "@/lib/handoff";
import { InvoiceRequest } from "@/components/invoice-request";

function VerificationCard({ paymentId }: { paymentId: string }) {
  const { data: v, isLoading, error } = useVerification(paymentId);
  const ack = useAcknowledge();
  const [ackKey] = useState(() => newIdempotencyKey());
  const [done, setDone] = useState<Acknowledgment | null>(null);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !v) return <ErrorBox>{errorText(error)}</ErrorBox>;
  const copy = VERIFICATION_COPY[v.state];
  const elig = ackEligibility(v);
  return (
    <Card
      testId="verification"
      title={
        <span className="flex items-center gap-2">
          Receipt for {v.reference ?? v.invoiceId}
          <Badge tone={copy.tone} testId="verification-state">
            {copy.label}
          </Badge>
        </span>
      }
      action={<SourceTag source={v.mock ? "mock" : "real"} />}
    >
      <p className="text-sm text-zinc-400">{copy.help}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">Expected</dt>
          <dd>{v.expectedZat ? <Zec zat={v.expectedZat} /> : "n/a"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Received</dt>
          <dd data-testid="received">{v.receivedZat ? <Zec zat={v.receivedZat} /> : "nothing seen"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Confirmations</dt>
          <dd className="font-mono">
            {v.confirmations}/{v.confirmationsRequired}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Checked</dt>
          <dd className="text-xs">{fmtTime(v.checkedAt)}</dd>
        </div>
      </dl>
      {v.acknowledgmentValid === false && (
        <p className="mt-2 text-xs text-amber-300" data-testid="ack-invalidated">A previous acknowledgment is no longer valid to rely on: the backend invalidated it after the observation changed.</p>
      )}
      {v.late && v.state === "amount_mismatch" && <p className="mt-2 text-xs text-amber-300">Also late: received after the invoice expired.</p>}
      <div className="mt-4 rounded-lg bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400" data-testid="verification-method">
        <KeyRound size={12} className="mr-1 inline" aria-hidden />
        {v.method === "mock" ? (
          <>Method: <b>mock</b>. Simulated, no chain read. Not evidence of anything.</>
        ) : v.method === "merchant_wallet_scan" ? (
          <>
            Method: <b>merchant wallet scan</b>. The merchant&apos;s own wallet independently decrypts its Orchard history and must match receiver, exact amount, expected txid and the required confirmations. Not a settlement proof. No customer key is involved.
          </>
        ) : (
          <>
            Method: <b>merchant IVK scan</b>. The operator holds the merchant&apos;s incoming viewing key and scans server-side. Custodial, not a per-payment disclosure proof. No customer key is involved.
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {done && v.acknowledgmentValid !== false ? (
          <span className="flex items-center gap-1.5 text-sm text-emerald-300" data-testid="acknowledged">
            <BadgeCheck size={16} aria-hidden /> Acknowledged {fmtTime(done.at)}. A server-authenticated merchant statement, not a settlement proof.
            {done.invalidatedAt && (
              <span className="text-amber-300" data-testid="ack-statement-invalidated"> Invalidated {fmtTime(done.invalidatedAt)}{done.invalidationReason ? `: ${done.invalidationReason}` : ""}.</span>
            )}
          </span>
        ) : (
          <>
            <Button disabled={!elig.allowed} busy={ack.isPending} onClick={() => ack.mutate({ paymentId, key: ackKey }, { onSuccess: setDone })} data-testid="ack">
              Acknowledge receipt
            </Button>
            <span className="text-xs text-zinc-500">{elig.reason}</span>
          </>
        )}
      </div>
      {ack.error && <div className="mt-3"><ErrorBox>{errorText(ack.error)}</ErrorBox></div>}
    </Card>
  );
}

function CreateInvoice() {
  const source = useDataSource();
  const create = useCreateInvoice();
  const detail = useInvoice(create.data?.id ?? null);
  const currentInvoice = !detail.error && !detail.isFetching ? detail.data : undefined;
  const handoff = useHandoff();
  const [reference, setReference] = useState("INV-2001 cold brew kegs");
  const [zec, setZec] = useState("0.2");
  const [key, setKey] = useState(() => newIdempotencyKey());
  const [inputErr, setInputErr] = useState<string | null>(null);
  return (
    <Card title="New invoice" testId="create-invoice">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
        <Field label="Reference">
          <input className={inputCls} value={reference} maxLength={64} onChange={(e) => { setReference(e.target.value); setKey(newIdempotencyKey()); }} />
        </Field>
        <Field label="Amount (ZEC)">
          <input inputMode="decimal" className={`${inputCls} font-mono`} value={zec} onChange={(e) => { setZec(e.target.value); setKey(newIdempotencyKey()); }} />
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button
          busy={create.isPending}
          onClick={() => {
            setInputErr(null);
            const amountZat = parseZecInput(zec);
            if (!amountZat) return setInputErr("Enter a ZEC amount with at most 8 decimals.");
            create.mutate(
              { body: { reference, amountZat }, key },
              {
                onSuccess: (inv) => {
                  handoff.addInvoice(inv.id);
                  setKey(newIdempotencyKey());
                },
              },
            );
          }}
        >
          Create invoice
        </Button>
        <span className="text-xs text-zinc-500">Mock invoices cannot receive funds.</span>
      </div>
      {(inputErr || create.error) && <div className="mt-3"><ErrorBox>{inputErr ?? errorText(create.error)}</ErrorBox></div>}
      {detail.error && <ErrorBox>{errorText(detail.error)}</ErrorBox>}
      {create.data && detail.isFetching && <p role="status">Refreshing invoice status...</p>}
      {currentInvoice && <>
        <p role="status" className="mt-3 text-sm text-emerald-300">Invoice created. Payment status below comes from the backend.</p>
        <InvoiceRequest key={currentInvoice.id} invoice={currentInvoice} demo={source !== "real"} />
      </>}
    </Card>
  );
}

function Invoices() {
  const { data, isLoading, error } = useInvoices();
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorBox>{errorText(error)}</ErrorBox>;
  const items = data?.items ?? [];
  const tone = { open: "info", paid: "success", paid_late: "warning", expired: "neutral" } as const;
  return (
    <Card title="Invoices" action={<SourceTag />} testId="invoices">
      <div className="max-h-80 overflow-y-auto">
        {items.length === 0 && <p className="py-4 text-sm text-zinc-400">No invoices yet. Create your first payment request above.</p>}
        <table aria-label="Merchant invoices and payment status" className="w-full table-fixed text-sm">
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-zinc-800/70 last:border-0">
                <td className="w-1/2 py-2 pr-2">
                  <div className="text-zinc-200">{i.reference}</div>
                  <div className="break-all font-mono text-xs text-zinc-500">{i.id}</div>
                </td>
                <td className="py-2 pr-2 text-right"><Zec zat={i.amountZat} /></td>
                <td className="py-2 text-right"><Badge tone={tone[i.status]}>{i.status === "paid_late" ? "paid late" : i.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Lookup() {
  const api = useApi();
  const handoff = useHandoff();
  // mock-only discovery (contract gap #1): the live contract has no merchant list of incoming payments
  const { data: candidates = [] } = useQuery({
    queryKey: ["mock-merchant-payment-ids"],
    queryFn: () => (isMockClient(api) ? api.merchantPaymentIds() : []),
    enabled: isMockClient(api),
    refetchInterval: 4000,
  });
  const ids = Array.from(new Set([...handoff.paymentIds, ...candidates]));
  const [input, setInput] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const current = active ?? ids[0] ?? null;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Verify a payment" testId="lookup">
        <div className="flex gap-2">
          <input aria-label="Payment ID to verify" className={`${inputCls} min-w-0 font-mono`} placeholder="payment id" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
          <Button variant="secondary" onClick={() => input.trim() && setActive(input.trim())}>
            <Search size={14} aria-hidden /> Check
          </Button>
        </div>
        {ids.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ids.map((id) => (
              <button
                key={id}
                data-testid={`pick-${id}`}
                onClick={() => setActive(id)}
                className={`rounded px-2 py-0.5 font-mono text-xs ${id === current ? "bg-amber-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
        {isMockClient(api) && <p className="mt-2 text-xs text-fuchsia-300/80">Mock: ids listed from the simulated backend. The live contract has no merchant payment list yet (flagged, not implemented).</p>}
      </Card>
      {current && <VerificationCard key={current} paymentId={current} />}
    </div>
  );
}

export default function MerchantPage() {
  return (
    <>
      <PageHeader
        title="Merchant verification"
        subtitle="Juniper Coffee checks that this invoice was paid, with its own viewing key. The customer shares no keys. In practice mode receipts and confirmations are simulated."
      />
      <RequireContext ctx="merchant">
        <Notice tone="neutral" title="What this proves, exactly">
          Receipt state for one invoice: amount and confirmations at a fresh address. In the demo the operator holds the merchant&apos;s incoming viewing key (custodial). An acknowledgment is the merchant service&apos;s signed statement, not chain proof.
        </Notice>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <Lookup />
          <div className="flex flex-col gap-5">
            <CreateInvoice />
            <Invoices />
          </div>
        </div>
      </RequireContext>
    </>
  );
}
