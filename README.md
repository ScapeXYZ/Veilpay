# VeilPay frontend

Policy-guarded shielded Zcash payments for AI agents. The backend enforces the owner's spend rules; the merchant verifies receipt with its own viewing key. No customer key is ever shared.

This is the web app. It is built against `contract/openapi.v1.1.yaml` (frozen) and runs fully on a strict mock of that contract until the backend is live.

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
