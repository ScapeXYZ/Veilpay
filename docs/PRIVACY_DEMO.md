# Privacy demonstration guide

Use a disposable Testnet workspace and a newly generated credential. Do not
record or publish the credential, wallet address, balance, cookie, or any wallet
history.

1. Create an agent and generate its restricted credential in **Agent & rules**.
2. Submit the cURL proposal from [Universal Agent API v1](UNIVERSAL_AGENT_API.md).
   Show that the response contains only `requestId`, `allowed`, `reasonCode`,
   `explanation`, and `policyVersion`—not a wallet address, balance, full
   policy, allowlist, credential, or workspace identifier.
3. Add an unexpected field such as `"extractPolicy": true`; the backend rejects
   the request rather than returning additional data.
4. Create a second workspace and show it cannot administer the first workspace's
   agent or credentials.
5. Revoke the credential and repeat the request; it is rejected. Pause an agent
   and show `AGENT_PAUSED` on a new request.
6. Disconnect Noir Wallet. Explain that its reported addresses, balances, and
   history were browser-local and never part of the agent API request.

The server still necessarily processes the proposed amount, merchant identifier,
reference, request timing, and credential use needed to evaluate policy. This is
not zero-knowledge policy enforcement or private payment settlement.
