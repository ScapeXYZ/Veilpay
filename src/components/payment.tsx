"use client";

import clsx from "clsx";
import { Ban, CheckCircle2, CircleDot, Lock, RotateCcw, ShieldAlert, Wrench } from "lucide-react";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useExecutePayment } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/types";
import type { Decision, Payment } from "@/lib/contract/schemas";
import {
  FAILURE_COPY,
  PROVISIONAL_RECONCILIATION,
  STATUS_COPY,
  VIOLATION_COPY,
  WALLET_OP_COPY,
  fmtTime,
  paymentBadge,
  shortId,
  timelineTitle,
  unresolvedOf,
  awaitingOperatorConfirmation,
  WALLET_PHASE_COPY,
} from "@/lib/present";
import { MockAdvanceButton, MockReorgButton } from "./mock-controls";
import { SourceTag, WriteBlocked } from "./source";
import { Badge, Button, Card, ErrorBox, Notice, StatusBadge, Zec } from "./ui";

export function PaymentBadge({ p }: { p: Payment }) {
  const mode = useNetworkMode();
  const b = paymentBadge(p);
  const label = mode.kind === "mock" && p.status === "confirmed" ? "Simulated complete" : b.label;
  return (
    <StatusBadge tone={b.tone} testId={`badge-${p.id}`}>
      {label}
    </StatusBadge>
  );
}

