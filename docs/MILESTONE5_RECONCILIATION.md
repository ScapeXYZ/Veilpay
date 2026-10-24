# Milestone 5.2 reconciliation — 2026-10-24

**Current Milestone 5.3 status:** three strict Turbopack development validations and both production Webpack Chromium reruns pass. Opt-in Webpack development still fails and is not claimed fixed. See the 5.3 evidence and production-only PR recommendation below. The 5.2 record is retained as history.

Reconciled in the uncommitted `test/full-integration` worktree at backend `0d1590298b9a5b94bfe2925f331c8e31f4eaf855`, importing frontend changes from fetched `origin/feat/veilpay-frontend` at `791479511ff50401fddf6795b1c80c2286d55c77`. No commit, push, Git merge, deployment, or contributor-branch modification occurred. The existing backup at `~/veilpay-backups/pre-milestone52.tar.gz` was not changed. Additional pre-edit frontend copies were retained under `/tmp/veilpay52-local` and the partner tree under `/tmp/veilpay52-partner`.

## Reconciliation

Used frontend `963831d` as the comparison base, inspected local/partner differences, applied three-way file reconciliation, and resolved overlapping changes. This imports source changes without importing the partner backend or replacing the authoritative OpenAPI contract.

- Preserved backend wallet implementation, migrations, Cargo files, and both checked-in OpenAPI files byte-for-byte against HEAD. The pre-existing backend `main.rs` loopback/BIND_ADDR integration change remains; no new backend changes were made.
- Preserved local session bootstrap, disabled context controls during bootstrap/switch, in-memory agent selection and setup tests, safe JSON/schema response handling and eight malformed-response regressions, same-origin API proxy, fixed/wrapping mobile invoice table, Webpack build command, and actual Axum/browser runners.
- Imported partner Orchard Unified Address decoding (Bech32m, F4Jumble/BLAKE2b, receiver validation), strict single-payment ZIP-321/address/amount/network matching, discriminated invoice payload schemas, and all partner address/QR tests. Mock invoices continue to produce no wallet URI/QR. Encoding vectors are fixtures; no wallet is accessed.
- Imported manual execution phase/fee display, signed-but-not-broadcast txid labeling, operator-required and unsupported-header-watcher health notices, merchant wallet verification explanation, acknowledgment invalidation and backend eligibility handling. `needsOperator` takes precedence over awaiting-operator; both prevent execute/resend controls. Preserved local invalidated-acknowledgment guard and mobile layout.
- Reconciled contract-sync checks to match discriminated payload variants by format rather than branch order, while reading the unchanged backend contract.
- Retained local policy-version/paused-agent, persisted review-state, acknowledgment replay, CSRF, and mock-only loopback HTTP checks alongside the partner ZIP-321 HTTP fixture test. Kept actual Axum assertions separate from the intentionally limited stand-in: policy mutation and persisted Axum fixtures skip in stand-in mode; receipt/ack lifecycle assertions still run against Axum. No assertion was removed from the real-backend path.
- Strengthened browser reload readiness assertions to require enabled context controls, in addition to the expected selected role. Full exception stacks, console locations, server logs and traces remain captured; no error filtering or hydration-warning suppression was added.

## Verification

| Check | Result |
| --- | --- |
| TypeScript `npm run typecheck` | PASS |
| ESLint `npm run lint` | PASS |
| Frontend `npm test` | 166 passed, 11 opt-in HTTP cases skipped; 11 files passed, 1 skipped |
| Actual Axum `python3 scripts/test-http-integration.py` | 10 passed, 1 stand-in-only ZIP-321 case skipped |
| HTTP fixture `INTEGRATION_SELF=1 npm test -- src/lib/api/http.integration.test.ts` | 9 passed, 2 Axum-only cases skipped |
| Rust `cargo fmt --manifest-path backend/Cargo.toml --check` | PASS |
| Rust `cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings` | PASS |
| Rust `cargo test --manifest-path backend/Cargo.toml` | 54 passed: 40 Milestone 1 + 14 Milestone 3; zero failures |
| Production `npm run build` (`next build --webpack`) | PASS; six routes, seven generated static pages including internal output |

