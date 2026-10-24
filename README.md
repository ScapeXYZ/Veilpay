# VeilPay frontend

Policy-guarded shielded Zcash payments for AI agents. The backend enforces the owner's spend rules; the merchant verifies receipt with its own viewing key. No customer key is ever shared.

This is the web app. `contracts/openapi.yaml` on main is the source of truth; contract-sync tests read that file directly. `contract/openapi.v1.1.yaml` is the original reviewed snapshot (currently byte-identical). The default is an explicitly simulated backend, not real payments. Live mode consumes Temi's backend; the frontend never executes wallet logic or computes confirmation status.

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

The first release remains testnet only. Merchant payment discovery is not in the current contract: live users must provide a payment ID to verify. Mock-only shortcuts are never used by the live client. QR requests use only the backend-provided address and decimal ZEC amount; sharing one is not evidence of payment. Unknown or mock data sources carry a demo warning.

This PR requires joint review before merge. Real wallet execution, production deployment, and end-to-end backend integration remain separate verification steps.