export function DecisionPanel({ d, compact }: { d: Decision; compact?: boolean }) {
  const blocked = d.result === "rejected";
  return (
    <div data-testid="decision" className={clsx("rounded-xl border p-4", blocked ? "border-rose-900 bg-rose-950/30" : "border-emerald-900 bg-emerald-950/20")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {blocked ? <Ban size={16} className="text-rose-400" aria-hidden /> : <CheckCircle2 size={16} className="text-emerald-400" aria-hidden />}
          {blocked ? "Blocked: this breaks a spending rule" : "Approved: within your spending rules"}
        </div>
        <span className="text-xs text-zinc-500">
          rules v{d.policyVersion} · {fmtTime(d.evaluatedAt)}
        </span>
      </div>
      {d.violations.length > 0 && (
        <ul className="mt-3 space-y-2">
          {d.violations.map((v, i) => (
            <li key={i} className="rounded-lg bg-zinc-950/60 px-3 py-2 text-sm" data-testid={`violation-${v.code}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-100">{VIOLATION_COPY[v.code]}</span>
                <code className="rounded bg-rose-950/70 px-1.5 py-0.5 font-mono text-[11px] text-rose-300/80 [overflow-wrap:anywhere]" title="Error code">{v.code}</code>
              </div>
              {!compact && <p className="mt-1 text-xs text-zinc-400">{v.message}</p>}
              {(v.limitZat || v.requestedZat) && (
                <div className="mt-1.5 flex flex-wrap gap-4 text-xs text-zinc-400">
                  {v.requestedZat && (
                    <span>
                      asked for <Zec zat={v.requestedZat} className="text-zinc-100" />
                    </span>
                  )}
                  {v.limitZat && (
                    <span>
                      your limit <Zec zat={v.limitZat} className="text-zinc-100" />
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!compact && <p className="mt-3 text-xs text-zinc-500 [overflow-wrap:anywhere]">Decision {shortId(d.id)} · audit {d.auditHash}. Checked by the VeilPay server, not this page.</p>}
    </div>
  );
}

export function Timeline({ p }: { p: Payment }) {
  return (
    <ol data-testid="timeline" className="relative ml-2 border-l border-zinc-800">
      {p.timeline.map((e, i) => {
        const last = i === p.timeline.length - 1;
        const back = e.kind === "reorg";
        const tone = STATUS_COPY[e.status].tone;
        return (
          <li key={i} className="mb-4 ml-5 last:mb-0" data-testid={`tl-${e.kind}-${e.status}`}>
            <span
              className={clsx(
                "absolute -left-[7px] mt-1 h-3.5 w-3.5 rounded-full ring-4 ring-zinc-950",
                back ? "bg-amber-400" : tone === "danger" ? "bg-rose-500" : tone === "success" ? "bg-emerald-400" : last ? "bg-sky-400" : "bg-zinc-600",
              )}
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={clsx("font-medium", last ? "text-zinc-50" : "text-zinc-300")}>{timelineTitle(e)}</span>
              {back && <Badge tone="warning">backward move</Badge>}
              <span className="text-xs text-zinc-500">{fmtTime(e.at)}</span>
            </div>
            {e.note && <p className="mt-0.5 text-xs text-zinc-400">{e.note}</p>}
          </li>
        );
      })}
      {unresolvedOf(p) && (
        <li className="ml-5" data-testid="tl-unresolved">
          <span className="absolute -left-[7px] mt-1 h-3.5 w-3.5 rounded-full bg-orange-400 ring-4 ring-zinc-950" aria-hidden />
          <span className="text-sm font-medium text-orange-200">Outcome unresolved, no next step taken automatically</span>
        </li>
      )}
    </ol>
  );
}

function UnresolvedNotice({ p }: { p: Payment }) {
  const u = unresolvedOf(p);
  if (!u) return null;
  return (
    <Notice tone={u.kind === "reconciling" ? "warning" : "review"} title={<span className="flex items-center gap-2">{u.kind !== "reconciling" ? <Wrench size={15} aria-hidden /> : <RotateCcw size={15} aria-hidden />}{u.title}</span>} testId={`unresolved-${u.kind}`}>
      <p>{u.body}</p>
      <p className="mt-1 text-xs text-zinc-400">{PROVISIONAL_RECONCILIATION}</p>
    </Notice>
  );
}

function FailureNotice({ p }: { p: Payment }) {
  if (!p.failure || p.failure.code === "OUTCOME_UNKNOWN") return null;
  if (p.status !== "failed" || unresolvedOf(p)) return null; // needsOperator wins: never shown as a confirmed failure
  return (
    <Notice tone="danger" title={<span className="flex items-center gap-2"><ShieldAlert size={15} aria-hidden />Failed: {FAILURE_COPY[p.failure.code]}</span>} testId="failure-definitive">
      <p>{p.failure.message}</p>
      <p className="mt-1 text-xs text-zinc-400">
        This payment did not go through (<code>{p.failure.code}</code>). The set-aside amount was released.
      </p>
    </Notice>
  );
}

function ExecuteBlock({ p }: { p: Payment }) {
  const ex = useExecutePayment();
  const mode = useNetworkMode();
  if (p.status !== "authorized" || unresolvedOf(p)) return null;
  const err = ex.error;
  const retryable = err instanceof ApiError && err.body.code === "WALLET_UNAVAILABLE";
  const manual = mode.kind === "testnet_manual";
  return (
    <div className="rounded-xl border border-sky-900 bg-sky-950/20 p-4" data-testid="execute-block">
      <p className="text-sm text-zinc-200">Approved and set aside. It counts as paid only once the server reports enough network confirmations{mode.kind === "mock" ? " (simulated in practice mode)" : ""}.</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
        <Lock size={12} aria-hidden /> A sent payment cannot be pulled back. VeilPay sends it at most once{manual ? "; an operator sends it from outside this app" : ""}.
      </p>
      {mode.canExecute ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={() => ex.mutate(p.id)} busy={ex.isPending} data-testid="execute">
            {retryable ? "Try again (same payment, never sent twice)" : manual ? "Hand to operator to send" : mode.kind === "mock" ? "Simulate send" : mode.kind === "testnet" ? "Send on the test network" : "Send"}
          </Button>
        </div>
      ) : (
        <div className="mt-3"><WriteBlocked reason={mode.executeBlockedReason} testId="execute-blocked" /></div>
      )}
      {err && <div className="mt-3"><ErrorBox>{errorText(err)}{retryable && " Nothing was sent; the payment is still authorized."}</ErrorBox></div>}
    </div>
  );
}

export function PaymentDetail({ p }: { p: Payment }) {
  const op = p.walletOperation;
  const simulated = useNetworkMode().kind === "mock";
  const sentAlready = ["submitted", "confirming", "confirmed"].includes(p.status);
  return (
    <div className="flex flex-col gap-4" data-testid="payment-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-zinc-500">{p.merchantName}</div>
          <div className="text-lg font-semibold">{p.reference}</div>
          <Zec zat={p.amountZat} className="text-2xl text-zinc-50" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <PaymentBadge p={p} />
          <SourceTag />
        </div>
      </div>

      <UnresolvedNotice p={p} />
      <FailureNotice p={p} />
      <ExecuteBlock p={p} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Payment timeline" className="!bg-zinc-950/40">
          <Timeline p={p} />
          {["submitted", "confirming", "confirmed"].includes(p.status) && !unresolvedOf(p) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {p.status !== "confirmed" && <MockAdvanceButton paymentId={p.id} />}
              {(p.status === "confirming" || p.status === "confirmed") && <MockReorgButton paymentId={p.id} />}
            </div>
          )}
        </Card>
        <div className="flex flex-col gap-4">
          <DecisionPanel d={p.decision} />
          <Card title="Payment details" className="!bg-zinc-950/40" testId="send-record">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-zinc-500">Status</dt>
              <dd>{paymentBadge(p).label}</dd>
              <dt className="text-zinc-500">Confirmations</dt>
              <dd className="tabular-nums">{p.confirmations ?? 0}{simulated && <span className="text-xs text-zinc-500"> (simulated)</span>}</dd>
              <dt className="text-zinc-500">Privacy</dt>
              <dd>{!p.pool ? (sentAlready ? "Not reported by the server" : "Not sent yet") : simulated ? `Simulated ${p.pool} pool send, nothing real moved` : `${p.pool} pool, as reported by VeilPay`}</dd>
              <dt className="text-zinc-500">{p.mockRef ? "Practice reference" : "Transaction ID"}</dt>
              <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]" data-testid="tx-ref">
                {p.mockRef ? (
                  <>
                    {p.mockRef}
                    <span className="mt-0.5 block font-sans text-zinc-500">Practice only, not a txid or a real transaction.</span>
                  </>
                ) : p.txid ? (
                  <>
                    {p.txid}
                    {awaitingOperatorConfirmation(op) && (
                      <Badge tone="warning" className="ml-1" testId="txid-not-broadcast">signed, not broadcast</Badge>
                    )}
                  </>
                ) : (
                  <span className="font-sans text-sm text-zinc-400">None yet</span>
                )}
              </dd>
              {op && (
                <>
                  <dt className="text-zinc-500">Send step</dt>
                  <dd data-testid="wallet-op">
                    {op.needsOperator ? "Requires operator review" : WALLET_OP_COPY[op.state]} · attempt {op.attempt}
                  </dd>
                  {op.phase && (
                    <>
                      <dt className="text-zinc-500">Operator step</dt>
                      <dd data-testid="wallet-op-phase">{WALLET_PHASE_COPY[op.phase]}</dd>
                    </>
                  )}
                  {op.feeZat && (
                    <>
                      <dt className="text-zinc-500">Network fee</dt>
                      <dd><Zec zat={op.feeZat} /> <span className="text-xs text-zinc-500">approved by the operator, not taken from the budget</span></dd>
                    </>
                  )}
                  {op.lastReconciledAt && (
                    <>
                      <dt className="text-zinc-500">Last reconciled</dt>
                      <dd className="text-xs">
                        {fmtTime(op.lastReconciledAt)} <Badge tone="warning" className="ml-1">provisional</Badge>
                      </dd>
                    </>
                  )}
                </>
              )}
            </dl>
            {sentAlready && !awaitingOperatorConfirmation(op) && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
                <CircleDot size={12} aria-hidden /> Already on its way: pausing the agent or changing the rules does not affect this payment.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function PaymentRow({ p, active, onClick }: { p: Payment; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      data-testid={`row-${p.id}`}
      className={clsx(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition",
        active ? "bg-zinc-800 ring-1 ring-zinc-700" : "hover:bg-zinc-900",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm text-zinc-100">{p.reference}</div>
        <div className="text-xs text-zinc-500">{fmtTime(p.createdAt)}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Zec zat={p.amountZat} className="text-sm" />
        <PaymentBadge p={p} />
      </div>
    </button>
  );
}
