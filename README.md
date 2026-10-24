# VeilPay backend

Rust Axum API with SQLite persistence. Current execution, receiving addresses,
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

Remaining milestones: durable external execution and ambiguous failure recovery;
network-separated wallet adapters with mainnet broadcasting disabled; independent
merchant wallet observations, confirmations, invoice matching, and acknowledgment
semantics; frontend contract reconciliation. Real-wallet receiving-address
allocation is required before invoices can carry spendable payment requests.
No wallet scripts need to be run for this milestone. Do not run provisioning or
funding commands as part of review. Existing integration details are in
[the testnet notes](docs/REAL_TESTNET.md).
