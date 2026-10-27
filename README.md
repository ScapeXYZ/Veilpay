# VeilPay

## Give AI agents permission to pay, not permission to overspend.

VeilPay is a Zcash-oriented, framework-independent spending-policy firewall for AI agents. It provides a narrow HTTPS interface for requesting a server-enforced policy decision instead of wallet keys or open-ended payment authority. OpenClaw, Python, JavaScript, and model providers are examples—not dependencies.

**ZECATHON 2026 · Core & Tooling.** VeilPay is reusable infrastructure for Zcash developers, autonomous-payment applications, and agent frameworks. It is not another agent or a wallet.

## Problem, solution, and why VeilPay

Telling an AI agent “do not spend more than 0.1 ZEC” is not independent enforcement: it can misunderstand, be prompted around the instruction, or follow another code path. VeilPay stores policies in the Rust backend and evaluates integrated proposals against agent state, per-payment cap, total budget, merchant allowlist, and optional expiry.

- **Independent enforcement:** rules are checked by the Rust backend, not prompts or client-side code.
- **Framework-independent:** any HTTPS JSON client can use `/api/v1/agent/payment-evaluations`.
- **User-controlled scope:** users configure budgets, merchant restrictions, expiry, and pause state.
- **Revocable access:** credentials can be revoked or rotated without deleting policies.
- **Privacy-conscious separation:** wallet observation, workspace ownership, agent permissions, and policy records are separate boundaries.

## Architecture and current functionality

1. Create a VeilPay Testnet workspace, independently of any wallet.
2. Optionally connect Noir Wallet for browser-local, read-only Testnet observation.
3. Create an agent and save a versioned policy.
4. Generate an agent-scoped credential, shown once; VeilPay stores only its verifier.
5. An external agent submits a proposed amount, merchant identifier, reference, and idempotency key.
6. VeilPay returns allow/deny with a reason and records separate policy-evaluation activity.

Implemented: account-scoped Testnet workspaces; secure HttpOnly browser sessions; agent creation and pause/resume; server-enforced policy evaluation; credential expiry, hashed storage, rotation, revocation, idempotency, and a 60-request/minute limit; generic HTTPS, Python, JavaScript/TypeScript, and optional OpenClaw guidance.

The bearer credential is scoped to one workspace and agent. It cannot administer a workspace, edit rules, access wallet data, create invoices, sign, send, or broadcast.

## Live demo and setup

Live Testnet demo: <https://veilpay-testnet.onrender.com/app>

The deployed demo currently demonstrates workspace onboarding, agent rules, and read-only wallet observation. The universal-agent API in this branch must be merged and deployed before it is available at that URL. Render Free can sleep and uses ephemeral SQLite storage; it is a demo environment, not a durable authorization service.

```bash
NETWORK=testnet WALLET_BACKEND=zingo BIND_ADDR=127.0.0.1:4100 \
FRONTEND_ORIGIN=http://localhost:3200 \
DATABASE_URL=sqlite:///private/path/veilpay-testnet.db \
cargo run --locked --manifest-path backend/Cargo.toml
```

See [Render deployment](docs/RENDER_DEPLOYMENT.md), [feature status](docs/TESTNET_FEATURE_STATUS.md), [release readiness](docs/RELEASE_READINESS.md), and the [merchant receiving decision](docs/merchant-receiving-architecture.md).

## Privacy and security

Noir Wallet is only connected for read-only, browser-local observation. VeilPay does not hand wallet secrets to external agents and does not receive seed phrases, private keys, or viewing keys. Wallet-reported addresses, balances, activity, and memos are deliberately separate from backend policy decisions.

VeilPay does not currently create shielded transactions. Zcash on-chain shielded privacy must not be confused with VeilPay's application-level data separation: this project does not claim complete anonymity, zero-knowledge policy enforcement, or end-to-end payment privacy.

Browser workspace writes require the configured Origin and a session-bound CSRF token; state-changing browser POSTs require idempotency keys. Agent API calls use separate bearer credentials and cannot use cookie administration routes. Read the [privacy threat model](docs/PRIVACY_THREAT_MODEL.md) before a demo.

### Privacy by Design

The agent API returns only a request identifier, allow/deny result, generic reason code, and policy version. It does not return wallet observations, policies, budgets, allowlists, activity, credentials, or workspace identifiers. Credential verifiers—not bearer values—are stored; request replay uses a digest rather than raw API payload. Regression tests cover minimal responses, malformed extraction attempts, revocation, pause, policy changes, and Testnet execution gates. See the [privacy audit](docs/PRIVACY_AUDIT.md) and [privacy demonstration guide](docs/PRIVACY_DEMO.md).

