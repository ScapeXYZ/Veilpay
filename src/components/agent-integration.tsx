"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, RotateCw, ShieldOff, Trash2 } from "lucide-react";
import { Button, Card, ErrorBox } from "@/components/ui";
import { errorText, useApi } from "@/lib/api/hooks";

type IntegrationType = "openclaw" | "python" | "javascript" | "https";

const endpoint = "https://veilpay-testnet.onrender.com/api/v1/agent/payment-evaluations";
const placeholders = {
  merchantId: "<APPROVED_MERCHANT_ID>",
  amountZat: "<AMOUNT_IN_ZATOSHIS>",
  reference: "<YOUR_REFERENCE>",
  credential: "<VEILPAY_AGENT_CREDENTIAL>",
  key: "<UNIQUE_IDEMPOTENCY_KEY>",
};

const integrationGuides: Record<IntegrationType, { label: string; summary: string; steps: string[]; code: string }> = {
  openclaw: {
    label: "OpenClaw",
    summary: "Add this as an HTTP action in OpenClaw. Use its secret store for the credential, not the action text.",
    steps: ["Create an HTTP action with POST.", "Store the credential as VEILPAY_AGENT_CREDENTIAL in OpenClaw’s secret store.", "Generate a new idempotency key for every new proposal."],
    code: `POST ${endpoint}\nAuthorization: Bearer \${VEILPAY_AGENT_CREDENTIAL}\nIdempotency-Key: ${placeholders.key}\nContent-Type: application/json\n\n{"merchantId":"${placeholders.merchantId}","amountZat":"${placeholders.amountZat}","reference":"${placeholders.reference}"}`,
  },
  python: {
    label: "Python",
    summary: "Set the credential in your agent’s secret manager or environment, then make this request with requests.",
    steps: ["Install requests in the agent environment if it is not already available.", "Set VEILPAY_AGENT_CREDENTIAL through your secret manager.", "Treat an allowed response as a policy evaluation only—not a payment instruction."],
    code: `import os, uuid, requests\n\nresponse = requests.post(\n    "${endpoint}",\n    headers={\n        "Authorization": f"Bearer {os.environ['VEILPAY_AGENT_CREDENTIAL']}",\n        "Idempotency-Key": f"eval-{uuid.uuid4()}",\n        "Content-Type": "application/json",\n    },\n    json={\n        "merchantId": "${placeholders.merchantId}",\n        "amountZat": "${placeholders.amountZat}",\n        "reference": "${placeholders.reference}",\n    },\n    timeout=10,\n)\nresponse.raise_for_status()\ndecision = response.json()`,
  },
  javascript: {
    label: "JavaScript",
    summary: "Keep the credential in your runtime secret manager and send it only in the Authorization header.",
    steps: ["Set VEILPAY_AGENT_CREDENTIAL in the agent runtime—not browser code.", "Use a fresh idempotency key for each new proposal.", "Check decision.allowed before taking any separate, external action."],
    code: `const response = await fetch("${endpoint}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.VEILPAY_AGENT_CREDENTIAL}\`,\n    "Idempotency-Key": crypto.randomUUID(),\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify({\n    merchantId: "${placeholders.merchantId}",\n    amountZat: "${placeholders.amountZat}",\n    reference: "${placeholders.reference}",\n  }),\n});\nif (!response.ok) throw new Error("VeilPay evaluation failed");\nconst decision = await response.json();`,
  },
  https: {
    label: "Other HTTPS Agent",
    summary: "Any agent that can send HTTPS JSON can use the same narrow policy-evaluation endpoint.",
    steps: ["Keep the credential in the agent’s secret store; never put it in a URL.", "Send exactly the three JSON fields shown below.", "Reuse the same idempotency key only when retrying the identical request."],
    code: `curl --fail-with-body -X POST "${endpoint}" \\\n+  -H "Authorization: Bearer ${placeholders.credential}" \\\n+  -H "Idempotency-Key: ${placeholders.key}" \\\n+  -H "Content-Type: application/json" \\\n+  --data '{"merchantId":"${placeholders.merchantId}","amountZat":"${placeholders.amountZat}","reference":"${placeholders.reference}"}'`,
  },
};

