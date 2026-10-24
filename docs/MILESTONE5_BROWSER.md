# Milestone 5 browser validation

**Current Milestone 5.1 verdict: FAIL.** Production Chromium checks pass, but the historical JSON exception is unresolved and development reload diagnostics still fail. See the Milestone 5.1 investigation below. The original Milestone 5 record is retained as history.

Validated on 2026-10-24 in `/home/temitope/veilpay-integration`, branch `test/full-integration`, using the existing Milestone 4 integration. No contributor branch was imported or overwritten. No commit, push, merge, or deployment was performed.

## Environment and reproduction

Actual Playwright Chromium 153.0.8010.12, headless, against Next.js 16.4.3 development server with Webpack, live API client, and same-origin `/api` rewrites to Rust Axum. Frontend: `http://127.0.0.1:3100`; backend: `127.0.0.1:4000`. Axum receives a minimal environment with `WALLET_BACKEND=mock`, `NETWORK=regtest`, matching `FRONTEND_ORIGIN`, and a new SQLite file under a temporary directory on every run. No route interception or substituted API server is used.

Runner: [scripts/test-browser-integration.py](../scripts/test-browser-integration.py). Requires Python Playwright and its installed Chromium, frontend dependencies, and a built `backend/target/debug/veilpay-backend` (`cargo build --manifest-path backend/Cargo.toml --bin veilpay-backend`). This environment's invocation:

```sh
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py
```

The initial sandbox launch could not start the loopback server; an approved execution outside that sandbox ran the actual suite. The runner stops both server process groups in `finally` and removes the temporary directory, database, journals, and server logs. Screenshots and sanitized browser observations remain in [docs/images/milestone5](images/milestone5/). Cookie values and CSRF tokens are excluded from evidence.

## Original Milestone 5 status

Functional browser checks passed, but the browser diagnostics gate is **not green**. The final post-fix run exited 1 after capturing an uncaught `Unexpected end of JSON input` exception. An earlier run captured a Next.js router initialization exception. These development-runtime errors remain unresolved; no successful all-clear is claimed.

## Results and evidence

| Area | Result and evidence |
| --- | --- |
| Fresh merchant | Browser bootstrap and merchant switch, invoice form submission for 0.02 ZEC, persisted list, actual detail GET. [Desktop invoice](images/milestone5/01-merchant-invoice-desktop.png). |
| Safe payment display | Mock detail explicitly says DEMO ONLY; no wallet URI or QR request generated. Invoice detail comes from Axum. Reload restores merchant session and invoice list; newly created inline detail is transient. |
| Fresh customer | Separate browser context and cookie jar, no default agent; creates and selects an agent through the UI. |
| Spending policy | UI saves v2 with 0.01 ZEC cap and 0.05 ZEC budget; requesting the 0.02 invoice is rejected with CAP_EXCEEDED. UI raises cap to 0.03 in v3 and the same amount is authorized. [Policy](images/milestone5/02-policy-desktop.png), [rejection](images/milestone5/03-policy-blocked-desktop.png). |
| Execute and idempotency | UI executes through real Axum. Confirmed mock result has `txid: null`, mock reference, simulated timeline, final wallet operation. Browser `fetch` repeats the captured execute key and CSRF header; HTTP 202 and entire JSON body match exactly. [Payment](images/milestone5/04-mock-payment-desktop.png). |
| Merchant receipt | Separate merchant browser looks up payment ID, sees mock verification method, acknowledges through UI, and detail GET reports invoice paid. [Acknowledgment](images/milestone5/05-merchant-ack-desktop.png). |
| Role isolation | Browser requests for customer access to merchant invoice and merchant access to customer agent both return 403. These demo roles do not constitute authentication or tenant isolation. |
| Reload | Merchant invoice list and customer cookie survive. Customer agent selection resets; reselecting the retained ID restores backend policy v3. [Reload before reselection](images/milestone5/08-customer-reload-desktop.png). |
| Error handling | Real nonexistent-payment lookup returns 404 and renders a friendly alert. [Error](images/milestone5/06-api-error-desktop.png). |
| Cookies and CSRF | Chromium accepts `__Host-veilpay_session` on loopback HTTP with Secure, HttpOnly, Path=/, SameSite=Strict; inaccessible to `document.cookie`. Missing and wrong CSRF headers each return 403 on a state change. All observed API URLs use port 3100 through the proxy. |
| Layout | 1440×1000 desktop and 390×844 mobile screenshots. Mobile document width stays within viewport; navigation scrolls locally. Invoice IDs wrap so amount and paid status remain visible. [Customer mobile](images/milestone5/07-customer-mobile.png), [merchant mobile](images/milestone5/07-merchant-mobile.png). |
| Browser diagnostics | An earlier complete functional rerun captured `Internal Next.js error: Router action dispatched before initialization.` See [retained diagnostics](images/milestone5/router-error-rerun.json); initial network-idle waits were added for a final rerun. The final rerun captured an uncaught `Unexpected end of JSON input` exception and exited 1; final diagnostics are recorded in results.json. Expected resource-error console entries correspond to two fresh-session 401s, role/CSRF 403 probes, and the deliberate lookup 404. Failed transport events are canceled Next RSC prefetch requests (`net::ERR_ABORTED`), not failed API requests. Exact counts and URLs are in [results.json](images/milestone5/results.json). |