The first combined unit run also passed 166 tests; HTTP reconciliation subsequently restored two local HTTP cases, yielding the final 177 discovered tests (166 ordinary + 11 opt-in). Initial stand-in execution failed 2 tests (8 passed, 1 skipped): its server lacks policy GET/PUT/PATCH and models pre-execution verification as pending, not Axum's not_seen. Explicit mode separation fixed that harness mismatch; the complete actual Axum suite passed both before and after this harness change (10 passed, 1 skipped each). Initial sandbox HTTP failed before starting a server (socket permission denied); initial sandbox build failed parsing TypeScript --showConfig. Both were retried outside the sandbox with approval and passed, without disabling checks.

### Repeated production Chromium

Chromium `153.0.8010.12`, live client through same-origin Next rewrites to actual Axum. Each independent run starts a fresh database and two isolated browser cookie contexts. Full invoice → cap rejection → policy update → mock execution → exact execute replay → merchant verification/acknowledgment, role/CSRF rejection, cookie attributes, reload/reselection, friendly 404, and mobile overflow checks pass.

| Evidence directory under `docs/images/milestone5/` | Viewport at start | Additional reloads | Checks | Page errors | Failed requests | Expected HTTP / console errors | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [m52-production-desktop-1](images/milestone5/m52-production-desktop-1/results.json) | 1440×1000 | 6 | 12 | 0 | 0 | 7 / 7 | PASS |
| [m52-production-mobile-1](images/milestone5/m52-production-mobile-1/results.json) | 390×844 | 6 | 12 | 0 | 0 | 7 / 7 | PASS |
| [m52-production-desktop-2](images/milestone5/m52-production-desktop-2/results.json) | 1440×1000 | 10 | 12 | 0 | 0 | 7 / 7 | PASS |
| [m52-production-mobile-2](images/milestone5/m52-production-mobile-2/results.json) | 390×844 | 10 | 12 | 0 | 0 | 7 / 7 | PASS |

48 named checks total; 32 additional merchant/customer session reloads plus each run's ordinary reloads. Each run's seven expected failures are two fresh-session 401s, four role/CSRF 403 probes, and one nonexistent-payment 404. Zero unexpected HTTP or console errors. Mobile merchant screenshot visually checked: ID wraps, amount and paid badge remain visible. Traces contain disposable credentials and remain locally ignored; sanitized JSON, screenshots and server logs are retained in each evidence directory.

Commands (Python is `/home/temitope/web3-qa-platform/venv/bin/python`):

```sh
NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_API_BASE=/api VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api npm run build
python scripts/test-browser-integration.py --mode production --label m52-production-desktop-1 --reloads 3
python scripts/test-browser-integration.py --mode production --mobile --label m52-production-mobile-1 --reloads 3
python scripts/test-browser-integration.py --mode production --label m52-production-desktop-2 --reloads 5
python scripts/test-browser-integration.py --mode production --mobile --label m52-production-mobile-2 --reloads 5
```

## Development investigation and merge blockers

**Production reconciliation checks pass; overall development gate remains FAIL. Do not merge on an all-green claim.** Prior Milestone 5.1 artifacts and conclusions remain in `docs/MILESTONE5_BROWSER.md` and were not overwritten.

| Development run | Functional checks completed | Page exceptions | Console errors | Failed requests | Result |
| --- | --- | --- | --- | --- | --- |
| [m52-dev-desktop-stress](images/milestone5/m52-dev-desktop-stress/results.json), `--reloads 10` | 11 | 2 HMR router errors | 7 expected HTTP entries | 27 aborted RSC requests | FAIL: first additional merchant reload did not regain ready merchant session |
| [m52-dev-mobile-cdp](images/milestone5/m52-dev-mobile-cdp/results.json), instrumented rerun, `--mobile --reloads 10` | 8 | 1 HMR router + 1 hydration mismatch | 6 expected HTTP + 1 React update-before-mount | 32 aborted RSC requests | FAIL: ordinary customer reload could not restore agent selector; no stress reloads reached |
| [m52-dev-mobile-clean](images/milestone5/m52-dev-mobile-clean/results.json), fresh dev cache, `--mobile --reloads 10` | 0 | 1 stackless `Invalid or unexpected token` | 1 React update-before-mount error | 0 | FAIL: initial customer control disabled/unselected, no API requests |

