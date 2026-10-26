# ZECATHON Testnet release readiness

This document describes the submission build at `5f0c0afaf86f537d0d63abc1af2d73bbd292a110`.
It is a desktop-oriented, Testnet-only policy-control demonstration. It is not a
wallet, payment processor, settlement verifier, or merchant-custody service.

## What can be demonstrated truthfully

1. Connect a **Testnet** Noir Wallet for browser-local observation only.
2. Create a VeilPay workspace independent of that wallet connection.
3. Create, edit, pause, and resume an account-owned payment agent with a total
   budget, per-payment cap, merchant identifier allow-list, and optional policy
   expiration.
4. Show that payment requests are unavailable rather than inventing a payable
   invoice without a securely bound merchant shielded receiver.
5. Revoke the VeilPay session and disconnect Noir Wallet independently.

Do not say or imply that VeilPay sends, signs, broadcasts, confirms, settles, or
independently verifies a shielded payment.

## Deployment configuration

Use one public HTTPS frontend origin and keep the Rust backend on a private
network behind the Next.js same-origin `/api` rewrite. The browser must not call
the backend directly.

Required variables:

```bash
# Rust API: private listener / service network
NETWORK=testnet
WALLET_BACKEND=zingo
BIND_ADDR=127.0.0.1:4100
FRONTEND_ORIGIN=https://veilpay.example
DATABASE_URL=sqlite:///private/veilpay/veilpay-testnet.db

# Next.js: public HTTPS frontend
NEXT_PUBLIC_API_MODE=live
VEILPAY_BACKEND_URL=http://127.0.0.1:4100/api
VEILPAY_DEPLOYMENT_NETWORK=testnet
```

`FRONTEND_ORIGIN` must be the exact public origin. For every non-loopback
origin, the backend issues the `__Host-veilpay_session` cookie with `Secure`,
`HttpOnly`, `SameSite=Strict`, and `Path=/`. HTTPS is therefore mandatory.
The reverse proxy must preserve `Set-Cookie`, must not cache `/api`, and must
route `/api/*` only through Next.js to the private backend.

The backend CORS policy permits only the configured exact origin, supports
credentialed requests, and requires the matching `Origin` plus a session-bound
CSRF token on writes. POSTs also require idempotency keys. Terminate TLS at a
maintained reverse proxy, set HSTS after the hostname is final, and restrict
backend ingress to the frontend service. Do not set wildcard CORS or expose the
backend port publicly.

`VEILPAY_DEPLOYMENT_NETWORK` is server-only Next.js configuration. Set it
explicitly to `testnet` only for this reviewed Testnet workspace release;
`mainnet`, an unset value, or any other value denies every API write at the
Next boundary. The Rust backend independently applies its configured `NETWORK`
and broadcast-disabled adapter policy, so a frontend/backend mismatch fails
closed rather than granting payment authority.

SQLite is the current persistence implementation. Place its absolute database
path outside the repository on encrypted persistent storage, limit directory and
database permissions to the service user, and make encrypted backups with a
tested restore process. A stateless host or ephemeral filesystem will lose
workspaces, agents, policies, and session revocations.

## Required preflight checks

- Confirm `/api/health` reports `network: testnet`, `wallet: broadcast_disabled`,
  `walletBackend: zingo`, and `mode: disabled`.
- Build with `NEXT_PUBLIC_API_MODE=live npm run build`; run the production server
  behind HTTPS, not `next dev`.
- Confirm the Noir Wallet Testnet extension allows the exact HTTPS origin. The
  extension must report Testnet addresses; reject any mainnet or mixed account.
- In browser devtools, confirm wallet addresses, balances, activity, memos,
  keys, and viewing material never appear in `/api` request bodies, URLs, logs,
  analytics, or screenshots.
- Confirm `/demo` remains unavailable in live mode and that no fixture API is
  reachable from the Testnet deployment.
- Confirm logout invalidates the cookie server-side; a copied old cookie must
  then receive an unauthenticated response.

## Release blockers and limits

1. **Identity is demo-grade:** registration creates a new account and an
   eight-hour session, but there is no credential-based sign-in, recovery, or
   multi-device identity after logout/expiry. The smallest secure improvement is
   WebAuthn/passkeys with a public-key credential, relying-party ID bound to the
   HTTPS origin, signature-counter handling, session rotation/revocation, and a
   separately reviewed recovery path. Do not use a wallet address or transparent
   signature as identity proof for a shielded wallet.
2. **No payable merchant flow:** Noir Wallet SDK 0.1.9 lacks a server-verifiable
   proof of shielded receiving-address control. Invoice creation and settlement
   remain intentionally unavailable.
3. **No wallet execution:** signing, sending, broadcasting, transaction status
   lookup, and independent settlement verification are unavailable by design.
4. **Operational readiness remains incomplete:** production secret management,
   abuse/rate controls, monitoring/log redaction review, database backup/restore
   drill, dependency/security review, and an extension-origin approval need
   completion before public hosting.

## Submission checklist

- [ ] Use a desktop browser with the official **Testnet** Noir Wallet extension.
- [ ] Record the release SHA, exact frontend URL, health response, and extension
      version in the submission notes.
- [ ] Connect only a Testnet account; capture no wallet addresses, tokens,
      cookies, transaction IDs, seed words, keys, viewing keys, memos, balances,
      or history in screenshots.
- [ ] Show workspace creation, agent ownership, saved rules, policy expiration,
      and pause/resume persistence.
- [ ] Show the unavailable payment-request state and say why it is fail-closed.
- [ ] Show session logout and separate wallet disconnect.
- [ ] Use [the screenshot checklist](SUBMISSION_SCREENSHOT_CHECKLIST.md) and
      [the Testnet demo script](TESTNET_DEMO_SCRIPT.md).
- [ ] State all limitations above in the submission and demo narration.

## Truthful 2–3 minute demo sequence

**0:00–0:20 — Boundary.** Open Overview. Say: “VeilPay gives AI agents
permission to pay, not permission to overspend. This build is Testnet-only and
broadcast-disabled.” Point to the network/read-only status.

**0:20–0:45 — Wallet privacy.** Connect Testnet Noir Wallet. Say: “The extension
reports this wallet data directly to the browser. VeilPay cannot spend and does
not upload addresses, balances, history, memos, or keys.” Do not read sensitive
values aloud or capture them.

**0:45–1:35 — Account-owned agent and policy.** Create a workspace, then an
agent. Set a total budget, per-payment cap, allowed merchant identifiers, and a
policy expiry. Save, refresh, then pause or resume the agent. Say: “These are
server-enforced, account-scoped rules; wallet connection is not account
ownership.”

**1:35–2:05 — Fail closed.** Open Payment requests. Say: “No payable request is
created because this wallet SDK cannot prove merchant control of a shielded
receiver to the server. We refuse to fabricate an invoice, transaction, receipt,
or settlement.”

**2:05–2:30 — Revocation.** Log out from Safety & settings, then disconnect
Noir Wallet. Say: “Session authority and wallet observation are separate. This
release never signs, sends, or broadcasts.”
