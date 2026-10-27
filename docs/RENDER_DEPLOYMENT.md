# Render Free deployment

This Docker deployment runs the reviewed Next.js frontend and Rust/Axum API in
one **Render Free Web Service**. The only public listener is Next.js. Axum binds
to `127.0.0.1:4100`; its `/api` traffic is reached solely through the existing
same-origin Next.js rewrite.

This is a short-lived Testnet workspace demo. SQLite is stored in the container
at `/tmp/veilpay/veilpay-testnet.db`; Render Free removes local files on restart,
redeploy, and spin-down. It is deliberately not persistent storage. Accounts,
agents, policies, sessions, and revocations must be recreated after a restart.

## Render dashboard

1. Create **New > Web Service**, connect this repository, and select branch
   `main`.
2. Set **Language** to `Docker`; Render uses the repository-root `Dockerfile`.
   Leave Build Command and Start Command empty.
3. Select the **Free** instance type. Set the Health Check Path to
   `/api/health`.
4. After Render assigns the final HTTPS URL, set these environment variables.
   `FRONTEND_ORIGIN` must match the final origin exactly—no trailing slash.

```text
NETWORK=testnet
WALLET_BACKEND=zingo
VEILPAY_DEPLOYMENT_NETWORK=testnet
NEXT_PUBLIC_API_MODE=live
VEILPAY_PUBLIC_DEPLOYMENT=1
VEILPAY_BACKEND_URL=http://127.0.0.1:4100/api
BIND_ADDR=127.0.0.1:4100
DATABASE_URL=sqlite:///tmp/veilpay/veilpay-testnet.db
FRONTEND_ORIGIN=https://your-service.onrender.com
```

Do not set `WALLET_BACKEND=mock`, `NETWORK=regtest`, a public Axum URL, wallet
keys, wallet roots, or `VEILPAY_WALLET_ROOT`. The container refuses to start if
the security-critical settings above are missing or differ. It also refuses a
non-HTTPS or slash-suffixed `FRONTEND_ORIGIN`.

The image has no embedded secrets. If an optional operator-read token is ever
needed, add it only as a Render secret; it is not required for this demo.

## Validate after deploy

```bash
curl --fail --show-error https://your-service.onrender.com/api/health
curl --include --request POST https://your-service.onrender.com/api/session/demo
curl --include --request POST https://your-service.onrender.com/api/merchant/invoices
```

The health response must report `network: "testnet"`,
`wallet: "broadcast_disabled"`, `walletBackend: "zingo"`, and `mode: "disabled"`.
The two POSTs above must be unavailable (`405` at the Next.js boundary). In a
browser, register a workspace and verify the session cookie is `__Host-` prefixed,
`Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`. Confirm `/demo` is 404,
and that payment, invoice, signing, execution, and mock/simulation flows are not
publicly reachable.

Render Free can spin down after idle time and has an ephemeral filesystem. A
cold request can take about a minute, and all workspace state is disposable.
See [release readiness](RELEASE_READINESS.md) for the remaining operational
limits; this is not a durable production deployment.
