"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RotateCw, ShieldOff } from "lucide-react";
import { Button, Card, ErrorBox } from "@/components/ui";
import { errorText, useApi } from "@/lib/api/hooks";

export function AgentIntegration({ agentId }: { agentId: string }) {
  const api = useApi(); const qc = useQueryClient();
  const credentials = useQuery({ queryKey: ["agent-credentials", agentId], queryFn: () => api.listAgentCredentials(agentId) });
  const issue = useMutation({ mutationFn: () => api.createAgentCredential(agentId), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeAgentCredential(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const rotate = useMutation({ mutationFn: (id: string) => api.rotateAgentCredential(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const issued = issue.data?.token ?? rotate.data?.token;
  return <Card title="Connect an AI Agent" testId="agent-integration">
    <p className="text-sm text-zinc-400">Connect any AI agent using VeilPay&apos;s secure API. Your agent can request spending-policy decisions without accessing your wallet or changing your rules.</p>
    <p className="mt-2 text-xs text-zinc-500">Noir Wallet remains separate and read-only. A policy decision is not a payment, reservation, wallet authorization, signing, or broadcast; actual ZEC payments remain disabled.</p>
    <div className="mt-4 flex flex-wrap gap-2"><Button busy={issue.isPending} onClick={() => issue.mutate()}><KeyRound size={14} /> Generate agent credential</Button><a href="/app/help#agent-api" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-accent-300">API documentation</a></div>
    {issued && <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3"><p className="text-sm text-amber-100">Copy this credential now. It is shown once and is not stored by VeilPay.</p><code className="mt-2 block break-all text-xs text-zinc-200">{issued}</code><Button variant="secondary" className="mt-2" onClick={() => void navigator.clipboard?.writeText(issued)}><Copy size={14} /> Copy credential</Button></div>}
    <div className="mt-5"><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Verified connection activity</p>{credentials.data?.items.length ? <ul className="mt-2 space-y-2">{credentials.data.items.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-2 text-xs"><span>{c.hint} · {c.lastUsedAt ? "used by a verified API request" : "no verified API requests yet"} · {c.revokedAt ? "revoked" : "active"}</span>{!c.revokedAt && <span className="flex gap-2"><Button variant="ghost" busy={rotate.isPending} onClick={() => rotate.mutate(c.id)}><RotateCw size={13} /> Rotate</Button><Button variant="ghost" busy={revoke.isPending} onClick={() => revoke.mutate(c.id)}><ShieldOff size={13} /> Revoke</Button></span>}</li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">No credential yet. Generating one does not mean an external agent is connected.</p>}</div>
    <p className="mt-4 text-xs text-zinc-500">Rules remain saved when an agent disconnects. Revoked credentials cannot submit new requests; paused agents cannot obtain new policy approvals. Python, JavaScript, OpenClaw, and generic HTTPS clients use the same API.</p>
    {(issue.error || rotate.error || revoke.error || credentials.error) && <div className="mt-3"><ErrorBox>{errorText(issue.error ?? rotate.error ?? revoke.error ?? credentials.error)}</ErrorBox></div>}
  </Card>;
}
