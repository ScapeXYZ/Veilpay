# Testnet feature status

## Implemented and usable

- A user may create a VeilPay Testnet workspace without connecting a wallet.
  A Noir Wallet connection is browser-local observation and never establishes
  backend account ownership.
- Authenticated users create, list, update, pause, and resume only their own
  agent records. Records are persisted in SQLite and scoped to the account that
  created them.
- Each agent has a persistent total budget, per-payment cap, approved merchant
  identifiers, request lifetime, optional policy expiration, and enabled state.
  The backend checks these rules; a past policy expiry denies new requests.
- Sessions use an HttpOnly cookie, Origin and CSRF checks for writes, and
  idempotency keys for POST operations. Logout revokes the server token before
  clearing the cookie. Expired/revoked tokens fail closed.
- Noir Wallet Testnet addresses, all wallet-reported balances, and sanitized
  activity are displayed locally. No balance, address, history, memo, seed, or
  viewing key is sent to the VeilPay backend.

## Deliberately unavailable

- A browser-provided shielded address cannot be enrolled as merchant-owned:
  Noir Wallet SDK 0.1.9 has no server-verifiable shielded-address proof.
- The live Testnet merchant invoice route fails closed. There is no payable
  invoice, payment request, policy-only placeholder invoice, transaction,
  receipt, or confirmed settlement generated in this mode.
- The `zingo` backend is `broadcast_disabled`; the application does not request
  signatures, send, broadcast, or inspect wallet keys.
- Policy approval is not owner approval and does not reserve a wallet balance,
  transmit funds, or settle an invoice.

## Demonstration path

1. Connect Noir Wallet to observe the user's Testnet wallet locally.
2. Create a VeilPay workspace, then an agent with explicit budget, cap, and
   approved merchants.
3. Update the rules, including a policy expiration, and pause/resume the agent.
4. Show the payment-request area is unavailable until a genuine, securely bound
   merchant receiver exists. This is intentional fail-closed behavior.
5. Disconnect Noir Wallet and/or log out of VeilPay to show the boundaries are
   independent.

Do not claim a shielded payment, a merchant invoice, or independent settlement
verification in this demonstration.
