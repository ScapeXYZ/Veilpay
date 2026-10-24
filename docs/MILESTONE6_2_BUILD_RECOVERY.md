# Milestone 6.2: production-build and browser-startup recovery

Date: 2026-10-24
Worktree: `/home/temitope/veilpay-integration` (`test/full-integration`, base `0d15902`)
Safety mode: `WALLET_BACKEND=mock`; no wallet access, signing, transaction preparation, broadcasting, deployment, commit, push, or merge.

## Result

**PASS.** The Webpack production build, strict production Chromium desktop/mobile checks, and strict Turbopack development Chromium check all complete successfully when run in a session which permits their local loopback worker processes to remain alive. No application source change was required or made for this recovery.

## Root-cause investigation

The apparent stop at `Creating an optimized production build ...` was not a reproducible application compilation failure. It was a combination of two execution-harness effects:

1. A short-lived command-output wrapper returned at about 30 seconds while the child build was still running. The build continued in the background and held `.next/lock`. A second invocation then correctly failed with Next's explicit error: `Another next build process is already running.`
2. When Next was run inside the restricted sandbox, its CSS/PostCSS worker could not create the loopback listener required by its child-process transport. Next emitted a panic report with `binding to a port` followed by `Operation not permitted (os error 1)`, rooted at `src/app/globals.css` through `PostCssTransformedAsset::process` / `evaluate_webpack_loader`. This is a sandbox policy failure, not an application exception. It also explains the earlier development-runner readiness loss when its subprocess was not preserved.

The recovery was to use one bounded, session-preserving local command at a time, outside that restricted worker sandbox. This did not relax browser diagnostics, alter Next configuration, mask errors, or disable a test.

## System observations

| Observation | Result |
| --- | --- |
| Host | Linux `6.18.54.1-microsoft-standard-WSL2` |
| Node / npm | `v22.23.2` / `10.9.8` |
| CPUs | 8 |
| Memory | 7.6 GiB total; 6.4–6.6 GiB available during investigation |
| Swap | 2.0 GiB total; 1.8 GiB free |
| Workspace filesystem | 1007 GiB total; 891 GiB free |
| cgroup memory limit | `max`; observed current usage about 4.8 GiB |
| process limit | 31,192 (`ulimit -u`) |
| open-file limit | 1,048,576 (`ulimit -n`) |
| OOM evidence | No OOM-killer messages in available `dmesg` / journal output |
| stale workers | No surviving Next, Node build, backend, or browser-runner processes after each completed test |

The initially observed active build used roughly 30.8% CPU and 402 MiB RSS at 76 seconds. It completed normally. These observations rule out disk exhaustion, swap exhaustion, a process/file limit, and OOM termination.

## Production build evidence

Bounded command (180-second ceiling):

```sh
timeout 180s env WALLET_BACKEND=mock NEXT_PUBLIC_API_MODE=live \
  NEXT_PUBLIC_API_BASE=/api VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api \
  npm run build
```

The final foreground command exited **0**. Its combined stdout/stderr contained no error output and reported:

- Next.js `16.4.3 (webpack)`;
- `Compiled successfully in 6.0s`;
- `Finished TypeScript in 3.9s`;
- page data collected with 7 workers in 1.990s;
- all 7 static pages generated in 1.120s;
- finalization and trace collection in 17.9s;
- static routes `/`, `/_not-found`, `/merchant`, `/payments`, `/policy`, and `/privacy`.

An earlier single bounded cold-cache run also completed compilation in 47 seconds and generated all 7 pages. Its detached wrapper was reaped before it could write its own post-command status file, but Next removed `.next/lock` and emitted the complete route manifest. The final foreground run supplies the authoritative exit status.

## Browser startup and functional evidence

All browser runs use the repository runner, loopback-only servers, a temporary SQLite database, and `WALLET_BACKEND=mock`.

| Command/result | Readiness | Checks |
| --- | --- | --- |
| `timeout 180s … test-browser-integration.py --mode production --label milestone62-prod-desktop --reloads 1` | `next start` ready in 155 ms | **12/12 passed**, exit 0 |
| `timeout 180s … test-browser-integration.py --mode production --mobile --label milestone62-prod-mobile --reloads 1` | `next start` ready in 122 ms | **12/12 passed**, exit 0 |
| `timeout 180s … test-browser-integration.py --bundler turbopack --label milestone62-dev --reloads 1 --hmr-edits 1` | `next dev` ready in 430 ms | **13/13 passed**, exit 0 |

Every production run passed the invoice, session, agent authorization, policy-cap, mock execution/idempotency, merchant verification/acknowledgment, CSRF/cookie, reload, recoverable API error, mobile layout, and strict browser-diagnostic checks. The Turbopack run passed the same 12 checks plus its live source-edit Fast Refresh check. Its `next.log` records successful page compilation and two expected filesystem-settling notices while Playwright wrote trace ZIPs; it has no exceptions, stack traces, failed requests, or readiness error.

Artifacts, including `next.log`, `backend.log`, screenshots, Playwright result JSON, and traces, are retained under `docs/images/milestone5/milestone62-{prod-desktop,prod-mobile,dev}/`.

## Regression validation

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS, exit 0 |
| `npm run lint` | PASS, exit 0 |
| `npm test -- --run` | PASS: 12 files passed, 1 skipped; 174 tests passed, 11 skipped (185 total) |
| Actual Axum HTTP suite: `WALLET_BACKEND=mock python3 scripts/test-http-integration.py` | PASS: 10 passed, 1 skipped (11 total) |
| `WALLET_BACKEND=mock cargo fmt --check` in `backend/` | PASS |
| `WALLET_BACKEND=mock cargo clippy -- -D warnings` in `backend/` | PASS |
| `WALLET_BACKEND=mock cargo test` in `backend/` | PASS: 57 tests (40 Milestone 1, 14 Milestone 3, 3 mainnet) |

The first Rust command attempt at repository root failed because that directory has no `Cargo.toml`; rerunning from `backend/` passed. This is recorded as an invocation-path error, not a code failure.

## Preservation and cleanup

No frontend, backend, OpenAPI, ZIP-321, mainnet-read-only, wallet-boundary, policy, or browser-diagnostic code was changed in this milestone. Existing Milestone 6.1 integration work remains in the uncommitted worktree.

After validation, process inspection found no surviving VeilPay backend, Next dev/start/build, or browser-runner process. The runner's temporary SQLite databases were removed. Browser artifacts listed above are intentional retained test evidence.

## Remaining blockers

There is no application blocker for the production build or browser validation in this worktree. The operational caveat is that a restricted sandbox which forbids loopback port binding cannot run the Next CSS/PostCSS worker; CI and local validation must provide normal local process/loopback capability and preserve the build process until it exits. This should be treated as an execution-environment prerequisite, not solved by suppressing Next diagnostics or weakening tests.