No production build or application source editing ran concurrently with any development run. Before the clean-cache run, stopped development output `.next/dev` was moved to `/tmp/veilpay52-dev-cache-before-clean`; no source or dependency patch was applied. A fresh cache did not establish a working development gate.

The desktop HMR stack is `dispatchAppRouterAction → sequential-router-queue → hmrRefresh → hot-reloader-app processMessage → WebSocket.handleMessage`, with no application frames. Inspection of installed Next 16.4.3 shows `use-action-queue.js` initializing its module dispatcher to null and throwing on dispatch before `useActionQueue` installs it; `hot-reloader-app.js` handles SERVER_COMPONENT_CHANGES by calling hmrRefresh, and sequential-router-queue restricts that call to development. This establishes the immediate throwing path, not a complete upstream root-cause fix. The desktop run completed the payment lifecycle and ordinary reload/reselection, then failed its first additional merchant session-readiness check. Trace inspection confirms two merchant reload calls total (ordinary plus first stress reload) and one ordinary customer reload, rather than the requested 20 completed stress reloads. Seven HTTP errors were the expected probes, with no unexpected document 500. A [sanitized session network summary](images/milestone5/m52-dev-desktop-stress/session-network-summary.json) shows successful session 200s earlier and one incomplete merchant session GET at termination (trace status -1); no evidence identifies a backend rejection as the readiness cause. Recorded failed-request events were aborted RSC requests. The gate failed before reaching final assertions; the raw observations are retained.

The clean-cache mobile run failed before session bootstrap. The sole pageerror has no stack; JavaScript chunk requests report 200 in the trace, but their bodies were not retained, so the invalid token cannot be assigned to a specific source file from that run. The concurrent console error says React received a state update on a component that has not mounted. All six generated development chunk files subsequently passed `node --check`; this does not validate eval-generated code or prove what Chromium received. Added CDP Runtime.exceptionThrown capture (text, URL, coordinates, script ID and stack only) to preserve coordinates on a further reproduction, plus final-state screenshots on failures. Existing console/pageerror assertions remain intact; capture failures do not replace the primary test failure.

The CDP-instrumented mobile rerun reproduced the historical hydration mismatch, not the syntax error. It completed eight functional checks through merchant acknowledgment and cookie/CSRF probes, then timed out waiting for the customer agent selector after ordinary reload; it never reached extra stress reloads. It recorded one HMR exception, one hydration exception, six expected HTTP errors, one unexpected React update-before-mount console error, and 32 aborted RSC requests. CDP independently captured both exception coordinates/stacks. The React diff at RootLayout → Providers → Shell expects `div.min-h-screen...` and the skip link but receives a classless `div hidden=""` containing Suspense. The app does not render this wrapper; its initial shell and provider state are deterministic and its time formatter specifies UTC. That narrows the immediate mismatch to streamed/runtime markup but does not prove the initiating cause or justify a dependency patch. The installed Next Fast Refresh/hydration guides were reviewed; no suggested warning suppression was applied. Full DOM diff, stacks, final-state screenshots and frontend logs are retained in [the run directory](images/milestone5/m52-dev-mobile-cdp/results.json).

Remaining merge blockers:

1. Reproduced development HMR-before-router-initialization errors and subsequent session-readiness failure.
2. Clean-cache development syntax/update-before-mount failure prevents initial bootstrap; root cause unresolved.
3. Reproduced hydration mismatch at Shell/RootLayout; underlying cause unresolved. The original Unexpected end of JSON input was not reproduced in any 5.2 run and remains unattributed. Passing production and the preserved JSON response fix do not establish its cause or close it.

Production confidence is limited to mock Axum + Chromium on localhost. Real wallet lifecycle behavior is displayed from fixtures and is not exercised with wallets. No release/deployment recommendation is implied.

## Safety and cleanup

