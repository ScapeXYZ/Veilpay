"use client";

import { useState } from "react";
import { AgentSummary } from "@/components/agent-summary";
import { PageHeader, RequireContext } from "@/components/shell";
import { Button, Card, ErrorBox, Field, Notice, inputCls } from "@/components/ui";
import { errorText, useAgent, usePutPolicy, useSession } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/types";
import type { Agent } from "@/lib/contract/schemas";
import { fmtTime } from "@/lib/present";
import { formatZec, parseZecInput } from "@/lib/zat";

function PolicyForm() {
  const { data: s } = useSession();
  const { data: a } = useAgent(s?.agentId);
  if (!a) return null;
  // re-mount the editor when the backend version changes, so it always starts from the latest policy
  return <PolicyEditor key={a.policy.version} agent={a} />;
}

function PolicyEditor({ agent: a }: { agent: Agent }) {
  const put = usePutPolicy();
  const [cap, setCap] = useState(() => formatZec(a.policy.perTxLimitZat, { unit: false }));
  const [budget, setBudget] = useState(() => formatZec(a.policy.totalBudgetZat, { unit: false }));
  const [merchants, setMerchants] = useState(() => a.policy.allowedMerchantIds.join(", "));
  const [ttl, setTtl] = useState(() => (a.policy.requestTtlSeconds ? String(a.policy.requestTtlSeconds) : ""));
  const [inputErr, setInputErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const submit = () => {
    setInputErr(null);
    setSaved(null);
    const perTxLimitZat = parseZecInput(cap.replace(/,/g, ""));
    const totalBudgetZat = parseZecInput(budget.replace(/,/g, ""));
    const ttlN = ttl.trim() === "" ? undefined : Number(ttl);
    if (!perTxLimitZat || !totalBudgetZat) return setInputErr("Amounts must be ZEC with at most 8 decimals.");
    if (ttlN !== undefined && (!Number.isInteger(ttlN) || ttlN < 30 || ttlN > 86400)) return setInputErr("Request TTL must be 30 to 86400 seconds.");
    put.mutate(
      {
        agentId: a.id,
        body: {
          expectedVersion: a.policy.version,
          perTxLimitZat,
          totalBudgetZat,
          allowedMerchantIds: merchants.split(",").map((m) => m.trim()).filter(Boolean),
          ...(ttlN !== undefined ? { requestTtlSeconds: ttlN } : {}),
        },
      },
      { onSuccess: (p) => setSaved(p.version) },
    );
  };
  const conflict = put.error instanceof ApiError && put.error.body.code === "VERSION_CONFLICT";
  return (
    <Card title={`Policy v${a.policy.version}`} action={<span className="text-xs text-zinc-500">updated {fmtTime(a.policy.updatedAt)}</span>} testId="policy-form">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Per-payment cap (ZEC)">
          <input className={`${inputCls} font-mono`} value={cap} onChange={(e) => setCap(e.target.value)} data-testid="cap-input" />
        </Field>
        <Field label="Total budget (ZEC)" hint="Lowering it below spent + reserved is accepted but blocks new approvals until usage fits.">
          <input className={`${inputCls} font-mono`} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <Field label="Allowed merchant ids" hint="Comma separated.">
          <input className={`${inputCls} font-mono`} value={merchants} onChange={(e) => setMerchants(e.target.value)} />
        </Field>
        <Field label="Request TTL (seconds)">
          <input className={`${inputCls} font-mono`} value={ttl} onChange={(e) => setTtl(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={submit} busy={put.isPending} data-testid="save-policy">
          Save as v{a.policy.version + 1}
        </Button>
        {saved && <span className="text-sm text-emerald-300" data-testid="policy-saved">Saved, now v{saved}.</span>}
      </div>
      {inputErr && <div className="mt-3"><ErrorBox>{inputErr}</ErrorBox></div>}
      {put.error && (
        <div className="mt-3">
          <ErrorBox>{conflict ? "Someone else changed the policy. The latest version is loaded; review and save again." : errorText(put.error)}</ErrorBox>
        </div>
      )}
      <div className="mt-5">
        <Notice tone="neutral" title="What a policy change touches">
          <ul className="list-disc space-y-1 pl-4">
            <li>Approved but unsent payments are re-checked at execute against the current version, and rejected if they no longer fit.</li>
            <li>Payments already submitted, confirming or unresolved are never cancelled. A broadcast shielded send cannot be recalled.</li>
            <li>History is never rewritten: each decision keeps the policy version it was made under.</li>
          </ul>
        </Notice>
      </div>
    </Card>
  );
}

export default function PolicyPage() {
  return (
    <>
      <PageHeader title="Agent policy" subtitle="The owner's rules, enforced by the backend on every request and again at execute." />
      <RequireContext ctx="customer">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
          <PolicyForm />
          <AgentSummary withControls />
        </div>
      </RequireContext>
    </>
  );
}
