# VeilPay frontend

Policy-guarded shielded Zcash payments for AI agents. The backend enforces the owner's spend rules; the merchant verifies receipt with its own viewing key. No customer key is ever shared.

This is the web app. `contracts/openapi.yaml` is the source of truth; contract-sync tests read that file directly. It is synchronized to `feat/veilpay-backend-integration` at `e078d469ff4b8a62fae48dfbef958ab83d585438` (SHA-256 `aae662cac11a88e2f551ef94e139fe49dd2d45b7f81d97d614f447082a76254d`). `contract/openapi.v1.1.yaml` remains the historical reviewed snapshot, not the current contract. The default is an explicitly simulated backend, not real payments. Live mode consumes Temi's backend; the current built-in adapter cannot broadcast, and independent merchant verification for non-mock payments is not implemented. The frontend never executes wallet logic or computes confirmation status.

## Run

```
npm ci
npm run dev      # http://127.0.0.1:3100, mock mode
npm run check    # typecheck + lint + tests + build
```

## Modes

| `NEXT_PUBLIC_API_MODE` | What it does |
|---|---|
| `mock` (default) | In-process mock of v1.1. Persistent MOCK banner, `MOCK` tag on every card, no txids, verification says `mock`. Never presents fabricated chain data as real. |
| `live` | Browser calls same-origin `NEXT_PUBLIC_API_BASE` (`/api`), proxied server-side to `VEILPAY_BACKEND_URL`. Real vs mock comes from `/health.mode`. |

Testnet only. Demo sessions are role isolation (customer / merchant), not authentication.

## Layout

- `src/lib/contract/` zod schemas mirroring the spec, plus a contract-sync test against the YAML
- `src/lib/api/` `ApiClient` interface, live client (cookie + CSRF + Idempotency-Key), mock client + fixtures
- `src/lib/present.ts` status/violation/failure copy and the display rules (operator review, reconciling, ack gate)
- `src/app/` Overview (blocked-agent opener), Agent policy, Payments (timeline), Merchant (verification), Privacy lens
- `docs/contract-changes.md` contract notes flagged for review, not implemented
- `docs/screenshots/` desktop + mobile captures

# Integration and review

Temi owns backend policy enforcement, wallet execution, invoice APIs, and merchant verification. No backend code or wallet scripts are executed by the frontend checks. Start the backend separately, then build the frontend with `NEXT_PUBLIC_API_MODE=live` and `VEILPAY_BACKEND_URL` set in the process environment. The backend URL must be an origin, without a trailing slash; the browser calls same-origin `/api/*`.

The first release remains testnet only. Merchant payment discovery is not in the current contract: live users must provide a payment ID to verify. Merchant invoice detail is polled via `GET /merchant/invoices/{id}`. Mock-only shortcuts are never used by the live client. Mock invoices and nonspendable `paymentPayload` values never generate a Zcash URI or QR. A real request requires an open, unexpired invoice, a positive protocol-bounded amount, a live testnet source, and a Sapling testnet address with a valid Bech32 checksum, padding and 43-byte receiver. Unified and transparent addresses currently fail closed; a prefix match is never enough. Address validation checks encoding, not ownership. Sharing a request is not evidence of payment. Unknown, mock and broadcast-disabled data sources have explicit warnings. Unknown/pending wallet operations and operator-review flags override contradictory payment status labels and never offer execution/resend actions.

This PR requires joint review before merge. Real wallet execution, production deployment, and end-to-end backend integration remain separate verification steps.