All running backend instances use a minimal environment with `WALLET_BACKEND=mock`, `NETWORK=regtest`, disposable SQLite files, loopback binding, and a mock-health assertion before tests. Rust wallet tests use fixture transports. No Zingo wallets were accessed; no real prepare/sign/broadcast/deploy action occurred. Runners stop server process groups in finally blocks and remove temporary database directories, including on failures. Artifact traces remain ignored. Original branch refs and protected backend/contract files were verified unchanged at completion. Next development generated a root AGENTS.md; that generated file and Python bytecode were moved to `/tmp/veilpay52-*` after testing rather than being included in the reconciliation.

Verification logs are retained in [m52-checks](images/milestone5/m52-checks/v52-test-final.log). Development commands:

```sh
python scripts/test-browser-integration.py --label m52-dev-desktop-stress --reloads 10
# After stopping the above run, moved .next/dev to /tmp/veilpay52-dev-cache-before-clean.
python scripts/test-browser-integration.py --mobile --label m52-dev-mobile-clean --reloads 10
python scripts/test-browser-integration.py --mobile --label m52-dev-mobile-cdp --reloads 10
```

Final safety audit: test servers stopped, no listening test ports 3100/4000, and no disposable veilpay-browser/veilpay-http database directories remain. No wallet operations beyond mock/fixture behavior occurred.


## Milestone 5.3 — development diagnosis and merge readiness

Work remains on `test/full-integration` at backend `0d15902`, with partner frontend reference `7914795` unchanged. The 5.2 history above is retained. Both milestone reports were read before code changes.

### Exact new reproduction: truncated development script

Command (Python is `/home/temitope/web3-qa-platform/venv/bin/python`):

```sh
python scripts/test-browser-integration.py --bundler webpack --label m53-webpack-baseline --reloads 10
```

The instrumented baseline passed invoice creation, then failed merchant session restoration after reload. CDP captured a syntax failure in `http://127.0.0.1:3100/_next/static/chunks/app/layout.js`, zero-based line 182, column 28 (the failed file ends on line 183). `Debugger.scriptFailedToParse` preserved the exact script source. The source and completed HTTP response are identical, 393,216 bytes, SHA-256 `4fc0e58b77ecf07cf4264b31c60becf926e26f102a9507b31102f037c8e49fe7`. They end inside an eval string's inline source map; `node --check` independently reports `SyntaxError: Invalid or unexpected token`, with an unterminated string at line 183. This is the previously stackless exception with its missing source evidence recovered.

An earlier successful 200 response for the same URL was 2,404,575 bytes, SHA-256 `4a56fd4e9cd9bdfc536ebe121e364a270a4679511ec0f686d4d259c141620919`. The failed script is an **exact byte prefix** of that valid response. The browser received incomplete generated Webpack development JavaScript, rather than an application source syntax error. Both requests finished with HTTP 200. All completed API responses before this failure were retained; bootstrap had returned 200, invoice create 201 and detail 200. After reload the app displayed an unknown backend/loading session state and never issued a new bootstrap request. This directly explains that readiness failure: the truncated layout script could not execute the application. It does not independently prove the cause of every previous readiness failure.

Evidence: [baseline results](images/milestone5/m53-webpack-baseline/results.json), [truncated-script comparison](images/milestone5/m53-webpack-baseline/truncated-script-summary.json), corresponding Next/backend logs, final-state screenshot, and locally ignored traces/raw bodies. The response recorder retains method, URL, status, content type, byte count, SHA-256, and private body path. Subsequent runs also retain cache/content-length/transfer headers and timestamps. Raw responses can contain disposable session/CSRF credentials and are excluded from Git under each run's `private/`; sanitized JSON contains no credential headers or bodies.

### Tooling versus application scope

The installed Next 16.4.3 installation guide identifies Turbopack as `next dev`'s default. This project's `npm run dev` already follows that default, but the inherited browser runner forced `--webpack`. The comparison changed the bundler while preserving the application, backend, database isolation, functional assertions and diagnostic gate. `--bundler turbopack --label m53-turbopack-probe --reloads 10` passed all 12 checks and 20 extra session reloads, with zero page/CDP exceptions, seven expected HTTP/console errors, and four aborted RSC requests. This probe preceded the explicit live-edit HMR validations below.

