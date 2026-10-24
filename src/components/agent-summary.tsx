"use client";

import { Pause, Play } from "lucide-react";
import { errorText, useAgent, useSession, useSetAgentStatus } from "@/lib/api/hooks";
import { pctZat } from "@/lib/zat";
import { SourceTag } from "./source";
import { Badge, Button, Card, ErrorBox, Meter, Skeleton, Zec } from "./ui";

export function AgentSummary({ withControls = false }: { withControls?: boolean }) {
  const { data: s } = useSession();
  const { data: a, isLoading, error } = useAgent(s?.agentId, s?.context === "customer");
  const st = useSetAgentStatus();
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
          {u.approvedCount} approved · {u.pendingCount} not sent yet · {u.rejectedCount} blocked by rules · rules version {a.policy.version}. Totals come from the VeilPay server.
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
            Pausing stops new payments and cancels approved ones that have not been sent. Payments already sent cannot be pulled back.
          </p>
          {st.error && <div className="mt-2"><ErrorBox>{errorText(st.error)}</ErrorBox></div>}
        </div>
      )}
    </Card>
  );
}
