# Privacy audit — Testnet branch

Reviewed: Rust routes/responses, SQLite schema, browser storage and wallet adapter, agent API, error paths, frontend network client, Render container, and automated tests.

## Data inventory

| Data | Stored/transmitted | Access | Retention/status |
| --- | --- | --- | --- |
| Workspace display name/type | SQLite; browser registration request | workspace owner/server | Render Free loss on restart; no deletion UI yet |
| Browser session verifier/CSRF | hashed session in SQLite; HttpOnly cookie and in-memory CSRF | browser/server only | eight-hour expiry or logout |
| Agent policy and status | SQLite; owner-admin API | owning workspace only | retained with agent |
| Credential verifier/hint/metadata | SHA-256 verifier and non-secret hint in SQLite | owner metadata API/server | expiry/revocation retained for enforcement |
| Agent proposal amount, merchant ID, reference | policy-evaluation activity SQLite | server and owning workspace storage; never agent response | owner can delete integration activity |
| Agent API replay payload | SHA-256 payload digest in idempotency table | server only | deleted with owner-directed activity deletion |
| Wallet addresses, balances, history, memos, keys | browser-local Noir Wallet observation only | browser extension/user | not sent to backend or agent API; cleared from component state on disconnect |

## Findings and remediation

1. **Agent response disclosed internal agent ID and detailed policy failure text.** Fixed: v1 responses omit agent IDs, policies, budgets, allowlists, and detailed threshold explanations. Denials are `AGENT_PAUSED` or generic `POLICY_DENIED`.
2. **Agent idempotency stored raw request JSON.** Fixed: v1 stores a SHA-256 digest solely to detect a changed replay. This is integrity metadata, not anonymization of merchant identifiers.
3. **No owner deletion path for evaluation activity.** Fixed: owners can delete an agent's stored integration activity and matching replay snapshots; credentials and revocation metadata remain so revocation stays effective.
4. **Database errors included driver text in server logs.** Fixed: errors emit only an allowlisted component/code label. Requests, authorization headers, credentials, wallet data, and raw bodies are not logged by application code.

## Residual risks

The backend necessarily processes proposal amount, merchant identifier, reference, timing, credential use, and policy data. SQLite is not encrypted by this application. Hashing a credential verifier protects against database disclosure of the bearer value; hashing a request replay payload does not anonymize a predictable merchant identifier. Render Free storage is ephemeral, so a restart loses policies, credentials, and revocations; this is not durable privacy or financial security. Production requires persistent encrypted storage, backup/restore, operational log controls, retention policy review, and stronger account recovery.

No third-party telemetry, analytics, or application-directed external data requests were found. Browser UI preferences are the only intended browser storage; session credentials stay HttpOnly and wallet observations are component memory only.
