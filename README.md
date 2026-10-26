# VeilPay

VeilPay is a policy-control layer for payment agents: the agent can be given a
budget, a per-payment cap, approved merchant identifiers, an expiry, and a
revocable status without receiving wallet keys. This submission is a **Zcash
Testnet, browser-observed, broadcast-disabled** build. Noir Wallet reports its
own addresses, balances, and activity directly to the browser; VeilPay does not
receive them.

The live Testnet workflow is intentionally limited to authenticated VeilPay
workspaces, user-owned agent records, server-enforced rules, session revocation,
and read-only wallet observation. A policy decision is not wallet authorization,
payment execution, or settlement. Merchant invoice creation remains unavailable
until shielded receiving-address ownership can be verified safely. There are no
live placeholder invoices, transactions, receipts, or settlement claims.

Read [feature status](docs/TESTNET_FEATURE_STATUS.md), the
[merchant receiving decision](docs/merchant-receiving-architecture.md), and the
[privacy threat model](docs/PRIVACY_THREAT_MODEL.md) before running a demo.

```bash
NETWORK=testnet WALLET_BACKEND=zingo BIND_ADDR=127.0.0.1:4100 FRONTEND_ORIGIN=http://localhost:3200 DATABASE_URL=sqlite:///private/path/veilpay-testnet.db cargo run --locked --manifest-path backend/Cargo.toml
```

Demo sessions are isolated test fixtures, not live identity. Live Testnet
accounts are separate from wallet connection and own only their account-scoped
records. Writes require Origin and session-bound CSRF. POSTs also require an
8–128 byte idempotency key, except fixture bootstrap. Sessions expire after
eight hours and `DELETE /api/session` revokes the current token server-side.
Production cookies are Secure, HttpOnly, and SameSite=Strict; the loopback-only
Testnet inspection origin uses the documented development exception.

## Milestone 3

`WALLET_BACKEND=zingo-cli` selects the real **testnet-only** process transport.
It requires the existing independent customer/merchant wallets, explicit
`VEILPAY_WALLET_ROOT`, and a private absolute SQLite path outside the repository.
The transport checks the source revision, both source patch checksums, binary
checksums, existing wallet metadata, and a shared nonblocking wallet lock. It
never reads recovery metadata or exports keys. Child environments omit seed/key
variables; raw stderr is discarded and CLI logs stay under the private root.
Missing wallets are refused, never created. The backend itself parses no wallet
file; only the pinned CLI opens existing wallet files.

Verified against source revision `6d43e7c48343cc39cf99bad7e05349baaf4f0b90`:

- `new_address o`: new Orchard-only testnet receiver for an invoice.
- `balance`: exact zatoshi balance, structured by the supplied patch.
- `--server ... --waitsync info` and `transactions`: network check, complete
  synchronization, and structured wallet observations.
- Offline `send ADDRESS ZAT`: proposal and fee; **does not broadcast**.
- Offline `calculate` in the same process: prepares/signs one transaction.
- `transmit TXID`: transmits only the explicitly approved prepared transaction.
  Bare `transmit`, `confirm`, and `quicksend` are never used by the transport.
  Before approval, the persisted signed transaction is inspected offline: unknown
  fees, extra external recipients (including donations), or unsupported pools are refused.

HTTP execution only stages a durable operation. The separate `veilpay-testnet`
operator binary requires a terminal and distinct exact confirmations before
preparation and submission. The fee is checked against an operator-approved
ceiling before signing; submission displays the actual fee. Policy budgets
continue to track transferred principal; network fees are separately approved.

One operation per payment and one unresolved/successful external operation per
invoice remain enforced. Manual phases and signed txids are durable before
submission. Unknown outcomes retain reservations; restart/reconciliation never
resends or repeats preparation. Current policy, pause, and expiry are rechecked
before both manual actions. A policy rejection after staging keeps the reservation
held for operator review. A preparation failure also remains unknown conservatively.