## Fixes and reruns

- Disabled header context controls until the initial session exists and while switching. The first run exposed concurrent customer bootstrap and merchant switching, producing inconsistent session state and a 403 invoice-list request. The full browser flow was rerun after the fix.
- Used a fixed invoice table layout with a wrapping ID column. Visual review caught the paid-status cell being pushed out of the mobile table even though the overall document had no horizontal overflow. Full browser validation and screenshots were repeated after this fix.
- Corrected runner expectations to use the execute contract's HTTP 202. An earlier reload wait timed out; the successful rerun includes an explicit 1.5-second post-reload observation and a bounded element wait. A subsequent full functional run also captured an intermittent Next.js development router initialization exception; its diagnostics are retained separately. The runner now waits for initial page network idle; the last rerun still failed the diagnostics gate with `Unexpected end of JSON input`. This is a smoke runner, not a flake-free CI timing guarantee.

TypeScript, ESLint, and 109 unit/component/contract tests passed after the UI changes. The ten opt-in HTTP cases are skipped by ordinary `npm test`; the Milestone 4 report contains their earlier results. Backend source was not changed for this milestone.

## Limitations and merge recommendation

Recommend reviewing the integrated Milestone 4 changes together with these two UI fixes and the browser evidence. Resolve the intermittent browser JSON parsing and development router initialization exceptions before declaring the browser gate consistently green; validate a production Webpack server before release. This is not approval for public deployment or real funds. No merge was performed.

Coverage is Chromium only, at two viewport sizes, with a development Webpack server. Production hosting, TLS behavior outside localhost, other browsers, accessibility audits, expired sessions, sustained outages, malformed responses, exhaustive budget/TTL/merchant enforcement, concurrent execution races, and real-wallet lifecycle states were not validated by this browser run. The mobile merchant capture intentionally retains the lookup error state. The run checks cap enforcement and execute replay; broader policy/idempotency cases remain covered by the existing non-browser suites.

Demo principals are fixed by role; separate same-role sessions are not separate tenants. Agent selection and handoff IDs remain in memory; users must retain IDs across reloads. Merchant live payment discovery and address-format limitations from Milestone 4 remain. Some generic demo copy discusses chain confirmation and viewing keys, while the prominent mock banner and receipt method identify this run as simulated; such copy is not evidence of chain settlement.

No Zingo wallet access, real signing, preparation, broadcasting, blockchain transactions, mainnet access, or public deployment occurred. Only the mock adapter was started. Test servers were stopped and disposable SQLite databases removed after each completed or failed attempt.


## Milestone 5.1 investigation — 2026-10-24

### Verdict and merge blockers

**FAIL overall; PASS production Chromium desktop and mobile.** Do not merge on an all-clear browser claim. Remaining blockers:

1. The original `Unexpected end of JSON input` exception has no retained stack or server log. It did not recur during this investigation. Its exact origin is **unresolved**, not harmless and not proven to be development tooling.
2. The Next.js development HMR router initialization race is reproduced with a complete stack. The development diagnostics gate remains red.
3. Development reload stress also exposed a hydration mismatch at Shell/RootLayout and failed session readiness. Its underlying cause is not established; it remains a blocker rather than being waived as a tooling artifact.

