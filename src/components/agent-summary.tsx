"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "@/lib/api/types";
import { Pause, Play } from "lucide-react";
import { useNetworkMode } from "@/lib/api/data-source";
import { errorText, useApi, useSelectedAgent, useAgent, useSession, useSetAgentStatus, useRegisterAccount } from "@/lib/api/hooks";
import { parseZecInput } from "@/lib/zat";
import { pctZat } from "@/lib/zat";
import { SourceTag } from "./source";
import { Badge, Button, Card, ErrorBox, Meter, Skeleton, Zec } from "./ui";

function AgentSetup() {
  const mode = useNetworkMode();
  const { data: session } = useSession();
  if (mode.kind !== "mock") {
    if (!session?.authenticated) return <AccountSetup />;
    return (
      <Card title="No payment agent configured" testId="agent-setup">
        <p className="text-sm text-zinc-400">No agent record is available in this workspace. VeilPay will not create a default agent, budget, merchant list, or payment history for you.</p>
        <p className="mt-3 text-xs text-zinc-500">Agent creation and account ownership need a reviewed testnet identity boundary before this control can be offered.</p>
      </Card>
    );
  }
  return <MockAgentSetup />;
}

function AccountSetup() {
  const register = useRegisterAccount();
  const [displayName, setDisplayName] = useState("");
  const [accountType, setAccountType] = useState<"individual" | "freelancer" | "merchant" | "team" | "business">("individual");
  return <Card title="Create your VeilPay testnet workspace" testId="account-setup">
    <p className="text-sm text-zinc-400">Your Noir Wallet connection is read-only and never creates an account. Create a separate VeilPay workspace to own agents and policies.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Display name<input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} /></label><label className="text-sm">Workspace type<select className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={accountType} onChange={(e) => setAccountType(e.target.value as typeof accountType)}><option value="individual">Individual</option><option value="freelancer">Freelancer</option><option value="merchant">Merchant</option><option value="team">Team</option><option value="business">Business</option></select></label></div>
    <Button className="mt-4" disabled={!displayName.trim()} busy={register.isPending} onClick={() => register.mutate({ displayName: displayName.trim(), accountType })}>Create secure session</Button>
    <p className="mt-3 text-xs text-zinc-500">Testnet session only. It is separate from wallet data and expires automatically; no wallet address, history, balance, or memo is sent to VeilPay.</p>
    {register.error && <div className="mt-3"><ErrorBox>{errorText(register.error)}</ErrorBox></div>}
  </Card>;
}

/** Isolated fixture-only setup. Live workspaces never receive preset policy values. */
function MockAgentSetup() {
  const api = useApi();
  const { setAgentId } = useSelectedAgent();
  const [existing, setExisting] = useState("");
  const [creationKey] = useState(newIdempotencyKey);
  const create = useMutation({ mutationFn: () => api.createAgent({ name: "Demo customer agent", policy: {
    perTxLimitZat: "10000000", totalBudgetZat: "100000000", allowedMerchantIds: ["mer_demo"], requestTtlSeconds: 900,
  } }, creationKey), onSuccess: (agent) => setAgentId(agent.id) });
  const select = useMutation({ mutationFn: () => api.getAgent(existing.trim()), onSuccess: (agent) => setAgentId(agent.id) });
  return <Card title="Choose a customer agent">
    <p className="mb-3 text-sm text-zinc-400">Create an agent with a 0.1 ZEC payment cap and 1 ZEC budget for mer_demo. You can edit its policy after creation.</p>
    <Button busy={create.isPending} onClick={() => create.mutate()}>Create demo agent</Button>
    <label className="mt-4 block text-sm">Existing agent ID
      <input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={existing} onChange={(e) => setExisting(e.target.value)} />
    </label>
    <Button className="mt-2" busy={select.isPending} disabled={!existing.trim()} onClick={() => select.mutate()}>Select agent</Button>
    {(create.error || select.error) && <ErrorBox>{errorText(create.error ?? select.error)}</ErrorBox>}
  </Card>;
}

