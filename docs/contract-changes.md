# Contract notes against OpenAPI v1.2.0-draft

Flagged for review. The frontend does not change the backend API. `contracts/openapi.yaml` is synchronized to `feat/veilpay-backend-integration` at Milestone 3 `0d15902` (v1.2.0-draft); contract-sync tests read that file directly. The original `contract/openapi.v1.1.yaml` is historical, not byte-identical to the current spec.

## 1. Merchant has no list of incoming payments

v1.1 exposes `GET /payments/{paymentId}/verification`, so the merchant must already know the payment id.

- Frontend today: a lookup box plus ids handed over within the demo session. The mock client has a `merchantPaymentIds()` helper used only in mock mode for the demo; the live client never calls it.
- Proposal (v1.2, only if agreed): `GET /merchant/invoices/{invoiceId}/payments` returning the payment ids addressed to that invoice, merchant context only, same privacy rules as verification.
