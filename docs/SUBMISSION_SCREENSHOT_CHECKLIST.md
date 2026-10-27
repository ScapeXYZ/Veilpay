# Submission screenshot checklist

- Overview: Testnet / broadcast-disabled status and the local Noir Wallet card.
- Overview or Agent & rules: an authenticated user-owned agent and saved policy
  values, with no invented wallet or payment totals.
- Spending rules: total budget, cap, approved merchant IDs, policy expiration,
  and pause/resume control.
- Payment requests: the explicit unavailable state explaining that a genuine
  merchant receiver is required; no mock invoice or payment row.
- Wallet & privacy: Testnet label, wallet-reported data only, no memo display.
- Safety & settings: session logout/revocation control.

Before capture, inspect the browser network panel: wallet data must not appear
in requests to `/api`, and no signing/send/broadcast call may occur. Do not put
addresses, cookies, tokens, transaction IDs, wallet history, or private keys in
screenshots.