## Frequently Asked Questions

### What is VeilPay?
Server-enforced spending-policy infrastructure for AI agents in Zcash-oriented Testnet workflows. It evaluates proposals; it is not a wallet or payment executor.

### Why does Zcash need VeilPay?
Autonomous applications need limits independent of an agent's instructions. VeilPay supplies reusable policy tooling while retaining a strict boundary from wallet secrets.

### Why not simply tell an AI agent to follow spending limits?
Instructions are not enforcement. VeilPay evaluates each integrated request against backend-held rules.

### What makes VeilPay different from OpenClaw or other AI agents?
VeilPay is not an agent framework. OpenClaw is an optional HTTP client; any authenticated HTTPS client can integrate.

### Can any AI agent connect to VeilPay?
Any agent capable of HTTPS JSON can use the implemented v1 endpoint with a workspace-issued credential.

### Does an AI agent need its own Noir Wallet?
No. Credentials do not grant wallet access, and Noir Wallet observation is optional and read-only.

### Who creates and controls the spending rules?
The authenticated workspace owner creates the agent and controls its policy. Agent credentials cannot edit rules.

### Can an agent change its own spending limits?
No. The external API has no workspace-administration or policy-edit route.

### What happens when an agent exceeds its budget?
The backend returns a denied decision, such as `BUDGET_EXCEEDED`. No payment is made.

### Can I restrict an agent to specific merchants?
Yes. Policies contain an approved merchant identifier allowlist enforced by the backend.

### What happens if I pause an agent?
New external policy requests are denied with `AGENT_PAUSED`. Existing rules remain saved.

### What happens when I disconnect or revoke an agent?
Revocation blocks new API requests. The agent record and its rules remain intact.

### Do my spending rules remain after disconnection?
Yes. Credential lifecycle is separate from agent and policy records.

### Can I update rules without reconnecting an agent?
Yes. The next request uses the current backend policy version; no credential reissue is required.

### Can an agent bypass VeilPay?
VeilPay can only enforce requests sent through its integration. It cannot control an independently funded wallet or another payment path.

### How does VeilPay protect Zcash wallet privacy?
Wallet observation stays browser-local and separate from backend policy records. External agents receive policy decisions, not wallet observation data.

### Does VeilPay access private keys, seed phrases, or viewing keys?
No. Those materials are not sent to VeilPay or to external agents.

### Does VeilPay reveal shielded transactions to AI agents?
No shielded transaction creation or verification is currently implemented. The policy API returns only its policy-evaluation result.

### Does VeilPay currently send real ZEC payments?
No. Signing, sending, broadcasting, and independent settlement verification are disabled.

### What is the difference between policy approval and payment execution?
An approval means the current policy permits a proposal. It does not authorize a wallet or prove a ZEC payment happened.

### What can judges test in the live demo?
They can create a workspace, configure and pause an agent, and observe the separate Noir Wallet flow. API features in this branch require deployment first and can be tested locally using the integration guide.

### Why is VeilPay a Core & Tooling project rather than just another AI application?
It provides an integration boundary, credential lifecycle, policy engine, and security controls reusable across agent frameworks. The agent itself is intentionally out of scope.

### What limitations remain before production use?
Durable storage, production-grade account recovery, abuse controls, operational monitoring, independent settlement verification, and a reviewed execution design remain incomplete.

## Important limitations

- Real signing, sending, broadcasting, and independent settlement verification are disabled.
- A policy approval is not a completed ZEC payment and cannot control a wallet outside VeilPay.
- Live merchant invoice creation fails closed until shielded receiving-address ownership can be verified safely.
- Render Free uses ephemeral SQLite storage and is unsuitable for durable financial authorization.
- The universal-agent API is implemented and regression-tested in this branch, but is not yet deployed to the live demo.

## Developer integration and testing

Read the [Universal Agent API v1 guide](docs/UNIVERSAL_AGENT_API.md) for the HTTPS contract, credentials, rate limits, error handling, cURL, Python, JavaScript/TypeScript, and optional OpenClaw examples.

```bash
npm run typecheck
npm run lint
npm test
npm run build
cargo test --locked --manifest-path backend/Cargo.toml
git diff --check
```

Tests use fixtures and no wallet keys, funding, or live payment operations. For archived transport research and its non-release status, see [merchant receiving architecture](docs/merchant-receiving-architecture.md).

## ZECATHON Core & Tooling relevance

VeilPay supplies a narrow, auditable control plane for Zcash-oriented autonomous-payment applications: policy evaluation is independent of the model and agent framework, while wallet observation and key custody remain outside the credential boundary. It is a useful building block without claiming a solved production payment stack.
