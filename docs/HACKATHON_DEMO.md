# VeilPay hackathon demo

This is a deterministic local **regtest/mock simulation**, not a Zcash settlement demo. It uses the actual Next.js UI and the local Rust/Axum API; it creates its own sessions, agent, invoices, requests, receipt check, and merchant acknowledgment. It does not intercept API routes or use fixture responses.

## Run the walkthrough

```bash
npm run demo:walkthrough
```

The runner chooses two available `127.0.0.1` ports, creates a fresh SQLite database under a new temporary directory, starts Axum with `NETWORK=regtest WALLET_BACKEND=mock`, starts Next in live API mode, runs only the desktop walkthrough, then stops the entire test process group and removes the database and SQLite journals. It needs the local Rust toolchain, frontend dependencies, and Playwright Chromium already installed.

For the full browser suite (desktop and mobile) with the same isolated-port/database setup, use:

```bash
npm run test:browser:isolated
```

## Two-minute narration and capture plan

1. **0:00–0:15 — Trust boundary.** Open Overview. Point out the persistent “Mock practice mode” banner and say: “This is an API-backed regtest/mock simulation. No wallet, broadcast, or real money is involved.”
2. **0:15–0:35 — Owner policy.** Create the demo agent. Show its 1.00 ZEC budget and 0.10 ZEC maximum payment. Explain the backend owns the rule check.
3. **0:35–0:55 — Blocked request.** In Merchant, create the 0.20 ZEC invoice; in Payments, request it. Pause on `CAP_EXCEEDED`: no amount is reserved or moved.
4. **0:55–1:20 — Allowed simulation.** Create the 0.05 ZEC invoice, request it, and execute it. Call the result “Simulated complete.” Point out the `mock_…` practice reference and its explicit “not a txid” label.
5. **1:20–1:40 — Merchant receipt.** In Merchant, look up the new payment ID, show “Method: mock — simulated, no chain read,” then acknowledge it. Say: “This is a merchant statement in the simulation, not independent blockchain settlement.”
6. **1:40–2:00 — Audit trail and outcome.** Show Activity with one blocked and one simulated-complete payment, then Overview with 0.05 ZEC spent and 0.95 ZEC left. Close by repeating that this demonstrates policy enforcement and UX, not real Zcash settlement.

Capture the browser window only. Do not capture terminal output, cookie/devtools panels, response bodies, traces, or `test-results`; those can contain disposable session material. Do not present the mock confirmation count or acknowledgment as independent chain evidence.
