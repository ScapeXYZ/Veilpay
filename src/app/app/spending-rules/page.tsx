"use client";

import { CalendarClock, Clock, Gauge, ListChecks, Pause, Play, ShieldCheck, UserCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PageHeader, RequireContext } from "@/components/shell";
import { SourceTag, WriteBlocked } from "@/components/source";
import { Badge, Button, Card, ErrorBox, Field, Meter, Notice, Zec } from "@/components/ui";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useAgent, usePutPolicy, useSession, useSetAgentStatus } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/types";
import type { Agent, PolicyUpdate } from "@/lib/contract/schemas";
import { inputCls } from "@/lib/styles";
import { fmtTime } from "@/lib/present";
import { formatZec, parseZecInput, pctZat } from "@/lib/zat";
import { Term } from "@/components/term";

function Section({ icon, title, help, children }: { icon: ReactNode; title: string; help: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-zinc-800 py-5 first:border-t-0 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">{icon}{title}</div>
        <p className="mt-1 text-xs text-zinc-500">{help}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

type Draft = { perTxLimitZat: string; totalBudgetZat: string; allowedMerchantIds: string[]; requestTtlSeconds?: number };

function diffRows(a: Agent, d: Draft) {
  const rows: { label: string; from: ReactNode; to: ReactNode }[] = [];
  if (d.perTxLimitZat !== a.policy.perTxLimitZat) rows.push({ label: "Max per payment", from: <Zec zat={a.policy.perTxLimitZat} />, to: <Zec zat={d.perTxLimitZat} /> });
  if (d.totalBudgetZat !== a.policy.totalBudgetZat) rows.push({ label: "Total budget", from: <Zec zat={a.policy.totalBudgetZat} />, to: <Zec zat={d.totalBudgetZat} /> });
  const am = a.policy.allowedMerchantIds.join(", ");
  const dm = d.allowedMerchantIds.join(", ");
  if (am !== dm) rows.push({ label: "Approved merchants", from: am || "none", to: dm || "none" });
  const at = a.policy.requestTtlSeconds;
  if (d.requestTtlSeconds !== undefined && d.requestTtlSeconds !== at) rows.push({ label: "Approval time limit", from: at ? `${at}s` : "default", to: `${d.requestTtlSeconds}s` });
  return rows;
}

function PolicyEditor({ agent: a }: { agent: Agent }) {
  const mode = useNetworkMode();
  const put = usePutPolicy();
  const st = useSetAgentStatus();
  const [cap, setCap] = useState(() => formatZec(a.policy.perTxLimitZat, { unit: false }));
  const [budget, setBudget] = useState(() => formatZec(a.policy.totalBudgetZat, { unit: false }));
  const [merchants, setMerchants] = useState(() => a.policy.allowedMerchantIds.join(", "));
  const [ttl, setTtl] = useState(() => (a.policy.requestTtlSeconds ? String(a.policy.requestTtlSeconds) : ""));
  const [inputErr, setInputErr] = useState<string | null>(null);
  const [review, setReview] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const ro = !mode.canWrite;

  const prepare = () => {
    setInputErr(null);
    setSaved(null);
    const perTxLimitZat = parseZecInput(cap.replace(/,/g, ""));
    const totalBudgetZat = parseZecInput(budget.replace(/,/g, ""));
    const ttlN = ttl.trim() === "" ? undefined : Number(ttl);
    if (!perTxLimitZat || !totalBudgetZat) return setInputErr("Amounts must be ZEC with at most 8 decimals.");
    if (ttlN !== undefined && (!Number.isInteger(ttlN) || ttlN < 30 || ttlN > 86400)) return setInputErr("The time limit must be 30 to 86400 seconds.");
    const d: Draft = { perTxLimitZat, totalBudgetZat, allowedMerchantIds: merchants.split(",").map((m) => m.trim()).filter(Boolean), ...(ttlN !== undefined ? { requestTtlSeconds: ttlN } : {}) };
    if (diffRows(a, d).length === 0) return setInputErr("Nothing changed.");
    setReview(d);
  };
  const confirm = () => {
    if (!review || ro) return;
    const body: PolicyUpdate = { expectedVersion: a.policy.version, ...review };
    put.mutate({ agentId: a.id, body }, { onSuccess: (p) => { setSaved(p.version); setReview(null); } });
  };
  const conflict = put.error instanceof ApiError && put.error.body.code === "VERSION_CONFLICT";
  const u = a.usage;
  const spentPct = pctZat(u.spentZat, a.policy.totalBudgetZat);
  const resPct = Math.min(100 - spentPct, pctZat(u.reservedZat, a.policy.totalBudgetZat));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card testId="policy-form" title={<span className="flex items-center gap-2">Spending rules · version {a.policy.version}{ro && <Badge tone="info">view only</Badge>}</span>} action={<span className="text-xs text-zinc-500">updated {fmtTime(a.policy.updatedAt)}</span>}>
        <Section icon={<Gauge size={15} aria-hidden />} title="Max per payment" help="The most the agent can pay in one go. Anything above is blocked, and you see exactly why.">
          <Field label="Max per payment (ZEC)">
            <input className={`${inputCls} font-mono`} value={cap} onChange={(e) => setCap(e.target.value)} data-testid="cap-input" readOnly={ro} inputMode="decimal" />
          </Field>
        </Section>
        <Section icon={<ShieldCheck size={15} aria-hidden />} title="Total budget" help="Everything the agent may spend overall. If you lower it below what is already spent or set aside, new payments wait until it fits.">
          <Field label="Budget (ZEC)">
            <input className={`${inputCls} font-mono`} value={budget} onChange={(e) => setBudget(e.target.value)} readOnly={ro} inputMode="decimal" />
          </Field>
          <div className="mt-3">
            <Meter total={a.policy.totalBudgetZat} parts={[{ pct: spentPct, cls: "bg-emerald-500", label: "spent" }, { pct: resPct, cls: "bg-sky-500", label: "reserved" }]} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              <span>spent <Zec zat={u.spentZat} className="text-zinc-200" /></span>
              <span><Term k="reserved">set aside</Term> <Zec zat={u.reservedZat} className="text-zinc-200" /></span>
              <span>left <Zec zat={u.remainingZat} className="text-zinc-200" /></span>
            </div>
          </div>
        </Section>
        <Section icon={<CalendarClock size={15} aria-hidden />} title="Daily limit" help="A cap per day (UTC). Coming later.">
          <p className="text-sm text-zinc-400" data-testid="daily-pending">Not available yet. Only the total budget applies today.</p>
        </Section>
        <Section icon={<ListChecks size={15} aria-hidden />} title="Approved merchants" help="Shops the agent is allowed to pay, separated by commas. Payments to anyone else are blocked.">
          <Field label="Merchant IDs">
            <input className={`${inputCls} font-mono`} value={merchants} onChange={(e) => setMerchants(e.target.value)} readOnly={ro} />
          </Field>
        </Section>
        <Section icon={<Clock size={15} aria-hidden />} title="Approval time limit" help="How long an approved payment keeps its money set aside before it lapses.">
          <Field label="Time limit (seconds)">
            <input className={`${inputCls} font-mono`} value={ttl} onChange={(e) => setTtl(e.target.value)} readOnly={ro} inputMode="numeric" />
          </Field>
        </Section>
        <Section icon={<UserCheck size={15} aria-hidden />} title="Your approval" help="Asking you before each payment.">
          <p className="text-sm text-zinc-400" data-testid="approval-pending">Coming later. Today every payment inside the rules is approved automatically; the operator&apos;s send step is separate and is not your approval.</p>
        </Section>

        {ro ? (
          <WriteBlocked reason={mode.writeBlockedReason} testId="policy-readonly" />
        ) : review ? (
          <div className="mt-2 rounded-xl border border-accent-900 bg-accent-950/60 p-4" data-testid="policy-review">
            <div className="text-sm font-semibold text-zinc-50">Check your changes before saving</div>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {diffRows(a, review).map((r) => (
                <div key={r.label} className="contents"><dt className="text-zinc-400">{r.label}</dt><dd className="text-zinc-200">{r.from} <span className="text-zinc-500">→</span> <b className="font-medium text-zinc-50">{r.to}</b></dd></div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-zinc-400">{u.pendingCount} approved payment{u.pendingCount === 1 ? "" : "s"} not yet sent will be checked against the new rules before sending. Payments already sent are not affected.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={confirm} busy={put.isPending} data-testid="save-policy">Save new rules</Button>
              <Button variant="ghost" onClick={() => setReview(null)}>Back to editing</Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button onClick={prepare} data-testid="review-policy">Review changes</Button>
            {saved && <span className="text-sm text-emerald-300" data-testid="policy-saved">Saved. Rules are now version {saved}.</span>}
          </div>
        )}
        {inputErr && <div className="mt-3"><ErrorBox>{inputErr}</ErrorBox></div>}
        {put.error && <div className="mt-3"><ErrorBox>{conflict ? "Someone else changed the rules meanwhile. The latest rules are loaded; check and save again." : errorText(put.error)}</ErrorBox></div>}
      </Card>

      <div className="flex flex-col gap-5">
        <Card testId="agent-control" title={<span className="flex items-center gap-2">{a.name}<Badge tone={a.status === "active" ? "success" : "warning"} testId="agent-status">{a.status}</Badge></span>} action={<SourceTag />}>
          {ro ? <WriteBlocked reason={mode.writeBlockedReason} /> : (
            <Button variant={a.status === "active" ? "secondary" : "primary"} busy={st.isPending} onClick={() => st.mutate({ agentId: a.id, status: a.status === "active" ? "paused" : "active" })} data-testid="toggle-agent">
              {a.status === "active" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
              {a.status === "active" ? "Pause agent" : "Resume agent"}
            </Button>
          )}
          <p className="mt-3 text-xs text-zinc-500">Pausing stops new payments and cancels approved ones that have not been sent. Payments already sent cannot be pulled back.</p>
          {st.error && <div className="mt-2"><ErrorBox>{errorText(st.error)}</ErrorBox></div>}
        </Card>
        <Notice tone="neutral" title="What changing the rules affects">
          <ul className="list-disc space-y-1 pl-4">
            <li>Approved payments not yet sent are checked against the new rules first.</li>
            <li>Payments already on their way are never cancelled.</li>
            <li>History stays as it was: each decision shows the rules version it used.</li>
          </ul>
        </Notice>
      </div>
    </div>
  );
}

function PolicyForm() {
  const { data: s } = useSession();
  const { data: a } = useAgent(s?.agentId);
  if (!a) return null;
  // re-mount the editor when the backend version changes, so it always starts from the latest policy
  return <PolicyEditor key={a.policy.version} agent={a} />;
}

export default function PolicyPage() {
  return (
    <>
      <PageHeader title="Spending rules" subtitle="The limits your agent must stay within. VeilPay checks every payment against them, and again right before sending." />
      <RequireContext ctx="customer">
        <PolicyForm />
      </RequireContext>
    </>
  );
}