The application response-validation defect found here is fixed, but there is insufficient evidence to claim it caused the historical JSON exception.

### Evidence and attribution

The original artifacts were screenshots and the two message-only diagnostic JSON files at the root of `images/milestone5/`. There were **no pre-existing Playwright trace archives**. Those original files were preserved. Original `results.json` records a document GET `/` returning 500 alongside the JSON exception; recorded API failures were the intentional 401/403/404 cases. That narrows the investigation but does not identify the throwing parser or prove causation.

Application inspection found one live-client JSON parser in `src/lib/api/live.ts`, already inside a try/catch. Empty successful bodies were previously converted to `{}`, and valid JSON with a wrong shape escaped as a ZodError. The runner's browser-evaluated fetch helper also uses `Response.json()`; an error there would reject the Playwright evaluation, whereas the old run completed its functional checks and failed on a pageerror. Neither fact supplies the missing historical stack. Next's server manifest parser and development runtime also parse JSON; identifying one as the cause without a stack would be speculation. No evidence establishes an API proxy parsing fault.

The router exception was captured in [dev-mobile/results.json](images/milestone5/dev-mobile/results.json) and again in the isolated [dev-reload-stress/results.json](images/milestone5/dev-reload-stress/results.json). Exact captured stack:

```text
Error: Internal Next.js error: Router action dispatched before initialization.
    at dispatchAppRouterAction (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/use-action-queue.js:41:15)
    at eval (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/sequential-router-queue.js:130:57)
    at startTransition (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react.development.js:556:27)
    at Object.hmrRefresh (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/components/sequential-router-queue.js:129:36)
    at eval (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/dev/hot-reloader/app/hot-reloader-app.js:315:64)
    at startTransition (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react.development.js:556:27)
    at processMessage (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/dev/hot-reloader/app/hot-reloader-app.js:314:44)
    at WebSocket.handleMessage (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/client/dev/hot-reloader/app/web-socket.js:96:52)
```

This is a development WebSocket server-component refresh calling HMR before `use-action-queue` has installed its dispatcher. The installed `node_modules/next/dist/client/components/use-action-queue.js` initializes `dispatch = null` and throws when it remains null. The caller is Next's `hmrRefresh`, explicitly guarded for development mode in `sequential-router-queue.js`. There are no application frames in this exception. The mobile reproduction overlapped production build work; the subsequent isolated development stress run, with no concurrent build or application edits, reproduced the same stack twice. Thus the attribution does not rely on that overlap. Initial network-idle waits do not eliminate it. No dependency files, error handlers, or diagnostics filters were patched to hide it.

Stress additionally captured a hydration error beginning at `throwOnHydrationMismatch` in `react-dom-client.development.js:5548:11`, followed by `beginWork:12447:17`, `runWithFiberInDEV:1046:30`, and React's render/scheduler frames. The full stack and DOM diff are in the stress results. The server/client diff at `Shell` shows a `div hidden=""` containing Suspense where the client expects the shell class and skip link. The server log identifies `src/components/shell.tsx:81` and `src/app/layout.tsx:18`. Application source does not render that hidden Suspense wrapper. This suggests streamed-rendering/runtime involvement, but **does not prove the root cause**. The stress run then timed out waiting for the disabled merchant context button to regain `aria-pressed=true`; it did not complete all 20 requested extra reloads.

### Source changes and diagnostic gate

- Live API parsing now rejects empty bodies, invalid JSON, and schema-invalid successful JSON consistently as `ApiError`, retaining the HTTP status and a safe message. Structured backend error bodies still preserve their contract errors; unexpected HTTP bodies fail closed. There is no fabricated successful result.
- Eight regression cases cover empty 200, empty 204, truncated JSON, HTML 502, schema-invalid object/null, unexpected 503 JSON, and empty 401. These pass along with the existing backend-error and successful response cases.
- The runner saves complete pageerror stacks, console locations, frontend/backend logs, and Playwright traces on success **and failure**. Labels preserve each run separately. Production mode uses `next start`; mobile mode starts fresh contexts at 390×844 and runs the entire flow, rather than only resizing for screenshots.
- The gate still fails on every page exception. It now also checks every console error and restricts expected HTTP errors to the exact bootstrap/negative-test paths and statuses. This closes the original runner's omission of a console assertion and broad status-only HTTP allowance. Unexpected document 500s fail.
- Raw aborted development requests remain in evidence. Trace inspection confirms RSC GET requests with `rsc: 1`, canceled during navigation/refresh (`net::ERR_ABORTED`). The inherited allowance for aborted RSC requests remains explicit; failed API transports are not allowed. Production recorded **zero failed requests**, including RSC.
- Trace ZIPs contain disposable session credentials and are kept locally, excluded by `.gitignore`; do not publish them. Sanitized results and screenshots contain no cookie values or CSRF tokens.

