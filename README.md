# VeilPay backend

Rust Axum API with SQLite persistence. Default execution, receiving addresses,
verification, and signed acknowledgments are simulations. An acknowledgment is a
signed merchant statement, never a cryptographic settlement proof.

Run locally:

```bash
NETWORK=testnet DATABASE_URL=sqlite://veilpay.db FRONTEND_ORIGIN=http://localhost:3000 cargo run --locked --manifest-path backend/Cargo.toml
```

The frontend origin must match exactly. Demo sessions use a Secure, HttpOnly,
SameSite=Strict cookie and require Origin plus a session-bound CSRF token for writes.
Use an HTTPS browser environment that supports Secure cookies. All demo merchant
sessions share `mer_demo`; all customer sessions share `customer_demo`. These are
role demos, not production tenant authentication. Mainnet demo login is disabled.

## Invoice milestone

- `POST /api/merchant/invoices`: merchant context, CSRF, and an 8–128 byte
  `Idempotency-Key` required. Accepts `reference` (1–64 characters, not blank),
  `amountZat` (canonical decimal integer string, 1–2100000000000000), and optional
  future RFC3339 `expiresAt` (defaults to 24 hours). Invalid inputs return 400.
  Returns 201 with a unique opaque ID, unique mock receiver, and QR-ready
  `paymentPayload` using `veilpay-mock:{id}?amountZat={amount}`. This is explicitly
  non-spendable, not a ZIP-321 Zcash request. No floating point amounts are used.
- `GET /api/merchant/invoices`: returns only the current merchant's records.
  Refreshes expired open invoices and persists their status.
- `GET /api/merchant/invoices/{id}`: returns an owned invoice, refreshing expiry;
  missing or foreign-owned records return 404. Customer context returns 403.

Creation and the saved idempotency response commit in one SQLite `BEGIN IMMEDIATE`
transaction. Concurrent retries return the original bytes with
`Idempotent-Replay: true`; changing the payload under the same key returns 409.
Invoice reads reflect current expiry; replaying creation preserves its original
snapshot. Existing records without expiry or payment payload remain readable.
API JSON responses carry `Cache-Control: no-store`.

See [OpenAPI](contracts/openapi.yaml) for existing session, agent settings, policy,
payment request, execution, verification, acknowledgment, and timeline contracts.
There is no frontend source in this checkout; no frontend files were changed.
Some OpenAPI descriptions specify intended real-wallet behavior beyond the current
mock implementation. Health reports mock mode; do not interpret it as chain readiness.

## Review and checks

```bash
git diff --check
git diff -- backend/src/lib.rs backend/tests/milestone1.rs contracts/openapi.yaml README.md
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --locked --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --locked --manifest-path backend/Cargo.toml
```

`cargo audit` and `cargo deny` are not installed in the current environment;
dependency advisory/license auditing remains outstanding. Authorization, CSRF,
role isolation, durable replay, and concurrency regressions are covered by tests.

Remaining after the invoice milestone (see Milestone 2 below): durable external execution and ambiguous failure recovery;
network-separated wallet adapters with mainnet broadcasting disabled; independent
merchant wallet observations, confirmations, invoice matching, and acknowledgment
semantics; frontend contract reconciliation. Real-wallet receiving-address
allocation is required before invoices can carry spendable payment requests.
No wallet scripts need to be run for this milestone. Do not run provisioning or
funding commands as part of review. Existing integration details are in
[the testnet notes](docs/REAL_TESTNET.md).

## Milestone 2: durable execution and disabled Zingo adapter

`WALLET_BACKEND=mock` remains the testnet/regtest default and preserves all invoice
APIs and atomic simulated execution. `WALLET_BACKEND=zingo` selects the typed,
network-separated Zingo boundary. Mainnet defaults to Zingo and refuses mock mode.
There is no broadcast-enabling setting: both Zingo networks refuse submission and
mainnet also has an unconditional application-level dispatch block. The adapter
contains no subprocess, wallet opening, recovery-data access, or send transport.
Its typed network binding does not claim chain connectivity. Existing wallet
scripts are unchanged and were not executed.

The external execution path commits a unique operation, exact amount, destination,
network, reservation, and idempotent 202 snapshot before adapter dispatch. A second
commit claims dispatch by marking the operation unknown. Cancellation/crashes
across either checkpoint never cause an automatic send on restart. Duplicate
payments cannot claim the same unresolved/successful invoice. Only a conclusive
pre-creation broadcast refusal or typed wallet rejection releases the reservation; unknown outcomes hold it.
Sender observations need a valid, matching txid before confirmation can consume
the reservation. They do not mark the merchant invoice paid.

The server reconciles on startup and every 60 seconds using observation only,
with 30-second adapter deadlines. Unknown operations older than two hours expose
`needsOperator: true`. No reconciliation route accepts client-provided evidence.
The current Zingo observer returns unknown because independent wallet history
transport is not implemented. Live wallet transport, fee/address validation for
spendable sends, independent merchant verification, and reorg handling remain
blocked integration work; this milestone must not be described as live payment
support or cryptographic settlement proof.

Changed API behavior (no new HTTP routes):

- `GET /api/health`: adds `mode: disabled`, `wallet: broadcast_disabled`, and
  `walletBackend: zingo` for the disabled adapter; reports persisted unresolved
  operation counts and the latest processed observation timestamp.
- `POST /api/payments/request`: rejects an invoice already claimed by an external
  operation through the existing `INVOICE_NOT_PAYABLE` policy violation. Zingo
  requests carry no mock reference and use a neutral policy timeline message.
- `POST /api/payments/{id}/execute`: durable external lifecycle with an immutable
  202 snapshot. Replay can show pending even after the operation changes; poll
  the existing payment detail route. A disabled broadcast yields a current
  payment with `failed`, `failed_definitive`, and `WALLET_BROADCAST_DISABLED`.
- `GET /api/payments` and `GET /api/payments/{id}`: expose current durable operation,
  failure, reservation-related state, and timeline through the existing fields.
- `GET /api/payments/{id}/verification` and
  `POST /api/payments/{id}/acknowledgment`: non-mock operations fail closed with
  409 `VERIFICATION_UNAVAILABLE`; mock semantics are unchanged.

Migration `0003_wallet_lifecycle.sql` retains legacy mock operations and adds
constraints for network, amount, state, one attempt per payment, and one active
external operation per invoice. A database binds to one network on first upgraded
open; use different SQLite files for testnet and mainnet. Do not change the network
of an existing deployment database. Legacy mock rows retain `legacy_mock` metadata.