The browser runner now defaults to Turbopack, matching the actual development command, and retains `--bundler webpack` as an explicit reproduction path. Production continues using `next build --webpack` and `next start`. No dependency/runtime patch, hydration suppression, swallowed page exception, console filter, artificial session result, or disabled HMR was introduced. Existing 5.2 app source, ZIP-321 validation, contracts and backend wallet implementation are preserved.

Added `--hmr-edits N` development validation: temporarily change the mock banner text, assert the change appears in both independent contexts, require enabled session controls, restore the exact original source in finally, and assert the probe text disappears. This exercises real live compiler/HMR updates in addition to reload stress. It does not intentionally introduce invalid syntax. Diagnostic capture now also records failed-script source, completed HTTP bodies/hashes, HMR message types and CDP exceptions. The gate rejects CDP exceptions as well as page/console/HTTP/transport errors. ESLint excludes only locally captured generated scripts and `.local/` investigation artifacts, which otherwise linted the deliberately retained truncated script as application source; application lint rules are unchanged.

The historical HMR immediate throwing path remains documented above: Next's server-component-change WebSocket handler invokes hmrRefresh before the router's module dispatcher exists. The historical hydration diff finds React streaming's hidden Suspense wrapper at Shell, not markup the application renders. The generated-code truncation and Webpack-specific runtime stacks identify tooling failures, while the exact internal cause of Webpack's partial response and the initiating hydration race remain unresolved. Switching the validation runner to the already-used development bundler avoids that failing tooling path; it is not a claim to have patched Next's Webpack implementation.

### Rejected atomic-write experiment

To test whether development output was being read during replacement, a temporary Webpack plugin wrapped compiler output-file writes with temporary-file-plus-rename. It was enabled only for one mock development run via `VEILPAY_ATOMIC_WEBPACK=1`; it was never enabled for production. The run [m53-webpack-atomic-experiment](images/milestone5/m53-webpack-atomic-experiment/results.json), `--bundler webpack --reloads 10 --hmr-edits 2`, completed two functional checks and then failed customer session readiness before any explicit HMR edit or stress reload. It captured **13 HMR page exceptions**, with 13 CDP exception records, two expected HTTP/console errors and 18 aborted RSC requests. All eight completed layout-script responses were the full 2,404,575 bytes, yet the same Next dispatcher error occurred. Thus script truncation alone does not explain the HMR race, and atomic output replacement is not a complete repair. The experiment was rejected; `next.config.ts` was restored byte-for-byte and no plugin remains in the active configuration. Private experimental source is retained only under ignored `.local/m53/` for investigation.

The new immediate HMR source coordinate is `webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/use-action-queue.js`, zero-based line 40, column 14. Its complete CDP call frames and browser stack are in the experiment results. They match the 5.1/5.2 dispatcher → sequential queue → hmrRefresh → hot-reloader WebSocket path. This is additional evidence that the dispatcher failure belongs to the Next Webpack development runtime, not the Axum API or an application event handler.

### Development validation

| Run under `docs/images/milestone5/` | Mode | Named checks | Extra session reloads completed | Live edits observed in both contexts | Page / CDP exceptions | HTTP / console errors (all expected) | Failed requests (aborted RSC only) | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [m53-turbopack-probe](images/milestone5/m53-turbopack-probe/results.json) | Desktop, Turbopack | 12 | 20 | 0 | 0 / 0 | 7 / 7 | 4 | PASS |
| [m53-dev-desktop-1](images/milestone5/m53-dev-desktop-1/results.json) | Desktop, Turbopack | 13 | 20 | 2 | 0 / 0 | 9 / 9 | 2 | PASS |
| [m53-dev-mobile-2](images/milestone5/m53-dev-mobile-2/results.json) | Mobile, Turbopack | 13 | 20 | 2 | 0 / 0 | 7 / 7 | 3 | PASS |
| [m53-dev-desktop-3](images/milestone5/m53-dev-desktop-3/results.json) | Desktop, Turbopack | 13 | 20 | 3 | 0 / 0 | 7 / 7 | 1 | PASS |