Session review: bootstrap queries are deduplicated by their React Query key; existing header controls prevent switching before session readiness or while a switch is pending. Fresh merchant/customer contexts, cookie isolation, CSRF rejection, session restoration, agent reselection, and client navigation all passed in production. The initial shell markup is deterministic. No hydration-warning suppression or arbitrary router-error filtering was added.

### Commands and results

Run from this workspace on `test/full-integration`. Python below is `/home/temitope/web3-qa-platform/venv/bin/python`.

```sh
npm run typecheck
npm run lint
npm test
cargo test --manifest-path backend/Cargo.toml
python3 scripts/test-http-integration.py
NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_API_BASE=/api VEILPAY_BACKEND_URL=http://127.0.0.1:4000/api npm run build

/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --label dev-before
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --label dev-stack
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --label dev-mobile --mobile
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --mode production --label production-desktop --reloads 3
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --mode production --label production-mobile --mobile --reloads 3
/home/temitope/web3-qa-platform/venv/bin/python scripts/test-browser-integration.py --label dev-reload-stress --reloads 10
```

| Check | Result |
| --- | --- |
| TypeScript | PASS |
| ESLint | PASS |
| Frontend tests | PASS, 117; 10 opt-in HTTP cases skipped here |
| Opt-in real Axum HTTP tests | PASS, all 10 |
| Backend tests | PASS, 40 Milestone 1 + 14 Milestone 3; fixture transports, no real wallet |
| Production Webpack build | PASS; all six app routes/static pages built |
| Initial instrumented dev attempt | FAIL, initial navigation timeout; no exception captured |
| Development desktop | PASS, 0 page exceptions; 24 aborted RSC requests; 9 expected HTTP/resource-console entries |
| Development mobile | FAIL, 1 HMR router exception; 38 aborted RSC requests; 10 expected HTTP/resource-console entries |
| Production desktop | PASS, 0 page exceptions, 0 failed requests, 0 unexpected console/HTTP errors |
| Production mobile | PASS, 0 page exceptions, 0 failed requests, 0 unexpected console/HTTP errors |
| Isolated dev reload stress | FAIL, 2 HMR router exceptions + 1 hydration mismatch; session-readiness assertion failed |

Each production run completed the complete invoice → policy rejection → policy update → mock execution → idempotent replay → merchant verification/acknowledgment flow, normal reload/reselection, and six additional session reloads (three merchant + three customer). Each recorded seven expected HTTP/resource-console errors: two bootstrap 401s, four role/CSRF 403 probes, and one nonexistent-payment 404. **Zero unexpected errors** does not mean these deliberately tested failures were hidden.

Production evidence: [desktop results](images/milestone5/production-desktop/results.json), [mobile results](images/milestone5/production-mobile/results.json), corresponding `next.log`/`backend.log`, and full-page screenshots in the same directories. Chromium was 153.0.8010.12 throughout. Desktop and mobile screenshots were visually inspected.

Environment failures are separate from product results: sandbox loopback binding failed and was retried with approval outside the sandbox. The first sandbox production build failed with `Could not parse output from TypeScript's --showConfig`; direct `tsc --showConfig` worked, and the approved build outside the sandbox completed. No build checks were disabled.

### Safety and cleanup

Every browser/backend HTTP run used a minimal backend environment with `WALLET_BACKEND=mock`, `NETWORK=regtest`, and a disposable SQLite directory. The runner asserted backend health before browser use. Servers were stopped in `finally` and each temporary database directory was removed, including failed runs. No Zingo wallet was opened, no blockchain transaction occurred, and nothing was deployed, committed, pushed, or merged. Existing contributor/integration work was preserved.
