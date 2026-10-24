# Milestone 6.1 reconciliation

Performed in `/home/temitope/veilpay-integration` on `test/full-integration`. The partner frontend was inspected at `origin/feat/veilpay-frontend` `703c5a583c9525bbc439bcf1c7c2d96b9f53963b`; neither contributor branch was changed.

## Reconciled changes

Imported from the partner's Next development-stability work:

- HMR-stable API, agent-selection, handoff, and execution-key identities via `hmrSingleton`.
- Session-readiness gating for every session-scoped query, preventing cold-load reads before bootstrap establishes the cookie.
- Single-flight CSRF session lookup for concurrent state-changing requests.
- Typed handling of empty/non-JSON successful responses as a `502 INTERNAL` API failure instead of a raw `SyntaxError`.
- UTC-field time formatting, preventing locale-dependent hydration output.
- Component helper extraction so component modules have component-only exports, allowing Fast Refresh to preserve state.
- Regression coverage for these cases in `src/lib/dev-mode.test.tsx`.

Preserved local integration work:

- Agent selection/reselection across session reloads.
- Strict ZIP-321 testnet QR gate: fully decoded address, exact amount, testnet-only payload, and no mock or mainnet URI.
- OpenAPI/Zod contract checks and mock/testnet/mainnet distinctions.
- Merchant verification/acknowledgment, manual testnet execution safeguards, and all Milestone 6 mainnet read-only code and tests.

The UI continues to classify mainnet as unknown or broadcast-disabled. It has no endpoint for read-only observations, and therefore cannot present wallet-reported data as independent chain evidence. Mainnet signing, preparation, broadcast, and autonomous spending remain disabled.

## Results

| Check | Result |
| --- | --- |
| Frontend units | PASS: 174 tests; 11 opt-in HTTP tests skipped in the ordinary unit command. |
| Actual Axum HTTP integration | PASS: 10 tests; 1 skipped; disposable mock-only loopback server stopped by runner. |
| Rust format and Clippy | PASS: `cargo fmt --check`; `cargo clippy -- -D warnings`. |
| Rust tests | PASS: 57 tests (40 Milestone 1, 14 Milestone 3, 3 mainnet). |
| TypeScript | PASS before the final browser-run attempt. |
| ESLint | PASS before the final browser-run attempt. |
| Production Webpack build | FAIL/BLOCKED: two attempts, including `timeout 180s`, stopped after `Creating an optimized production build ...`; no exit status or compiler diagnostic was emitted. The sandbox variant previously failed at Next `tsc --showConfig`. No test or diagnostic was weakened. |
| Production Chromium desktop/mobile | NOT RUN: production server depends on the blocked build. |
| Development Turbopack Chromium | NOT RUN: approved runner invocation ended before server readiness and emitted no result artifact. No pass is claimed. |

## Mainnet blockers

The mainnet interface remains read-only and adapter-injected only. A real controlled payment still needs a machine-verifiable viewing-only source, independent chain evidence, full ZIP-316 decoding at the backend boundary, production authentication/key custody, fee and transaction decoding, explicit operator signing approval, durable broadcast reconciliation, and a mainnet merchant watcher. See [MAINNET_READINESS.md](MAINNET_READINESS.md).

## Recommended GitHub integration

Create a PR from this integration worktree after reproducing the build and browser environment outside this execution wrapper. Keep the partner branch unmodified; present the reconciliation as a new commit containing the selected Fast Refresh/session/JSON changes plus the preserved local ZIP-321 and mainnet boundary work. The production build and both Chromium checks should be required before merging. No commit, push, merge, deployment, wallet access, signing, preparation, or broadcast occurred here.
