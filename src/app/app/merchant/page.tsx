"use client";

import { CheckCircle2, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader, RequireContext } from "@/components/shell";
import { SourceTag, WriteBlocked } from "@/components/source";
import { useDataSource, useNetworkMode } from "@/lib/api/data-source";
import { Badge, Button, Card, ErrorBox, Field, Notice, Skeleton, Zec } from "@/components/ui";
import { inputCls } from "@/lib/styles";
import { isMockClient } from "@/lib/api";
import { errorText, useApi, useCreateInvoice, useInvoice, useInvoices } from "@/lib/api/hooks";
import { newIdempotencyKey } from "@/lib/api/types";
import { parseZecInput } from "@/lib/zat";
import { useHandoff } from "@/lib/handoff";
import { InvoiceRequest } from "@/components/invoice-request";
import { VerificationCard } from "@/components/verification-card";

function CreateInvoice() {
  const mode = useNetworkMode();
  if (!mode.canWrite)
    return (
      <Card title="New invoice" testId="create-invoice-blocked">
        <WriteBlocked reason={mode.writeBlockedReason} />
        <p className="mt-2 text-xs text-zinc-500">No invoice issuance and no spendable QR here. Widening a network enum does not make a payment flow safe.</p>
      </Card>
    );
  return <CreateInvoiceForm />;
}

function CreateInvoiceForm() {
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
          <input inputMode="decimal" className={`${inputCls} tabular-nums`} value={zec} onChange={(e) => { setZec(e.target.value); setKey(newIdempotencyKey()); }} />
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
        <p role="status" className="mt-3 flex items-center gap-1.5 text-sm text-emerald-300" data-testid="invoice-created"><CheckCircle2 size={15} aria-hidden /> Invoice created. Share it with your customer; its payment status shows below.</p>
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
        <table aria-label="Merchant invoices and payment status" className="w-full text-sm">
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-zinc-800/70 last:border-0">
                <td className="py-2 pr-2 [overflow-wrap:anywhere]">
                  <div className="text-zinc-200">{i.reference}</div>
                  <div className="font-mono text-xs text-zinc-500">{i.id}</div>
                </td>
                <td className="whitespace-nowrap py-2 pr-2 text-right"><Zec zat={i.amountZat} /></td>
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
        <ol className="mb-3 space-y-1 text-xs text-zinc-400" data-testid="verify-steps">
          <li><span className="font-semibold text-zinc-300">1.</span> On the customer&apos;s payment page, find <b className="text-zinc-200">Payment ID</b> under Payment details and press <b className="text-zinc-200">Copy</b>.</li>
          <li><span className="font-semibold text-zinc-300">2.</span> Paste it below and press <b className="text-zinc-200">Check</b> (or Enter).</li>
          <li><span className="font-semibold text-zinc-300">3.</span> Read the receipt. In practice mode a match means the simulated payment matches the invoice, not that funds arrived.</li>
        </ol>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = input.trim();
            if (id) setActive(id);
          }}
        >
          <input id="verify-payment-id" aria-label="Payment ID to verify" data-testid="verify-input" className={`${inputCls} min-w-0 font-mono`} placeholder="Paste a Payment ID" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} autoComplete="off" />
          <Button type="submit" variant="secondary" data-testid="verify-check">
            <Search size={14} aria-hidden /> Check
          </Button>
        </form>
        {ids.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ids.map((id) => (
              <button
                key={id}
                data-testid={`pick-${id}`}
                onClick={() => setActive(id)}
                className={`rounded px-2 py-0.5 font-mono text-xs ${id === current ? "bg-accent-400 text-zinc-950" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              >
                {id}
              </button>
            ))}
          </div>
        )}
        {isMockClient(api) && <p className="mt-2 text-xs text-fuchsia-300/80">Practice mode: these IDs come from the practice data. The real service does not list merchant payments yet.</p>}
      </Card>
      {current && <VerificationCard key={current} paymentId={current} />}
    </div>
  );
}

export default function MerchantPage() {
  return (
    <>
      <PageHeader
        title="Merchant portal"
        subtitle="Juniper Coffee creates invoices and checks they were paid. The customer shares no keys. In practice mode receipts and confirmations are simulated."
      />
      <RequireContext ctx="merchant">
        <Notice tone="neutral" title="What a receipt check tells you">
          Whether VeilPay&apos;s receipt scan reports the invoice amount, and how many confirmations it shows (simulated in practice mode). In this demo the VeilPay operator holds the merchant&apos;s viewing key for them. Marking a receipt as received is the merchant&apos;s own statement, not proof from the network.
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
