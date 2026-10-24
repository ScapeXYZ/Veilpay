# VeilPay MVP demo readiness

Validated on 2026-10-24 from `chore/demo-readiness` (based on
`integration/veilpay-milestone6`). This is an honest regtest/mock demonstration:
it does not access a wallet, sign, broadcast, settle, or represent real funds.

## Exact local setup

Use a disposable database outside the repository:

```bash
NETWORK=regtest WALLET_BACKEND=mock \
DATABASE_URL=sqlite:///tmp/veilpay-demo-readiness.db \
FRONTEND_ORIGIN=http://127.0.0.1:3100 BIND_ADDR=127.0.0.1:4000 \
cargo run --locked --manifest-path backend/Cargo.toml
```

In a second terminal:

```bash
NEXT_PUBLIC_API_MODE=live VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api \
npm run dev
```

Open `http://127.0.0.1:3100`. Confirm the health badge/API reports `regtest`,
`mock`, and `walletBackend: mock` before presenting. Remove the disposable
database afterwards if desired:

```bash
rm /tmp/veilpay-demo-readiness.db
```

## Three-minute, API-backed sequence

1. **0:00–0:20 — Overview.** Open `/app` (or select **Open VeilPay** from `/`)
   and explain in plain English that an AI agent
   requests a shielded payment, while the backend—not the agent/browser—enforces
   the owner's policy. The page labels backend decisions and the demo nature of
   mock data.
2. **0:20–0:45 — Spending allowance.** Create/select the demo customer agent.
   The summary shows per-payment cap, total policy budget, spent, reserved, and
   remaining allowance. These fields are backend data.
3. **0:45–1:05 — Rules.** On `/app/spending-rules`, show the configured cap, total budget,
   merchant allow-list, and request TTL. Explain that a policy is checked both
   at request and before execution.
4. **1:05–1:35 — Permitted mock/regtest request.** Switch to Merchant, create
   an invoice, then use its ID from Customer to request an amount inside the
   cap. The validated live API flow returned `authorized`; executing it returned
   `confirmed` with a `mockRef` and a final mock operation. Say explicitly that
   this is simulated, not chain settlement.
5. **1:35–1:55 — Overspending protection.** Submit an amount over the cap. The
   live API response was `rejected` with `CAP_EXCEEDED` (and, for the reused
   invoice, amount/invoice violations). No real funds move.
6. **1:55–2:20 — Merchant.** On `/app/merchant`, display the generated invoice and
   receipt state. In this configuration it is a non-spendable
   `veilpay-mock:` payload; verification reports `method: mock`, `mock: true`.
   It must never be described as a testnet payment or on-chain receipt.
7. **2:20–2:40 — Activity and uncertainty.** On `/app/payments`, show the timeline
   and explain that backend-provided unresolved operations are held and never
   resent automatically. Do not claim to demonstrate a live uncertain operation:
   one is not constructible by the normal mock UI flow.
8. **2:40–3:00 — Mainnet boundary.** Show the health badge is `regtest` and
   state that this demo session is unavailable outside testnet/regtest. The
   mainnet endpoint is read-only only, and execution is refused by backend tests.

## What was actually validated

The local Axum server was run with `NETWORK=regtest WALLET_BACKEND=mock` and the
frontend with `NEXT_PUBLIC_API_MODE=live`. Both direct `/api/health` and the
Next same-origin `/api/health` proxy reported:

```json
{"mode":"mock","network":"regtest","walletBackend":"mock","status":"ok"}
```

An API-backed local journey created a mock invoice, customer agent, an allowed
12,000,000-zatoshi request, an execution, an overspend request, and merchant
verification. Observed results:

| Step | Observed result |
| --- | --- |
| Invoice | `veilpay-mock-v1`, `mock: true`, `spendable: false` |
| Allowed request | `status: authorized`, `decision: authorized` |
| Mock execution | `status: confirmed`, `mockRef` present, operation `state: final` |
| Overspend | `status: rejected`, including `CAP_EXCEEDED` |
| Merchant verification | `state: received`, `method: mock`, `mock: true`, 1 confirmation |

The integration result is only evidence of the mock adapter's simulation. It is
not evidence of a funded wallet, a broadcast, a testnet transaction, merchant
wallet scanning, or settlement.

## Test results and evidence

| Check | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run test` | passed: 181 tests; 11 skipped |
| `node scripts/validate-openapi.mjs` | passed |
| `cargo fmt --manifest-path backend/Cargo.toml -- --check` | passed |
| `cargo clippy --locked --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings` | passed |
| `cargo test --locked --manifest-path backend/Cargo.toml` | passed: 58 tests |
| `npm run test:http` | passed: 10 tests; 1 skipped; disposable regtest/mock Axum server |
| Live Axum + Next proxy health checks | passed |
| `npm run build` | passed: optimized production build, TypeScript, static pages and trace collection |
| Playwright Chromium desktop/mobile | passed: 15 checks; 1 desktop skip for the mobile-only More sheet; live Axum regtest/mock flow covered |

No screenshots, videos, traces, logs, response bodies, or credentials are
committed as evidence. The browser suite may generate a temporary screenshot
inside its ignored test-results directory; it is reproducible from the test and
not retained as a demo artifact. Evidence is the terminal output from the
commands above; temporary databases and cookie jars were under `/tmp` and were
not retained.

## Blockers and partner UI work

- **Wallet-balance comparison:** the current dashboard reports spending
  allowance (budget/spent/reserved/remaining), but the approved API/UI does not
  supply or render a wallet balance. Do not claim to distinguish the two. A
  partner/API decision is required before adding such UI; do not invent one.
- **Real testnet/regtest invoice:** mock mode produces a visibly non-spendable
  `veilpay-mock:` URI, not a testnet/regtest payment URI. A real testnet manual
  wallet setup is outside this MVP run and must not be substituted with mock
  data.
- **Recovery/uncertain interaction:** payment UI can render backend-provided
  unresolved states and tests cover serialized fixtures, but the live normal
  mock UI has no approved control to induce an uncertain outcome. Do not stage
  it as a live event.
- **Browser coverage boundary:** Playwright now runs desktop and mobile Chromium
  against the disposable Axum regtest/mock server. It covers navigation,
  unavailable/loading states, allowance rejection, permitted simulation,
  merchant verification, mainnet read-only UI gating, and mock-reference/balance
  wording. It does not turn the mock adapter into a wallet or settlement test.

## Mainnet restrictions

Mainnet payment execution is not a demo capability. The OpenAPI contract limits
`/operator/mainnet/read-only` to an operator-token-protected, read-only wallet
observation endpoint when `NETWORK=mainnet`; it cannot create, prepare, sign,
submit, or broadcast. Authentication is checked before the network gate, so an
unauthenticated regtest probe correctly returns `401`; the Rust route test with
a valid token verifies `404` outside mainnet. Rust tests also cover refusal of
mainnet execution. Never use demo credentials, mock data, or this script with
real keys or funded wallets.
