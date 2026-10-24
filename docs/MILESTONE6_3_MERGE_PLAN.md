# Milestone 6.3: GitHub integration preparation

Date: 2026-10-24
Worktree reviewed: `/home/temitope/veilpay-integration` on `test/full-integration`
Backend comparison point: `0d15902`
Partner frontend comparison point: `origin/feat/veilpay-frontend` `703c5a5`

No file was staged, committed, pushed, merged, deployed, or used to access a wallet during this review.

## Review conclusion

The integration is technically validated, but it is **not ready to stage as one bulk change**. The source changes and the current frontend fixes are preservable, while generated browser evidence must be excluded and the new mainnet read-only HTTP route needs OpenAPI review before the read-only backend commit can merge.

The validated baseline is recorded in [MILESTONE6_1_RECONCILIATION.md](MILESTONE6_1_RECONCILIATION.md), [MILESTONE6_2_BUILD_RECOVERY.md](MILESTONE6_2_BUILD_RECOVERY.md), and [MAINNET_READINESS.md](MAINNET_READINESS.md): Webpack production build passed; production Chromium desktop/mobile passed 12/12 each; development Turbopack passed 13/13; frontend tests passed 174 with 11 opt-in skips; actual Axum HTTP tests passed 10 with 1 skip; and Rust tests passed 57.

## Change inventory

Against backend `0d15902`, Git reports six tracked modifications: `.gitignore`, `backend/src/lib.rs`, `backend/src/main.rs`, `backend/src/wallet.rs`, `backend/src/zcash.rs`, and `backend/tests/milestone1.rs` (142 insertions and 18 deletions). The integrated frontend, frontend tests/configuration, browser/HTTP runners, reports, and `backend/tests/mainnet.rs` are untracked because the backend base does not contain the frontend tree.

### Backend and mainnet-read-only changes

- `backend/src/lib.rs`, `backend/src/wallet.rs`, and `backend/src/zcash.rs`: network-aware parsing and read-only snapshot boundary; mainnet mock mode is refused; the read-only endpoint is token-gated and fail-closed.
- `backend/src/main.rs`: loopback default bind with explicit `BIND_ADDR` override.
- `backend/tests/milestone1.rs` and `backend/tests/mainnet.rs`: mainnet isolation, authentication, stale/malformed snapshot, and existing safety regression coverage.
- `docs/MAINNET_READINESS.md`: implementation/audit record.

### Frontend and partner reconciliation changes

The partner tree has 36 byte-identical shared frontend/configuration files in this worktree. Its development-regression test `src/lib/dev-mode.test.tsx` is byte-identical. The remaining shared files intentionally differ where local integration safety and UI work was reconciled with the partner fixes.

The latest fixes remain present and exercised:

- `hmrSingleton` keeps API/selection/handoff identities stable through Fast Refresh.
- Session-scoped reads wait for successful bootstrap; CSRF lookup is single-flight.
- Empty, malformed, or schema-invalid backend responses become typed `ApiError`s rather than browser `SyntaxError`s.
- UTC date formatting prevents hydration variation.
- Component-only module boundaries permit Fast Refresh.
- Local additions preserve agent reselection, ZIP-321 testnet-only QR handling, mock/testnet/mainnet labels, merchant verification/acknowledgment, and strict browser checks.

`src/lib/demo-steps.ts` exists in the partner branch but is intentionally absent locally; the integrated UI uses its own `demo-guide` flow and has no import of that path. This is not a broken reference.

### Shared integration, test, and documentation changes

- Frontend root files: `package.json`, lockfile, Next/ESLint/PostCSS/TypeScript/Vitest configuration, `.env.example`, and `src/**`.
- Test runners: `scripts/test-http-integration.py` and `scripts/test-browser-integration.py`.
- Shared contract tests and frontend HTTP integration tests under `src/lib/contract/**` and `src/lib/api/**`.
- Reconciliation and test records in `docs/MILESTONE4_INTEGRATION.md`, `docs/MILESTONE5_BROWSER.md`, `docs/MILESTONE5_RECONCILIATION.md`, `docs/MILESTONE6_1_RECONCILIATION.md`, and `docs/MILESTONE6_2_BUILD_RECOVERY.md`.

## Sensitive and generated-content audit

### Clear to review as source

`.env.example` contains only loopback mock/regtest defaults; it contains no credential. No `.env`, wallet file, database, seed phrase, private key, PEM, or wallet secret was found in the repository. `node_modules` (792 MiB), `.next` (299 MiB), Rust `target`, SQLite sidecar files, and local test databases are ignored.

The current ignore rules also exclude `.local/`, Playwright trace ZIP files, and `private/` browser response directories. The private response directories exist locally but are ignored and must remain untracked.

### Do not stage