Merchant verification independently syncs the merchant wallet and matches its
Orchard receiver, exact amount, txid, network, and three-confirmation depth.
Repeated identical outputs are deduplicated. Underpayment, overpayment, duplicate
transactions, conflicts, incomplete scans, and reorg-related observations prevent
acknowledgment. Sender confirmation alone never marks an invoice paid. Final manual
sender operations are rechecked; lost depth moves spent principal back into a
reservation. Merchant receipt loss reopens/expires invoices and marks historical
acknowledgments invalid for current reliance. Signatures and idempotency snapshots
remain historical records. A recovered receipt does not revive an invalidated
acknowledgment.

## Historical manual-transport research

The following manual `zingo-cli` material is research infrastructure, not the
current submission flow and not evidence of a live merchant product. It must
not be presented as wallet ownership verification or independent settlement for
an authenticated merchant. The current live Testnet configuration uses the
broadcast-disabled `zingo` adapter.

## Historical API notes

No new HTTP routes; mock invoice APIs and behavior are preserved.

- `POST /api/merchant/invoices`: real mode obtains a fresh merchant Orchard
  receiver and returns `network: testnet` with a spendable ZIP-321 payload such as
  `zcash:utest1...?amount=0.00100000`. Mock payloads remain `veilpay-mock:` with
  `spendable: false`. Amounts remain canonical positive zatoshi strings; expiry
  defaults to 24 hours. Address generation failure returns 503 without a fake receiver.
- `GET /api/merchant/invoices` and `GET /api/merchant/invoices/{id}`: existing
  merchant-scoped reads include real payloads and independently verified paid,
  paid_late, reopened, or expired state.
- `POST /api/payments/request`: existing policies and principal reservations.
- `POST /api/payments/{id}/execute`: real mode stages pending with
  `requiresOperatorConfirmation: true`; no signing or submission occurs via HTTP.
  Same-key responses replay the original snapshot; poll payment detail for changes.
- `GET /api/payments` and `GET /api/payments/{id}`: manual phase, actual txid,
  approved fee, confirmation changes, unknown outcomes, and verification timeline.
  A prepared txid alone does not establish broadcast or chain inclusion.
- `GET /api/payments/{id}/verification`: independent `merchant_wallet_scan`;
  adds underpaid, duplicate, conflicting, and reorged states and observation heights.
  `acknowledgmentEligible` describes receipt eligibility;
  `acknowledgmentValid` describes current reliance on an existing statement.
- `POST /api/payments/{id}/acknowledgment`: requires a fresh independent receipt;
  real HMAC statement binds invoice, network, txid, amount, depth, and time. It is
  server-authenticated, not publicly verifiable settlement evidence. Returns 503
  on a failed scan and 409 when receipt conditions are not met.
- `GET /api/health`: real transport reports `testnet_manual`, `zingo-cli`, and
  `operator_required`, with depth 3. Configuration status does not establish live
  connectivity. Legacy mock/disabled adapter health remains compatible.

See [OpenAPI](contracts/openapi.yaml) and the exact operator instructions in
[Milestone 3 testnet guide](docs/MILESTONE3_TESTNET.md).

## Validation and unsupported capabilities

```bash
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo clippy --locked --manifest-path backend/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --locked --manifest-path backend/Cargo.toml
bash -n scripts/install-testnet-wallet.sh
git diff --check
```

Tests use synthetic CLI JSON and a synthetic executable with a dummy wallet marker;
they require no funds, secrets, installed Zingo, or network. The source patch was
also compile-checked against the downloaded public pinned source without running
a wallet. No real wallet operation was performed during implementation.

Unsupported: mainnet transport; production authentication/custody; automatic
funding or spending; TEX/multistep proposals; Sapling/transparent/mixed-receiver
invoice matching; proving settlement cryptographically; independent header-chain
validation or block-hash reorg proofs; automatic resending, recalculation, or
releasing ambiguous transactions. Reorg handling follows changes reported by the
synchronized wallet; upstream sync and its indexer remain trusted. Large histories
are bounded to 8 MiB and fail closed. The 180-second CLI deadline may be insufficient
for a cold sync; synchronize manually first. Wallet calls take a shared lock and
verification currently holds a SQLite write transaction, limiting concurrency.
`cargo-audit` and `cargo-deny` are unavailable, so dependency auditing remains open.

Migrations preserve earlier operations, bind databases to a network, and add
manual phases, fees, and unique real receiving addresses. Older mock invoices
remain readable. The earlier disabled `WALLET_BACKEND=zingo` mode remains available.
