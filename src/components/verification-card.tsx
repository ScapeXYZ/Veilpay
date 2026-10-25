"use client";

import { BadgeCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import { SourceTag, WriteBlocked } from "./source";
import { Term } from "./term";
import { Button, Card, ErrorBox, Skeleton, StatusBadge, Zec } from "./ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useAcknowledge, useVerification } from "@/lib/api/hooks";
import { newIdempotencyKey } from "@/lib/api/types";
import type { Acknowledgment } from "@/lib/contract/schemas";
import { ackEligibility, ackStatement, confirmationsText, fmtTime, isSimulatedVerification, verificationCopy } from "@/lib/present";

/** Merchant receipt evidence for one payment: expected vs observed, confirmations, method, gated acknowledgment. */
export function VerificationCard({ paymentId }: { paymentId: string }) {
  const { data: v, isLoading, error } = useVerification(paymentId);
  const ack = useAcknowledge();
  const mode = useNetworkMode();
  const [ackKey] = useState(() => newIdempotencyKey());
  const [done, setDone] = useState<Acknowledgment | null>(null);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !v) return <ErrorBox>{errorText(error)}</ErrorBox>;
  const copy = verificationCopy(v);
  const sim = isSimulatedVerification(v);
  const elig = ackEligibility(v);
  return (
    <Card
      testId="verification"
      title={
        <span className="flex items-center gap-2">
          Receipt for {v.reference ?? v.invoiceId}
          <StatusBadge tone={copy.tone} testId="verification-state">
            {copy.label}
          </StatusBadge>
        </span>
      }
      action={<SourceTag source={v.mock ? "mock" : "real"} />}
    >
      <p className="text-sm text-zinc-400">{copy.help}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-zinc-500">Expected</dt>
          <dd>{v.expectedZat ? <Zec zat={v.expectedZat} /> : "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">{sim ? "Simulated receipt" : "Reported received"}</dt>
          <dd data-testid="received">{v.receivedZat ? <Zec zat={v.receivedZat} /> : "Nothing yet"}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Confirmations</dt>
          <dd className="tabular-nums" data-testid="verification-confirmations">{confirmationsText(v.confirmations, v.confirmationsRequired, sim)}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">Checked</dt>
          <dd className="text-xs">{fmtTime(v.checkedAt)}</dd>
        </div>
      </dl>
      {v.acknowledgmentValid === false && (
        <p className="mt-2 text-xs text-amber-300" data-testid="ack-invalidated">An earlier &ldquo;received&rdquo; mark no longer holds: VeilPay withdrew it because what the network shows changed.</p>
      )}
      {v.late && v.state === "amount_mismatch" && <p className="mt-2 text-xs text-amber-300">Also late: received after the invoice expired.</p>}
      <div className="mt-4 rounded-lg bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400" data-testid="verification-method">
        <KeyRound size={12} className="mr-1 inline" aria-hidden />
        {v.method === "mock" ? (
          <>Method: <b>mock</b>. Simulated, no chain read. Not evidence of anything.</>
        ) : v.method === "merchant_wallet_scan" ? (
          <>
            Checked by: <b>the merchant&apos;s own wallet</b>. It must see the right receiver, the exact amount, the expected transaction and enough confirmations. The customer shares no keys.
          </>
        ) : (
          <>
            Checked by: <b>the VeilPay operator, for the merchant</b>. The operator holds the merchant&apos;s <Term k="viewingKey">viewing key</Term> and checks on the server. The customer shares no keys.
          </>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {done ? (
          <span className="flex items-center gap-1.5 text-sm text-emerald-300" data-testid="acknowledged">
            <BadgeCheck size={16} aria-hidden /> Marked as received {fmtTime(done.at)}. {ackStatement(sim)}
            {done.invalidatedAt && (
              <span className="text-amber-300" data-testid="ack-statement-invalidated"> Invalidated {fmtTime(done.invalidatedAt)}{done.invalidationReason ? `: ${done.invalidationReason}` : ""}.</span>
            )}
          </span>
        ) : (
          <>
            <Button disabled={!elig.allowed || !mode.canWrite} busy={ack.isPending} onClick={() => mode.canWrite && ack.mutate({ paymentId, key: ackKey }, { onSuccess: setDone })} data-testid="ack">
              Mark as received
            </Button>
            {mode.canWrite ? <span className="text-xs text-zinc-500">{elig.reason}</span> : <WriteBlocked reason={mode.writeBlockedReason} testId="ack-blocked" />}
          </>
        )}
      </div>
      {ack.error && <div className="mt-3"><ErrorBox>{errorText(ack.error)}</ErrorBox></div>}
    </Card>
  );
}
