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

## Archived transport research — not included in this submission

Earlier `zingo-cli` and manual-operator experiments remain in the repository as
research records only. They are **not enabled, exposed, or validated as part of
this Testnet submission**. In particular, do not infer from those records that
VeilPay can issue a payable invoice, sign a transaction, broadcast, confirm a
payment, or independently verify shielded settlement.

The current release uses only `WALLET_BACKEND=zingo`, which reports
`wallet: broadcast_disabled` and `mode: disabled` from `/api/health`. The live
merchant invoice endpoint intentionally fails closed because browser-based Noir
Wallet does not provide a server-verifiable proof of shielded-address control.
The archived research is retained for engineering context; its old routes,
operator flows, and transport claims are not release documentation. See
[merchant receiving architecture](docs/merchant-receiving-architecture.md) for
the current decision and [release readiness](docs/RELEASE_READINESS.md) for the
deployment boundary.

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