The three required final development passes completed **39 named checks, 60 extra session reloads, and seven real source edits**, each observed in both independent customer/merchant contexts. Restoration was also observed in both contexts. Initial desktop viewport is 1440×1000; mobile is 390×844. The inherited layout checks resize desktop runs to mobile before extra reloads; thus desktop runs test desktop functionality and mobile reload stress, while the mobile run starts and stays mobile. All use Chromium 153.0.8010.12. Expected errors are the same exact-path negative probes as before; desktop-1's two additional 404s repeat the deliberate invalid lookup during HMR query refresh. Aborted RSC requests remain explicitly allowed and recorded; API transport failures are not allowed. No page or CDP exceptions are allowed. The final harness also rechecks diagnostics after final screenshots and browser shutdown.

```sh
python scripts/test-browser-integration.py --label m53-dev-desktop-1 --reloads 10 --hmr-edits 2
python scripts/test-browser-integration.py --mobile --label m53-dev-mobile-2 --reloads 10 --hmr-edits 2
python scripts/test-browser-integration.py --label m53-dev-desktop-3 --reloads 10 --hmr-edits 3
```

All `src/` files were compared against a pre-HMR archive and are byte-for-byte unchanged after restoration. No 5.2 frontend feature, test, JSON response fix, ZIP-321 safety check, wallet implementation, migration or contract was replaced. The retained changes are to the browser runner, artifact ignores, ESLint artifact exclusions, and this report/evidence. The app's existing `npm run dev` command and `next.config.ts` remain unchanged.

### Production and final verification

Built fresh with `NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_API_BASE=/api VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api npm run build`, then tested `next start` against actual mock Axum. No development server was running during the build or production runs.

| Run | Checks | Extra session reloads | Page / CDP exceptions | Failed requests | Expected HTTP / console errors | Result |
| --- | --- | --- | --- | --- | --- | --- |
| [m53-production-desktop](images/milestone5/m53-production-desktop/results.json) | 12 | 10 | 0 / 0 | 0 | 7 / 7 | PASS |
| [m53-production-mobile](images/milestone5/m53-production-mobile/results.json) | 12 | 10 | 0 / 0 | 0 | 7 / 7 | PASS |

Both runs completed the full flow, including policy rejection, mock execution, exact idempotency replay, merchant acknowledgment, reload/reselection, role/CSRF probes and responsive checks. The production merchant mobile screenshot was visually inspected: wrapping ID, amount and paid badge remain visible. These are **24 new production checks and 20 extra session reloads**, in addition to the four historical 5.2 production passes. They are not counted as development passes.

```sh
python scripts/test-browser-integration.py --mode production --label m53-production-desktop --reloads 5
python scripts/test-browser-integration.py --mode production --mobile --label m53-production-mobile --reloads 5
```

| Required check | Final result | Evidence under `images/milestone5/m53-checks/` |
| --- | --- | --- |
| TypeScript | PASS | `typecheck-final.log` |
| ESLint | PASS, zero errors/warnings | `lint-final.log` |
| All ordinary frontend tests | **166 passed, 11 opt-in HTTP cases skipped**; 11 files passed, 1 skipped | `frontend-tests-final.log` |
| Actual Axum HTTP suite | **10 passed, 1 stand-in-only case skipped** | `axum-http.log` |
| HTTP fixture suite | **9 passed, 2 Axum-only cases skipped** | `fixture-http.log` |
| Rust formatting | PASS | `rust-fmt.log` |
| Clippy, all targets, warnings denied | PASS | `rust-clippy.log` |
| Rust tests | **54 passed, 0 failed, 0 ignored** (40 Milestone 1 + 14 Milestone 3) | `rust-tests.log` |
| Production Webpack build | PASS; six routes, seven generated static outputs | `build.log` |
| Three required development validations | **3/3 passed**, 39 checks, 60 extra reloads, seven real HMR edits | Linked results above |
| Production Chromium reruns | **2/2 passed**, 24 checks, 20 extra reloads | Linked results above |

Final required supported-path checks have zero failures. Across all eight 5.3 browser attempts there are **six passing runs** (probe + three development validations + two production runs) and **two failing Webpack development runs**. The failed baseline captured one syntax page exception (one CDP exception event plus one failed-parse event); the rejected experiment captured 13 HMR page exceptions and 13 matching CDP exception events. Neither failing run completed its requested stress reloads. No failure is reclassified as a pass.

