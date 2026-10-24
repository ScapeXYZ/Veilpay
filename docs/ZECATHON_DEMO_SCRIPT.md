# VeilPay — ZECATHON Demo Narration

## Preconditions

Use the isolated walkthrough documented in `docs/HACKATHON_DEMO.md`:

```bash
npm run demo:walkthrough
```

This launches the real local Next.js UI and Rust/Axum API against a fresh SQLite database with `NETWORK=regtest` and `WALLET_BACKEND=mock`. Say “simulation” throughout. Do not describe any mock reference, confirmation, or acknowledgment as a Zcash transaction, chain proof, or settlement.

## Concise narration (about two minutes)

**0:00–0:15 — Establish the boundary.**

“VeilPay is a control layer for businesses that let AI agents request payments. This walkthrough is an API-backed local regtest/mock simulation: no wallet is used, no transaction is broadcast, and no real money moves.”

**0:15–0:30 — Show owner controls.**

“I create the demo agent. Its business policy is a 1.00 ZEC total budget, a 0.10 ZEC maximum per payment, and an approved merchant. These rules live in the Axum backend, not just in the UI.”

**0:30–0:50 — Show a request the agent cannot make.**

“The merchant creates a 0.20 ZEC invoice. The agent requests it. The backend returns `CAP_EXCEEDED`, because 0.20 ZEC exceeds the 0.10 ZEC limit. No money moves, and importantly, nothing is reserved from the 1.00 ZEC budget.”

**0:50–1:15 — Show an allowed request and reservation.**

“Next, the merchant creates a 0.05 ZEC invoice. The request is inside policy, so the backend authorizes it and reserves 0.05 ZEC. VeilPay rechecks the current policy at execution rather than trusting an earlier approval.”

**1:15–1:30 — State the payment boundary precisely.**

“I execute the approved request. In this demo that produces a simulated complete payment and a `mock_…` practice reference. It is explicitly not a transaction ID, not a broadcast, and not real Zcash settlement. The budget now records 0.05 ZEC spent.”

**1:30–1:45 — Show merchant acknowledgment.**

“The merchant enters the payment ID and checks the receipt. The panel says `Method: mock — simulated, no chain read.` The merchant acknowledgment is a statement from this simulated service, not independent blockchain settlement evidence.”

**1:45–2:00 — Show the business outcome.**

“The activity view keeps both outcomes: the blocked 0.20 ZEC request and the simulated 0.05 ZEC completion. Back on the overview, the agent has 0.95 ZEC remaining. That is VeilPay’s value: an AI agent can request an approved business purchase, while backend policy prevents it from exceeding delegated authority.”

## Presenter guardrails

- Say “simulated complete,” never “paid on Zcash,” for this run.
- Say “merchant statement,” never “proof of settlement,” for the acknowledgment.
- Do not use the privacy screen to claim that this mock execution created a shielded on-chain payment.
- Do not show terminal output, cookies, DevTools, API response bodies, traces, or `test-results`.
