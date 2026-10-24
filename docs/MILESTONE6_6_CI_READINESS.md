# Milestone 6.6: GitHub CI readiness

The repository previously had no GitHub Actions workflow. `.github/workflows/ci.yml` now runs only for pull requests targeting `main`, with `contents: read` permission and per-PR concurrency cancellation.

## Checks

- **Frontend and contract:** Node 22 with npm cache; `npm ci`, `node scripts/validate-openapi.mjs`, TypeScript, ESLint, and frontend tests.
- **Rust mock-only backend:** Cargo registry/git/target cache; `WALLET_BACKEND=mock`, format check, Clippy with denied warnings, and all backend tests.
- **Production build:** Node 22 with npm cache; mock-only environment; bounded `timeout 300s npm run build` in an eight-minute job. `production-build.log` is uploaded for seven days even when the build fails.

The workflow has no wallet setup, secrets, funded-wallet access, mainnet operation, transaction preparation, signing, broadcast, or deployment step.

## Local validation

| Check | Result |
| --- | --- |
| OpenAPI semantic validator | PASS |
| Workflow YAML structure | PASS: frontend, backend, production-build jobs present |
| TypeScript | PASS |
| ESLint | PASS |
| Frontend tests | PASS: 12 files passed, 1 skipped; 176 passed, 11 skipped |
| Rust format / Clippy | PASS |
| Rust tests | PASS: 58 tests |

Production browser checks were not rerun for this CI-only change. The latest bounded production Webpack and strict Chromium evidence remains passing in `MILESTONE6_2_BUILD_RECOVERY.md`.

## GitHub results and blockers

There are no GitHub Actions results yet: the workflow intentionally triggers only after a pull request to `main` is opened. The next submission step is to open the existing integration branch as a PR and require all three CI jobs before merge.

The remaining mainnet blockers are unchanged: a full ZIP-316 decoder, non-spending viewing source, independent pinned chain evidence, production authentication/key custody, explicit operator approval, durable broadcast reconciliation, and merchant confirmation/reorganization monitoring. Automatic mainnet spending remains disabled.