function LiveAgentSetup() {
  const api = useApi(); const { setAgentId } = useSelectedAgent();
  const [name, setName] = useState(""); const [cap, setCap] = useState(""); const [budget, setBudget] = useState(""); const [merchants, setMerchants] = useState("");
  const [key] = useState(newIdempotencyKey); const [inputError, setInputError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: () => { const perTxLimitZat = parseZecInput(cap); const totalBudgetZat = parseZecInput(budget); const allowedMerchantIds = merchants.split(",").map(x => x.trim()).filter(Boolean); if (!name.trim() || !perTxLimitZat || !totalBudgetZat || allowedMerchantIds.length === 0) throw new Error("Enter an agent name, both limits, and at least one approved merchant ID."); return api.createAgent({ name: name.trim(), policy: { perTxLimitZat, totalBudgetZat, allowedMerchantIds } }, key); }, onSuccess: a => setAgentId(a.id) });
  return <Card title="Create a payment agent" testId="agent-create">
    <p className="text-sm text-zinc-400">These are enforceable backend rules. Policy approval evaluates a request only; it never signs, sends, or broadcasts a payment.</p>
    <div className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-sm">Agent name<input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={name} onChange={e => setName(e.target.value)} maxLength={64} /></label><label className="text-sm">Max per payment (ZEC)<input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={cap} onChange={e => setCap(e.target.value)} inputMode="decimal" /></label><label className="text-sm">Total budget (ZEC)<input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={budget} onChange={e => setBudget(e.target.value)} inputMode="decimal" /></label><label className="text-sm">Approved merchant IDs<input className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2" value={merchants} onChange={e => setMerchants(e.target.value)} placeholder="mer_…" /></label></div>
    <Button className="mt-4" busy={create.isPending} onClick={() => { setInputError(null); create.mutate(); }}>Create agent</Button>
    {(inputError || create.error) && <div className="mt-3"><ErrorBox>{inputError ?? errorText(create.error)}</ErrorBox></div>}
  </Card>;
}

export function AgentSummary({ withControls = false }: { withControls?: boolean }) {
  const mode = useNetworkMode();
  const { data: s } = useSession();
  const { agentId } = useSelectedAgent();
  const { data: a, isLoading, error } = useAgent(agentId, s?.context === "customer");
  const st = useSetAgentStatus();
  if (mode.kind === "mock" && !agentId) return <MockAgentSetup />;
  if (!s?.authenticated || (s.context === "customer" && !agentId)) return <>{!s?.authenticated ? <AgentSetup /> : <LiveAgentSetup />}</>;
  if (s.context === "merchant") return <Card title="Merchant workspace" testId="merchant-workspace"><p className="text-sm text-zinc-400">This authenticated workspace can create and verify its own invoices. It cannot read or modify another user&apos;s payment agents or policies.</p></Card>;
  if (isLoading || !a) return error ? <ErrorBox>{errorText(error)}</ErrorBox> : <Skeleton className="h-48" />;
  const u = a.usage;
  const total = a.policy.totalBudgetZat;
  const spentPct = pctZat(u.spentZat, total);
  const resPct = Math.min(100 - spentPct, pctZat(u.reservedZat, total));
  return (
    <Card
      testId="agent-summary"
      title={
        <span className="flex items-center gap-2">
          {a.name}
          <Badge tone={a.status === "active" ? "success" : "warning"} testId="agent-status">
            {a.status}
          </Badge>
        </span>
      }
      action={<SourceTag />}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs text-zinc-500">Per-payment cap</div>
          <Zec zat={a.policy.perTxLimitZat} className="text-zinc-100" testId="cap" />
        </div>
        <div>
          <div className="text-xs text-zinc-500">Total budget</div>
          <Zec zat={total} className="text-zinc-100" />
        </div>
      </div>
      <div className="mt-4">
        <Meter
          total={total}
          parts={[
            { pct: spentPct, cls: "bg-emerald-500", label: "spent" },
            { pct: resPct, cls: "bg-sky-500", label: "reserved" },
          ]}
        />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
          <span>
            <i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
            spent <Zec zat={u.spentZat} className="text-zinc-200" />
          </span>
          <span>
            <i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
            reserved <Zec zat={u.reservedZat} className="text-zinc-200" />
          </span>
          <span>
            remaining <Zec zat={u.remainingZat} className="text-zinc-200" testId="remaining" />
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {u.approvedCount} approved · {u.pendingCount} pending · {u.rejectedCount} blocked · policy v{a.policy.version}. Numbers come from the backend; the browser never sums them.
        </p>
      </div>
      {withControls && (
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <Button
            variant={a.status === "active" ? "secondary" : "primary"}
            busy={st.isPending}
            onClick={() => st.mutate({ agentId: a.id, status: a.status === "active" ? "paused" : "active" })}
            data-testid="toggle-agent"
          >
            {a.status === "active" ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            {a.status === "active" ? "Pause agent" : "Resume agent"}
          </Button>
          <p className="mt-2 text-xs text-zinc-500">
            Pausing blocks new requests and rejects approved-but-unsent payments at execute. Payments already broadcast are not cancelled: a shielded send cannot be recalled.
          </p>
          {st.error && <div className="mt-2"><ErrorBox>{errorText(st.error)}</ErrorBox></div>}
        </div>
      )}
    </Card>
  );
}
