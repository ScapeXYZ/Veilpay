# VeilPay — ZECATHON Submission

## Project overview

VeilPay is an API-backed control layer for businesses that let AI agents initiate ZEC payments. It separates an agent's ability to request a payment from the business owner's authority to approve spending rules. In the demonstrated configuration, VeilPay runs a Next.js application against a Rust/Axum API and SQLite in local `regtest`/mock mode.

The submission demonstrates a concrete operational question: **how can a business allow an AI agent to pay an approved vendor without allowing that agent to overspend?** The answer shown here is server-enforced policy, durable budget accounting, a merchant-side receipt workflow, and a UI that makes the evidence boundary visible.

## Problem

Autonomous agents can purchase software, data, cloud resources, and other business inputs, but an unrestricted wallet gives an agent more authority than most businesses should delegate. A business needs to express constraints such as a total budget, a maximum payment, and approved merchants; the agent needs a straightforward way to request a purchase; and finance or the merchant needs an auditable result.

Existing payment interfaces often blur request, approval, execution, and proof. That is particularly risky when a system is presented as private or blockchain-backed without actually verifying a settlement.

## Solution

VeilPay makes the payment lifecycle explicit:

1. A merchant creates an invoice.
2. A customer-side agent requests payment for that invoice.
3. Axum evaluates the request against the current server-side policy and either rejects it or reserves budget.
4. Execution rechecks the policy. In the submission's mock mode, execution is an explicitly labelled simulation; it never uses a wallet, broadcasts, or creates a transaction.
5. The merchant looks up the payment, receives a mock receipt result, and can record a merchant acknowledgment.
6. The owner sees the resulting spent, reserved, and remaining budget plus an activity trail.

## Value for businesses using AI agents

VeilPay converts broad wallet access into bounded, reviewable authority:

- **Delegation without a blank cheque.** A business sets a total budget, per-payment cap, permitted merchant IDs, and request expiry. The agent can ask; it cannot override those rules through the frontend.
- **Predictable budget control.** An approved request reserves funds before execution, preventing multiple pending requests from silently exceeding the budget. Rejected requests reserve nothing. A completed mock payment moves its amount from reserved to spent.
- **Policy remains live.** The backend evaluates a request and evaluates it again immediately before execution, so a paused agent, changed cap, exhausted budget, disallowed merchant, expired request, or changed invoice is not treated as safe merely because it was approved earlier.
- **Useful separation of duties.** Merchant work is a merchant-context workflow; customer payments are customer-context workflow. The merchant acknowledges a receipt result rather than receiving the customer's wallet material.
- **Audit-oriented UX.** Policy decisions include violation codes and an audit hash; payment records contain a status timeline; idempotency and single-operation handling reduce accidental duplicate execution.
- **Honest payment state.** The product distinguishes an internal simulation from a blockchain transaction or settlement proof. This is important for business controls: a green state only means what its backing evidence supports.

## Technical architecture

```text
Next.js browser UI
  |  same-origin /api requests, first-party session cookie
  v
Next.js rewrite/proxy (live mode)
  v
Rust Axum API + SQLite
  |- customer policy and budget reservation
  |- payment/invoice records, timelines, idempotency snapshots
  |- merchant verification and acknowledgment workflow
  `- wallet boundary: mock simulation for this demo
