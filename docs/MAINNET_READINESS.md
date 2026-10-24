# VeilPay mainnet readiness — Milestone 6

Validated on 2026-10-24 in `/home/temitope/veilpay-integration`, branch `test/full-integration`. This is a read-only foundation, not authority to use ZEC. No wallet directory, seed, UFVK, wallet file, funded wallet, transaction preparation, signature, or broadcast was accessed. All executed application processes used `WALLET_BACKEND=mock`; mainnet tests inject synthetic in-memory observations.

## What changed

`backend/src/zcash.rs` now parses network-specific structured wallet data. It accepts ZIP-316 mainnet Unified Address HRPs (`u1` and shielded-only revision-2 `zu1`) separately from testnet (`utest1`/`zutest1`), requires an Orchard-only receiver declaration, and rejects mismatched history networks, zero/stale scanned heights, malformed amounts, invalid txids, and inconsistent confirmations. The parser deliberately does not claim a textual prefix is a cryptographic Unified Address decoder; a deployed source must produce structured, receiver-validated data.

The wallet boundary now has a `ReadOnlySnapshot`: address, available balance, wallet sync height, reported chain height, and sanitized transaction observations. `App::mainnet_read_only_snapshot` accepts data only from a mainnet adapter when both heights are nonzero and equal and its parsed history has the same network/tip. It returns `503 WALLET_UNAVAILABLE` for stale, malformed, unsupported, or mismatched results. The protected `GET /api/operator/mainnet/read-only` endpoint requires `X-VeilPay-Operator-Token`; only its SHA-256 digest is retained in memory and no token or wallet secret is logged or returned. Observations are expressly labelled wallet-reported; `chainEvidence.trusted` is false until an independently pinned chain source exists.

No runtime adapter supplies a real mainnet snapshot yet. The existing `TestnetTransport` remains testnet-only and is intentionally not reused: it can prepare and transmit transactions. `ZingoWallet` stays inert and returns unsupported for reading. This prevents a configuration change from opening a wallet or causing a Zingo CLI default wallet to be created. The documented Zingo CLI defaults to mainnet and creates/uses a data-dir wallet, while Zingo's desktop application supports UFVK read-only wallets; neither is currently a safe machine-verifiable watcher boundary for this service ([Zingo CLI](https://github.com/zingolabs/zingolib), [Zingo PC](https://github.com/zingolabs/zingo-pc)).

## Audit

| Area | Current state | Gap/blocker |
| --- | --- | --- |
| Network isolation | `Network` is persisted in the database; a database cannot reopen on another network. Mainnet mock mode is rejected; demo login is disabled. | Regtest has no unified-address reader. |
| Address validation | Separate mainnet/testnet HRPs plus Orchard-only structured flags. ZIP-316 supports revision-0 and revision-2 unified encodings ([protocol docs](https://zcash.github.io/librustzcash/rustdoc/latest/zcash_protocol/address/enum.Revision.html)). | Integrate an official full ZIP-316 decoder before accepting arbitrary customer payment addresses. |
| Synchronization/balance/history | Snapshot interface supplies address, balance, height, and confirmation observations; stale/malformed data fails closed. | No production source and no independently verified full-node/indexer evidence. |
| Zingo transport | Pinned testnet CLI transport validates process provenance and structured output. | It is testnet-only and can sign in its manual workflow. Do not point it at mainnet. |
| Sign, fee, submit | Testnet manual path has fee ceiling and output inspection. Mainnet dispatch is hard-disabled before adapter submission. | No mainnet preparation, signing, fee quote, broadcast, or outcome reconciliation implementation. |
| Authentication/secrets | Demo sessions disabled on mainnet; operator read endpoint is token-gated and secret-free. | Replace demo principals with production agent/operator auth, secret manager/HSM, audit trail, rate limits, and key rotation. |
| Merchant settlement | Existing testnet merchant independent-wallet scan, confirmations, reorg invalidation, and acknowledgments are preserved. | Mainnet merchant watcher and independently trusted chain evidence are absent. |

## Intended controlled payment protocol

1. Authenticate the agent and validate its invoice/request.
2. Check exact recipient, amount, expiry, merchant allowlist, per-payment cap, daily cap, and total budget.
3. Reserve funds and budget in one durable transaction; the existing SQLite operation/idempotency logic supplies a starting point.
4. Require risk approval, prepare with an approved fee ceiling, then revalidate policy and decoded transaction outputs immediately before signing.
5. During initial rollout require a separate explicit operator approval for every signature and broadcast. Automatic mainnet execution remains disabled.
6. Persist a single execution claim before broadcast. Treat timeout/cancellation/ambiguous responses as `unknown`; reconcile them and never automatically resend.
7. Have the merchant's independent watcher verify recipient, amount, and required confirmations. Reorganizations invalidate acknowledgment reliance until reconfirmed.

Before the first controlled payment, add a dedicated mainnet UFVK-only watcher with a machine-verifiable no-spend capability, independently pinned full-node/indexer consensus evidence, full address decoding, durable daily-budget accounting, a transaction decoder/fee oracle, hardware or managed signing, operator approval UX, outbound egress controls, alerting, backup/recovery drills, and a testnet/mainnet rehearsal. Zingo notes its CLI releases are provisional and its lightwallet server can observe shielded-transaction block metadata, so both release provenance and privacy assumptions need operator review ([Zingo CLI](https://github.com/zingolabs/zingolib)).

## Tests and results

| Check | Result |
| --- | --- |
| Mainnet additions | PASS: 3 tests — network isolation, token-gated snapshot/trust label, stale/malformed failure. |
| Rust suite | PASS: 57 tests (40 Milestone 1, 14 Milestone 3, 3 mainnet), 0 failed. Covers budget exhaustion, duplicate/concurrent execution, fee ceiling, unknown outcomes, verification and reorg handling. |
| Rust format and Clippy | PASS: `cargo fmt --check`; `cargo clippy -- -D warnings`. |
| TypeScript | PASS. |
| ESLint | PASS. |
| Frontend units | PASS: 166 tests; 11 intentionally skipped opt-in HTTP cases. |
| Actual Axum HTTP | PASS: 10 tests; 1 skipped. The temporary loopback server was stopped by the runner. |
| Production Webpack build | BLOCKED in this run: external build invocation stopped after “Creating an optimized production build” without a completion status. The sandbox attempt previously failed at Next's `tsc --showConfig` parsing boundary; no source failure was emitted. Re-run in the established outside-sandbox browser/build environment. |

Milestone 5.3 production Chromium evidence remains 4/4 passing, 48 functional checks and 32 reloads. Its development HMR/hydration/session diagnostics remain an unresolved pre-existing development-tooling/application investigation; this milestone did not suppress or alter diagnostics. No browser server was started in this read-only backend change.

## Merge readiness

This is **not ready for a real-money mainnet payment**. It is suitable only as a code-reviewable read-only interface and security design. A production-only integration review may proceed after the production build is rerun successfully, but any claim of mainnet wallet readiness must wait for the blockers above. No commit, merge, push, deployment, contributor-branch modification, or live-wallet operation was performed.
