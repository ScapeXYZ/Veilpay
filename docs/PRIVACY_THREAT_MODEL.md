# Privacy threat model — Testnet submission

## Assets and boundaries

| Asset | Boundary | Current control |
| --- | --- | --- |
| Noir wallet seed, spending key, and viewing key | Wallet extension only | VeilPay does not request, store, log, or transmit them. |
| Wallet address, balances, history, and memo | Browser-local observation | The adapter sanitizes display data and never posts it to the backend. Memos are never rendered. |
| VeilPay account and agent records | Rust API and SQLite | Account-scoped records, server-side ownership checks, CSRF, Origin checks, idempotency, and session expiry/revocation. |
| Merchant receiver | Not enrolled in live mode | Invoice issuance is fail-closed; arbitrary addresses cannot become payable destinations. |

## Threats and mitigations

- **Wallet connection mistaken for account ownership:** workspace registration is
  separate; wallet observation grants no backend authority.
- **Cross-account reads or writes:** record lookup verifies owner; wrong-role or
  unknown records fail without returning another account's data.
- **Stolen/replayed browser session:** tokens are random, stored as hashes,
  HttpOnly, SameSite=Strict, server-expiring, and explicitly revocable. State
  changes require exact Origin and session CSRF token.
- **Agent overspend:** total budget, per-payment cap, merchant allow-list,
  paused state, policy expiration, and request expiration are evaluated on the
  server. A client cannot turn an allow result into execution.
- **Address substitution:** not mitigated by a sufficient ownership proof in
  the installed SDK, so live merchant receiving is disabled rather than guessed.
- **Sensitive browser storage:** only non-financial UI preferences are allowed;
  session, payment, wallet, and key values are excluded.
- **Network mixing:** backend database binds to a network; adapter/network
  mismatch fails startup. Browser address/network checks refuse mismatches.

## Residual risks and non-claims

The backend does not independently verify shielded settlement, and wallet
activity is wallet-reported rather than independent blockchain proof. Testnet
does not remove the need for production authentication, abuse controls, audit
logging design, an address decoder, a receiving-only observer, or a reviewed
merchant ownership primitive. See `merchant-receiving-architecture.md`.