An initial concurrent ordinary test run had **165 passed, 1 timeout failure, 11 skipped**: the merchant invalid-lookup component test exceeded its unchanged 5-second limit while Chromium and lint were also active. The full isolated rerun passed all 166; no test or timeout was changed. Contention is a possible explanation, not an established root cause. Initial ESLint also correctly rejected the deliberately saved truncated generated script; the final lint excludes only captured/local artifacts and passes. Both outcomes are retained rather than omitted from the evidence.

### Remaining diagnosis and PR recommendation

1. **HMR exceptions:** still reproducible in opt-in Next 16.4.3 Webpack development. Exact runtime stacks, WebSocket serverComponentChanges messages and response bodies are retained. Atomic writes did not solve it. This is an open tooling defect, not an application fix claimed complete.
2. **Hydration mismatch:** the exact 5.2 stack/DOM diff remains evidence. It did not recur in any 5.3 run, including the three strict default-development passes with HMR edits. Its initiating cause remains unresolved; the app's deterministic markup was preserved. It is not proven to share the syntax error's truncation cause.
3. **Stackless syntax failure:** reproduced and attributed to the exact incomplete 200 development-script response, with recovered source coordinates, source bytes and independent parser failure. The internal cause of the partial Webpack response remains unpatched. It did not occur in Turbopack development or production.
4. **Session readiness:** the syntax baseline proves one case never reaches bootstrap because layout JavaScript is invalid; the atomic experiment additionally fails readiness alongside HMR exceptions despite full layout responses. All default-development and production session/reload assertions passed. This is evidence against a universal session bootstrap defect, not proof of every historical failure's cause.
5. **Historical Unexpected end of JSON input:** not reproduced in any of the eight 5.3 browser attempts. An offline check parsed **765 captured completed API response bodies with zero invalid JSON bodies**. Two additional completed API bodies could not be retrieved by CDP after navigation (one invoice-list response in the probe, one deliberate missing-payment verification response in desktop-1); those capture limitations are explicit in [api-body-validation.json](images/milestone5/m53-checks/api-body-validation.json). The historical document-500/JSON failure cannot be retroactively attributed to either the script truncation or the API client. Its original throwing stack is still unavailable.

**Recommendation: proceed with review of a production-only integration PR, while documenting the Webpack-development defect; it should not block that narrowly scoped PR on the evidence collected.** The actual default development command is now tested cleanly, and a fresh production Webpack build plus desktop/mobile flows pass with strict diagnostics. This is a tooling-path correction and validated supported configuration, not a universal repair of Next's Webpack dev runtime. If Webpack development is a required supported workflow, its HMR/partial-response failures remain a merge blocker for that requirement. Do not describe all development modes or the historical unattributed exceptions as fixed. This recommendation is for integration review, not deployment or real-wallet readiness.

No exceptions, console errors, hydration warnings or HTTP failures were filtered out to obtain these passes. The only request-failure allowance is the existing explicit aborted-RSC rule. The test runner preserves exact-path expected negative probes and rejects unexpected errors, including after final screenshot capture.

### Final safety and cleanup audit

All backend runs used `WALLET_BACKEND=mock`, `NETWORK=regtest`, fresh disposable SQLite directories and a health assertion. No Zingo wallet access, real preparation, signing, broadcasting, transaction, or deployment occurred. Servers stopped in finally blocks for both successes and failures. Final audit found **no listeners on ports 3100/4000, no matching backend/Next/test-runner processes, and no remaining veilpay-browser/veilpay-http temporary database directories**.

Application source was verified byte-for-byte against the pre-HMR archive after all tests; the rejected config experiment was fully restored. Backend wallet code, migrations, Cargo files and both contracts still match HEAD. Branch remains `test/full-integration`; HEAD remains `0d1590298b9a5b94bfe2925f331c8e31f4eaf855`, fetched frontend reference remains `791479511ff50401fddf6795b1c80c2286d55c77`. No commit, push, merge, contributor-branch change or deployment occurred. Generated root AGENTS.md and Python bytecode were moved into ignored `.local/m53/`; ignored raw responses and traces remain for local investigation and contain disposable credentials, so are not publication artifacts.