```

The browser's live client calls same-origin `/api/*`; when configured, Next.js proxies those calls to Axum. The client keeps the CSRF token in memory, includes credentials, and validates API responses against the frontend schema. The backend persists records and idempotency snapshots in SQLite.

Write requests require the configured `Origin`, a session-bound CSRF token, and—except for demo-session bootstrap—an 8–128 character idempotency key for `POST` requests. The demo sessions distinguish `customer_demo` and `mer_demo`; they are role isolation for a demonstration, not production identity or authorization.

## Main implemented features

- Agent creation and editable policy: total budget, per-transaction cap, allowlisted merchants, and request TTL.
- Server-side decisioning with `CAP_EXCEEDED`, `BUDGET_EXCEEDED`, `MERCHANT_NOT_ALLOWED`, `AGENT_PAUSED`, `AMOUNT_MISMATCH`, invoice-payability, and request-expiry checks.
- Reservation accounting: `spent + reserved` is checked against the total budget; successful mock execution moves the exact principal from reserved to spent.
- Idempotent creates and execution, plus one operation per payment. A repeat execute returns the extant operation state rather than performing another send.
- Merchant invoices, customer payment requests, merchant payment lookup, verification state, acknowledgment, activity, and budget views.
- Explicit mock-source labelling: mock invoice payloads are non-spendable `veilpay-mock:` values; the displayed `mock_…` reference is labelled as practice-only and not a transaction ID.
- A real-testnet-oriented, manual operator path is present in the backend but is **not** the hackathon demo's evidence. It is testnet-only, stages operations through HTTP, and requires separate terminal confirmation for preparation and submission.

## What the demonstrated frontend actually does

The final walkthrough uses the live frontend and the local Axum backend, not intercepted API routes or frontend fixtures. The browser test provisions a fresh SQLite database and starts Axum with `NETWORK=regtest` and `WALLET_BACKEND=mock`.

| User action | Browser/API interaction | Backend outcome in the demo |
| --- | --- | --- |
| Create demo agent | `POST /api/agents` | Persists the 1.00 ZEC total budget and 0.10 ZEC per-payment cap. |
| Merchant creates an invoice | `POST /api/merchant/invoices` | Creates an open merchant invoice with a non-spendable mock payload. |
| Agent requests a payment | `POST /api/payments/request` | Evaluates policy and either persists a rejected decision or reserves the amount. |
| Agent executes an allowed request | `POST /api/payments/{id}/execute` | Rechecks policy; in mock mode writes simulated submitted/confirming/confirmed events, one simulated confirmation, and a `mock_…` reference. No chain is queried or changed. |
| Merchant checks receipt | `GET /api/payments/{id}/verification` | Returns `method: mock`; receipt state is derived from the simulated record, not a chain read. |
| Merchant acknowledges | `POST /api/payments/{id}/acknowledgment` | Creates a server-authenticated mock merchant statement only after the simulated receipt is eligible. |

## Merchant workflow and acknowledgment boundary

The merchant signs into merchant context, creates an invoice, and later enters/selects a payment ID to inspect its receipt state. In mock mode, the receipt panel says `Method: mock — Simulated, no chain read. Not evidence of anything.` An acknowledgment is then a server-authenticated merchant statement whose mock statement type explicitly says it is not a settlement proof.

The backend also contains a separate testnet-only design for an Orchard receiver and independent merchant-wallet scan. That path requires a synchronized merchant wallet and checks receiver, exact amount, expected transaction ID, network, and three confirmations. Its acknowledgment is still a merchant statement, not publicly verifiable cryptographic settlement evidence. No live wallet operation was performed to support this submission.

## Privacy claims and boundaries

This submission does **not** claim shielded blockchain settlement. The showcased run is mock-only: it has no Zcash wallet, no broadcast, no on-chain transaction, no chain scan, and no cryptographic proof of settlement. Therefore it does not demonstrate that a particular amount, sender, receiver, or memo was shielded on-chain.

The UI's privacy lens is informational output from the backend for a payment; it is not an independent network check. For the implemented testnet-only design, the repository describes Orchard-only receiving and merchant-wallet matching, but that capability was tested with synthetic CLI JSON/fixtures rather than a funded real-world settlement. Any presentation should say “designed/tested for the manual testnet path,” not “demonstrated live” or “settled privately.”

## Known limitations

- The submission walkthrough is a local regtest/mock simulation only. No funds move.
- Demo sessions use fixed demo principals; they are not production authentication, authorization, tenancy, or custody.
- Mock confirmation and mock merchant receipt are internal simulation states, not independent blockchain evidence.
- The merchant's live-contract discovery/list of incoming payments is not implemented; the UI requires a payment ID for lookup.
- Mainnet spending is disabled. The included real wallet path is testnet-only and requires a local operator; HTTP cannot sign or submit that path directly.
- The testnet path has no production custody model, automatic funding/spending, mainnet transport, broad pool support, or cryptographic settlement proof. Its documented wallet/indexer trust and reorg limitations remain.
- No real wallet operation, funded testnet settlement, or mainnet settlement was performed for this submission.

## Verification basis

The deterministic browser walkthrough in `tests/browser/demo.spec.ts` exercises the live loopback Axum/Next integration: 1.00 ZEC budget, 0.10 ZEC cap, rejected 0.20 ZEC request, simulated 0.05 ZEC completion, merchant acknowledgment, activity entries, and 0.95 ZEC remaining. `docs/HACKATHON_DEMO.md` documents the isolated runner and the same mock boundary. Backend unit/integration tests cover policy, idempotency, execution, and merchant-verification behavior.

Run the exact walkthrough with:

```bash
npm run demo:walkthrough
```
