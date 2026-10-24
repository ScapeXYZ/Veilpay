"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { newIdempotencyKey } from "@/lib/api/types";
import { Pause, Play } from "lucide-react";
import { errorText, useApi, useSelectedAgent, useAgent, useSession, useSetAgentStatus } from "@/lib/api/hooks";
import { pctZat } from "@/lib/zat";
import { SourceTag } from "./source";
import { Badge, Button, Card, ErrorBox, Meter, Skeleton, Zec } from "./ui";

function AgentSetup() {
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

export function AgentSummary({ withControls = false }: { withControls?: boolean }) {
  const { data: s } = useSession();
  const { agentId } = useSelectedAgent();
  const { data: a, isLoading, error } = useAgent(agentId, s?.context === "customer");
  const st = useSetAgentStatus();
  if (s?.context === "customer" && !agentId) return <AgentSetup />;
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