`docs/images/` currently occupies approximately **1.1 GiB**, including **222 PNGs**, **80 logs**, and **33 JSON files**. This is repeated browser evidence from Milestones 5–6.3, not reviewable source. Sample `results.json` files contain `__Host-veilpay_session` metadata (name/domain/expiry/flags) but no cookie-value key or value. That reduces immediate exposure, but the files are still generated session-adjacent artifacts and should not be added to a source PR.

`.gitignore` does not currently exclude browser screenshots, ordinary `results.json`, or normal browser/build logs. Keep all of them out through a staging allowlist now; before a later cleanup commit, decide whether to ignore the whole browser artifact directory or establish a small, sanitized evidence directory. Do not broadly add the present artifact tree.

`AGENTS.md` is generated by `next dev` (its own content says it is re-added by Next). It is not product code. Keep it out of the functional commits; either accept it in a separate tooling-policy decision or ignore it after confirming repository policy.

## Read-only mainnet endpoint review

`GET /api/operator/mainnet/read-only` has the following positive properties:

- requires `X-VeilPay-Operator-Token`; only a SHA-256 digest is retained, and comparison is constant-time;
- returns 404 outside mainnet and 503 for missing adapters, adapter network mismatch, zero/mismatched heights, malformed histories, negative balances, or invalid/non-Orchard mainnet address data;
- has no HTTP-controlled adapter configuration and existing adapters return `Unsupported` for snapshots;
- exposes the address, balance, and transaction observations only to the authenticated operator;
- marks `chainEvidence.trusted` false and explicitly describes observations as wallet-reported rather than independent chain evidence;
- does not prepare, sign, submit, or broadcast a transaction.

The endpoint has these merge blockers or security follow-ups:

1. **OpenAPI drift:** `contracts/openapi.yaml` documents no `/operator/mainnet/read-only` path, header security requirement, or response/error schemas. The frontend contract test only checks component schemas, so it will not detect this missing path. Add and review the contract before staging the backend mainnet commit.
2. The token is process-environment supplied and its digest is unsalted. This is acceptable only as a narrow development/integration gate. Production needs secret-manager/HSM-backed operator authentication, rotation, authorization/audit logging, rate limiting, and deployment-bound transport controls.
3. The snapshot source is adapter-injected only. There is no production viewing-wallet adapter or independent pinned chain evidence. The address/balance/history claims must remain labelled wallet-reported.
4. The health endpoint intentionally leaves `chainHeight` null. The frontend correctly renders mainnet as unknown/disabled and must continue not to infer chain verification from health or a snapshot.

## Minimal staging plan

Do not use `git add .`, `git add -A`, or a directory-wide staging command. Use explicit paths only, after resolving the OpenAPI blocker.

1. **Commit 1 — frontend integration and regression coverage**
   - Add root frontend configuration and lockfile, `.env.example`, `src/**`, and both test runners.
   - Include the partner Fast Refresh/session/JSON fixes and local agent, ZIP-321, presentation, contract, mobile, verification, and browser-test work together because those layers are mutually tested.
   - Exclude `docs/images/**`, `.local/**`, `.next/**`, `node_modules/**`, `target/**`, and `AGENTS.md`.

2. **Commit 2 — backend mainnet read-only safety boundary**
   - First add the OpenAPI path, security scheme/header requirement, and reviewed schemas/tests for the operator endpoint.
   - Then add the six backend changes, `backend/tests/mainnet.rs`, any associated contract test, and `docs/MAINNET_READINESS.md`.
   - Keep this commit explicitly read-only. Its description must state that no real wallet adapter, signing, preparation, or broadcast is enabled.

3. **Commit 3 — shared integration documentation and test evidence summary**
   - Add the concise Markdown reconciliation/recovery documents, including this plan, after removing obsolete claims where necessary.
   - Do not add raw screenshots, Playwright traces, result JSON, logs, or temporary response bodies. Link CI artifacts from the PR instead.

4. **Optional separate tooling housekeeping commit**
   - Decide repository policy for Next-generated `AGENTS.md` and for a durable browser-artifact ignore policy. Do not mix that decision with payment, wallet, or frontend behavior.

## PR target and merge order

Target the repository's backend base branch containing `0d15902`; do not merge directly from or modify `origin/feat/veilpay-frontend`.

Open the frontend integration PR first, with its exact validated test matrix. Rebase/reconcile it against the target branch if it moves. Land the backend read-only PR only after its OpenAPI path is reviewed and after the frontend PR is present (or combine them only if GitHub requires an atomic contract change). Land the documentation/tooling PR last. Require the bounded Webpack build and strict desktop/mobile production Chromium checks in CI, using an environment that permits Next's local worker transport.

## Remaining security blockers

This work is suitable for code review and mock/testnet regression work only. It is not ready for a controlled mainnet ZEC payment until it has a full ZIP-316 decoder, dedicated non-spending mainnet viewing source, independently pinned chain evidence, production authentication and key custody, fee/transaction verification, explicit signing approval, durable single-broadcast reconciliation, merchant confirmation/reorg monitoring, and operational audit/alerting. Automatic mainnet spending remains disabled.
