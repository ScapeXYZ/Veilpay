# Contract notes against OpenAPI v1.1

Flagged for review. Nothing here is implemented as a contract change; `contracts/openapi.yaml` on main remains authoritative and the frontend contract-sync suite reads it directly.

## 1. Merchant has no list of incoming payments

v1.1 exposes `GET /payments/{paymentId}/verification`, so the merchant must already know the payment id.

- Frontend today: a lookup box plus ids handed over within the demo session. The mock client has a `merchantPaymentIds()` helper used only in mock mode for the demo; the live client never calls it.
- Proposal (v1.2, only if agreed): `GET /merchant/invoices/{invoiceId}/payments` returning the payment ids addressed to that invoice, merchant context only, same privacy rules as verification.
