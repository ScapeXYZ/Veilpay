# Milestone 4 integration

Worktree: `test/full-integration`. Backend base: `0d15902`; frontend source: `08d3293`.
Frontend source/configuration was extracted without importing the frontend branch's older backend, migrations, OpenAPI, or wallet installation scripts. No commit, merge, push, or deployment was performed.

## Changes

- Imported the Next.js frontend and dependency lockfile.
- Reconciled Zod responses with OpenAPI 1.2: manual wallet health, operator confirmation and phases, fee, invoice payload variants, verification observations/states, acknowledgment evidence/invalidation, and verification-unavailable errors.
- Extended contract drift checks to inspect invoice payload union branches.
- Preserved fail-closed mock QR checks: mock invoices never produce wallet URIs or QR codes. Unified/Orchard invoice QR rendering remains unsupported and fails closed; parsing its backend payload does not make it a supported frontend receiving address.
- Added customer agent creation/selection because fresh backend sessions have no default agent. Selection stays in memory and existing agents can be selected again by ID after reload. Policy and request forms use that selection; server policy remains authoritative.
- Added operator/prepared-state presentation, independent merchant wallet scan copy, acknowledgment invalidation handling, and invalid-JSON error handling.
- Added `BIND_ADDR`, defaulting Axum to `127.0.0.1:4000`.
- Added `.env.example` for the same-origin Next proxy and an isolated `npm run test:http` runner.
- Selected Webpack for `npm run build`: Turbopack's CSS worker failed to bind a local port in this environment, including the escalated attempt. Webpack production compilation, TypeScript, static generation and traces succeeded.

## Validation

- `cargo fmt --check --manifest-path backend/Cargo.toml`: passed.
- `cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings`: passed.
- `cargo test --manifest-path backend/Cargo.toml`: 54 passed (40 milestone 1/lifecycle and 14 milestone 3 tests).
- `npm run typecheck` and `npm run lint`: passed.
- `npm test`: 109 unit/component/contract tests; HTTP tests are intentionally opt-in in the ordinary unit run.
- `npm run build`: passed with Webpack.
- `npm run test:http`: 10 passed against actual Rust Axum over TCP. No stand-in server was started.

HTTP coverage includes cookie attributes/session restore, CSRF rejection, invoice creation/list/detail, exact idempotent replays and changed-payload conflict, role isolation/404, versioned policy update/conflict, pause rejection, concurrent payment execution replay, pre-execution verification/acknowledgment rejection, mock receipt verification, signed mock acknowledgment replay/uniqueness, and operator/pending/prepared UI states.

Operator/pending/prepared records are deliberately seeded database observations, read through real HTTP and rendered with the live client. They test serialization and UI behavior; they do not claim to reproduce a real wallet lifecycle. Mock execution itself completes atomically and cannot naturally produce these external-wallet states.

## Repeat safely

Install dependencies with `npm ci`, then run `npm run test:http`. It builds Axum, chooses a loopback port, creates a new temporary SQLite database, explicitly uses `NETWORK=regtest` and `WALLET_BACKEND=mock` in a minimal backend environment, runs the live-client suite, stops Axum, and removes its database. It never invokes the operator binary. The external HTTP suite refuses execution unless health reports a loopback mock backend on a test network.

For interactive local use, run Axum with an explicitly disposable `DATABASE_URL`, `WALLET_BACKEND=mock`, `NETWORK=regtest`, and `FRONTEND_ORIGIN=http://127.0.0.1:3100`. Run Next with `NEXT_PUBLIC_API_MODE=live VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api npm run dev`. The Rust process does not automatically load `.env.example`. Create a merchant invoice, switch to customer, create/select an agent, and enter the invoice ID for a mock payment. Browser cookie behavior and the Next proxy should receive a manual browser smoke test; the HTTP harness uses an in-memory cookie transport and does not emulate browser Secure-cookie enforcement.

## Remaining work

No failing required checks remain with the Webpack build. Turbopack remains an environment-specific failure. No public deployment or real wallet validation was attempted. No real wallet files, signatures, broadcasts, or network transactions were used. Backend wallet tests use synthetic adapters/process fixtures.

Recommended follow-ups: review the uncommitted worktree, perform the browser smoke test above, and add fully validated Unified Address QR support separately while retaining all mock exclusions. Real-wallet operator lifecycle validation is outside this mock-only milestone run. The backend reports no independent chain watcher; wallet observations must not be presented as independent chain-safety guarantees.