function IntegrationGuide() {
  const [selected, setSelected] = useState<IntegrationType>("openclaw");
  const [copied, setCopied] = useState(false);
  const guide = integrationGuides[selected];
  const copy = async () => {
    await navigator.clipboard?.writeText(guide.code);
    setCopied(true);
  };
  return <div className="mt-5 border-t border-zinc-800 pt-4" data-testid="agent-onboarding">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">1. Choose an integration</p><p className="mt-1 text-sm text-zinc-400">Use your existing agent—VeilPay only evaluates its proposed spending requests.</p></div>
      <label className="text-sm text-zinc-300">Integration type
        <select aria-label="Integration type" className="ml-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" value={selected} onChange={(event) => { setSelected(event.target.value as IntegrationType); setCopied(false); }}>
          {Object.entries(integrationGuides).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
        </select>
      </label>
    </div>
    <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <p className="text-sm font-medium text-zinc-100">{guide.label} setup</p>
      <p className="mt-1 text-sm text-zinc-400">{guide.summary}</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-400">{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Copyable request template</p><Button variant="ghost" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy template"}</Button></div>
      <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs leading-5 text-zinc-200"><code>{guide.code}</code></pre>
    </div>
    <p className="mt-3 text-xs text-zinc-500">Templates use placeholders only. Keep credentials out of URLs, analytics, logs, prompts, and screenshots. VeilPay shows a credential once and stores only a verifier.</p>
    <p className="mt-2 text-xs text-zinc-500">Need more detail? Read the <a className="text-accent-300 underline" href="/app/help#agent-api">in-app API guidance</a> or the <a className="text-accent-300 underline" href="https://github.com/ScapeXYZ/Veilpay/blob/main/docs/UNIVERSAL_AGENT_API.md" target="_blank" rel="noreferrer">working request examples and Universal Agent API reference</a>.</p>
  </div>;
}

export function AgentIntegration({ agentId }: { agentId: string }) {
  const api = useApi(); const qc = useQueryClient();
  const credentials = useQuery({ queryKey: ["agent-credentials", agentId], queryFn: () => api.listAgentCredentials(agentId) });
  const issue = useMutation({ mutationFn: () => api.createAgentCredential(agentId), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeAgentCredential(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const rotate = useMutation({ mutationFn: (id: string) => api.rotateAgentCredential(agentId, id), onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-credentials", agentId] }) });
  const erase = useMutation({ mutationFn: () => api.deleteAgentIntegrationActivity(agentId) });
  const issued = issue.data?.token ?? rotate.data?.token;
  return <Card title="Connect an AI Agent" testId="agent-integration">
    <p className="text-sm text-zinc-400">Connect any AI agent using VeilPay&apos;s secure API. Your agent can request spending-policy decisions without accessing your wallet or changing your rules.</p>
    <p className="mt-2 text-xs text-zinc-500">Noir Wallet remains separate and read-only. A policy decision is not a payment, reservation, wallet authorization, signing, or broadcast; actual ZEC payments remain disabled.</p>
    <IntegrationGuide />
    <div className="mt-4 flex flex-wrap gap-2"><Button busy={issue.isPending} onClick={() => issue.mutate()}><KeyRound size={14} /> Generate agent credential</Button><a href="/app/help#agent-api" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-accent-300">API documentation</a></div>
    {issued && <div className="mt-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3"><p className="text-sm text-amber-100">Copy this credential now. It is shown once and is not stored by VeilPay.</p><code className="mt-2 block break-all text-xs text-zinc-200">{issued}</code><Button variant="secondary" className="mt-2" onClick={() => void navigator.clipboard?.writeText(issued)}><Copy size={14} /> Copy credential</Button></div>}
    <div className="mt-5"><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">2. Verify connection activity</p><p className="mt-1 text-xs text-zinc-500">Generating a credential is not proof that an agent is connected. A credential shows activity only after a verified API request.</p>{credentials.data?.items.length ? <ul className="mt-2 space-y-2">{credentials.data.items.map(c => <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-2 text-xs"><span>{c.hint} · {c.lastUsedAt ? "used by a verified API request" : "no verified API requests yet"} · {c.revokedAt ? "revoked" : "active"}</span>{!c.revokedAt && <span className="flex gap-2"><Button variant="ghost" busy={rotate.isPending} onClick={() => rotate.mutate(c.id)}><RotateCw size={13} /> Rotate</Button><Button variant="ghost" busy={revoke.isPending} onClick={() => revoke.mutate(c.id)}><ShieldOff size={13} /> Revoke</Button></span>}</li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">No credential yet. Generating one does not mean an external agent is connected.</p>}</div>
    <p className="mt-4 text-xs text-zinc-500">Rules remain active when an agent disconnects. Pause the agent to deny new requests, or revoke a credential to remove its access. Revoked credentials cannot submit new requests; paused agents cannot obtain new policy approvals.</p>
    <div className="mt-4 border-t border-zinc-800 pt-3"><Button variant="ghost" busy={erase.isPending} onClick={() => erase.mutate()}><Trash2 size={14} /> Delete integration activity</Button><p className="mt-1 text-xs text-zinc-500">Deletes stored policy-evaluation activity and its replay snapshots for this agent. Credentials and rules remain.</p>{erase.data && <p className="mt-1 text-xs text-emerald-300">Deleted {erase.data.deleted} activity record(s).</p>}</div>
    {(issue.error || rotate.error || revoke.error || erase.error || credentials.error) && <div className="mt-3"><ErrorBox>{errorText(issue.error ?? rotate.error ?? revoke.error ?? erase.error ?? credentials.error)}</ErrorBox></div>}
  </Card>;
}
