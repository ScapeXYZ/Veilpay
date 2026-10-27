# Universal Agent API (Testnet v1)

VeilPay is a framework-independent spending-policy firewall. Any agent capable of HTTPS JSON requests can ask the Rust backend to evaluate a proposed payment. OpenClaw, Python, and JavaScript are optional clients, not dependencies.

## Security boundary

Create a credential from **Agent & rules → Connect an AI Agent**. It is shown once; VeilPay retains only a SHA-256 verifier. A credential is scoped to one workspace and one agent. It cannot read wallet data, administer a workspace, edit rules, sign, send, broadcast, create invoices, or retrieve browser sessions.

Credentials expire after 90 days by default, can be revoked or rotated, and are limited to 60 requests/minute. Use HTTPS, keep them out of source control, and send an idempotency key for every request. A repeated key with the same payload returns the original decision; a changed payload is rejected.

## `POST /api/v1/agent/payment-evaluations`

Headers: `Authorization: Bearer vpa_…`, `Idempotency-Key: <8–128 chars>`, and `Content-Type: application/json`.

```json
{"merchantId":"merchant_acme","amountZat":"2500000","reference":"invoice-42"}
```

The `amountZat` value is a positive integer decimal string. The response is `201` and includes only `allowed`, `reasonCode`, `explanation`, `policyVersion`, and `requestId`. It never includes wallet data, agent/workspace IDs, budgets, allowlists, full policies, credentials, or other activity. Reasons are minimal: `AGENT_PAUSED` or generic `POLICY_DENIED`, which avoids exposing private thresholds.

An allowed decision is only a recorded policy evaluation. It is **not** a payment, balance reservation, wallet authorization, invoice, signature, broadcast, confirmation, or settlement. ZEC execution remains disabled.

```sh
curl --fail-with-body https://veilpay-testnet.onrender.com/api/v1/agent/payment-evaluations \
  -H "Authorization: Bearer $VEILPAY_AGENT_CREDENTIAL" \
  -H "Idempotency-Key: eval-$(uuidgen)" -H "Content-Type: application/json" \
  --data '{"merchantId":"merchant_acme","amountZat":"2500000","reference":"invoice-42"}'
```

Python:

```python
requests.post(url, headers={"Authorization": f"Bearer {credential}", "Idempotency-Key": key}, json=proposal, timeout=10).raise_for_status()
```

JavaScript/TypeScript:

```ts
await fetch(url, {method: "POST", headers: {Authorization: `Bearer ${credential}`, "Idempotency-Key": key, "Content-Type":"application/json"}, body: JSON.stringify(proposal)});
```

OpenClaw (optional): configure an HTTP action with the same URL, bearer header, idempotency key, and JSON body. No OpenClaw plugin, wallet extension, or LLM provider access is required.

Malformed, expired, revoked, or cross-workspace credentials return no workspace data. Unexpected request fields are rejected. Retry transient `5xx` or `429` responses with backoff and the same key; do not retry validation or deny responses as a new payment. Updating policies, pausing/resuming an agent, and rotating a credential take effect on the next request without reconnecting a client.
