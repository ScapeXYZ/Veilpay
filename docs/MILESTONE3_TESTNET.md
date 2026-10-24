# Milestone 3: manual Zcash testnet integration

This is an operator procedure, not an automated development/test script. None of
the wallet commands below were run during this implementation. Existing wallets
and funds are prerequisites; this guide does not create or fund wallets. Mainnet
is refused. Do not run preparation or submission until deliberately choosing to
spend testnet funds. Both require their own exact typed terminal confirmation.

## Verified source and patches

The immutable source revision is
`6d43e7c48343cc39cf99bad7e05349baaf4f0b90` from
[zingolib](https://github.com/zingolabs/zingolib/tree/6d43e7c48343cc39cf99bad7e05349baaf4f0b90).
The verified command definitions are in
[zingo-cli/src/commands.rs](https://github.com/zingolabs/zingolib/blob/6d43e7c48343cc39cf99bad7e05349baaf4f0b90/zingo-cli/src/commands.rs)
and flags in
[zingo-cli/src/lib.rs](https://github.com/zingolabs/zingolib/blob/6d43e7c48343cc39cf99bad7e05349baaf4f0b90/zingo-cli/src/lib.rs).

`send ADDRESS ZAT` creates a proposal and returns its fee. The proposal lives in
memory. `calculate` signs/builds from that proposal; `confirm` would build and
broadcast. `transmit TXID` sends calculated transactions. VeilPay never uses
`confirm`, `quicksend`, bare `transmit`, or invented upstream flags.

The new `zingo-structured-transport.patch` changes existing balance/history
commands to use existing JSON conversions and adds Orchard receiver data from
merchant-decrypted notes. Orchard-only addresses are reconstructed using the
actual note recipient, not guessed from an address index, memo, amount, or sender.
It adds an explicit offline-only `VEILPAY_MACHINE=1` stdin protocol for existing
`send`, `calculate`, and `quit` commands. No other commands are allowed by that
protocol. It keeps the proposal alive until the fee gate passes. There are no
new Zingo CLI flags. The existing waitsync patch remains required.

The patch adds `veilpay_schema: 1`, local wallet network, tip/scanned heights,
transaction summaries, and received Orchard outputs to `transactions`. Raw
history may include memos and stays inside the transport; API responses contain
only matching invoice evidence. Unknown/malformed responses fail closed.

Install the two patches with the existing installer (builds public code and
replaces binaries, without opening or creating wallets):

```bash
cd /home/temitope/veilpay
umask 077
export VEILPAY_WALLET_ROOT="${VEILPAY_WALLET_ROOT:-$HOME/.local/share/veilpay-testnet}"
bash scripts/install-testnet-wallet.sh
```

The installer now uses a fresh source directory by default and refuses an old
source directory lacking its exact revision marker. To choose a clean directory:

```bash
VEILPAY_WALLET_SOURCE=/tmp/veilpay-zingo-m3-reviewed bash scripts/install-testnet-wallet.sh
```

Keep the existing `customer/` and `merchant/` wallet directories. The transport
requires `zingo-wallet.dat` to exist and be owner-only, distinct canonical role
directories, source/patch markers, and matching CLI/proxy binary checksums. It
shares the root `sync.lock` with the existing sync helper. Close any separately
launched CLI; processes that bypass this lock are unsupported. Recovery files are
not read by the new transport. Do not invoke provisioning or recovery commands.

## Configure and inspect without spending

Use a private directory and database outside the repository. This example uses
the existing private wallet root, whose directory permissions must be 0700.
The live backend refuses a relative database path, a repository database, a
non-private database parent/file, or a symlinked database file.

```bash
export NETWORK=testnet
export WALLET_BACKEND=zingo-cli
export DATABASE_URL="sqlite://$VEILPAY_WALLET_ROOT/veilpay-testnet.db"
export FRONTEND_ORIGIN=http://localhost:3000
cargo build --locked --manifest-path backend/Cargo.toml --bins
backend/target/debug/veilpay-testnet sync customer
backend/target/debug/veilpay-testnet sync merchant
backend/target/debug/veilpay-testnet balance customer
backend/target/debug/veilpay-testnet balance merchant
```

Sync validates `info.chain_name=test`, uses the pinned testnet server, runs
`--waitsync transactions`, and requires scanned height to equal tip. Balance is
an offline query. These open existing wallets but never sign or broadcast. A cold
sync can exceed the transport's 180-second deadline; use the documented existing
sync procedure first if needed, then retry a read-only sync. Never solve a timeout
by rerunning a preparation or submission.

Start the backend in a separate terminal with the same environment:

```bash
backend/target/debug/veilpay-backend
```

HTTP can derive invoice addresses and observe wallets, but cannot sign or spend.
Health reports `mode=testnet_manual` and `wallet=operator_required`. Both testnet
wallets remain independent; the backend does not import one wallet's viewing
material into the other.

## Create one invoice and stage one request

The following commands use only demo authentication, suitable for a local testnet
review. Use a configured HTTPS deployment for browser Secure cookies. Curl's local
cookie files and JSON responses are stored under the private root. Never publish
them. This does not request funds or submit a transaction.

```bash
export REVIEW_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl --fail-with-body --silent --show-error -c "$VEILPAY_WALLET_ROOT/merchant-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H 'Content-Type: application/json' \
  --data '{"context":"merchant"}' http://localhost:4000/api/session/demo \
  > "$VEILPAY_WALLET_ROOT/merchant-session.json"
curl --fail-with-body --silent --show-error -c "$VEILPAY_WALLET_ROOT/customer-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H 'Content-Type: application/json' \
  --data '{"context":"customer"}' http://localhost:4000/api/session/demo \
  > "$VEILPAY_WALLET_ROOT/customer-session.json"
export MERCHANT_CSRF="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["csrfToken"])' "$VEILPAY_WALLET_ROOT/merchant-session.json")"
export CUSTOMER_CSRF="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["csrfToken"])' "$VEILPAY_WALLET_ROOT/customer-session.json")"
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/merchant-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H "X-CSRF-Token: $MERCHANT_CSRF" \
  -H "Idempotency-Key: m3-invoice-$REVIEW_ID" -H 'Content-Type: application/json' \
  --data '{"reference":"M3 review","amountZat":"100000"}' \
  http://localhost:4000/api/merchant/invoices > "$VEILPAY_WALLET_ROOT/invoice.json"
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/customer-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H "X-CSRF-Token: $CUSTOMER_CSRF" \
  -H "Idempotency-Key: m3-agent-$REVIEW_ID" -H 'Content-Type: application/json' \
  --data '{"name":"M3 review","policy":{"perTxLimitZat":"100000","totalBudgetZat":"100000","allowedMerchantIds":["mer_demo"],"requestTtlSeconds":3600}}' \
  http://localhost:4000/api/agents > "$VEILPAY_WALLET_ROOT/agent.json"
python3 - <<'PY'
import json, os
from pathlib import Path
root = Path(os.environ['VEILPAY_WALLET_ROOT'])
invoice = json.loads((root / 'invoice.json').read_text())
agent = json.loads((root / 'agent.json').read_text())
(root / 'request.json').write_text(json.dumps({'agentId': agent['id'],
    'invoiceId': invoice['id'], 'amountZat': invoice['amountZat'], 'reference': 'M3 review'}))
PY
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/customer-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H "X-CSRF-Token: $CUSTOMER_CSRF" \
  -H "Idempotency-Key: m3-request-$REVIEW_ID" -H 'Content-Type: application/json' \
  --data-binary "@$VEILPAY_WALLET_ROOT/request.json" \
  http://localhost:4000/api/payments/request > "$VEILPAY_WALLET_ROOT/payment.json"
export PAYMENT_ID="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$VEILPAY_WALLET_ROOT/payment.json")"
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/customer-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H "X-CSRF-Token: $CUSTOMER_CSRF" \
  -H "Idempotency-Key: m3-execute-$REVIEW_ID" -H 'Content-Type: application/json' \
  --data '{}' "http://localhost:4000/api/payments/$PAYMENT_ID/execute"
```

Retain the same `REVIEW_ID` when replaying the same intent. Do not generate new
keys to retry an ambiguous operation. Confirm that the invoice says `testnet`,
`zip321`, and `spendable=true`. Demo `veilpay-mock:` payloads are never spendable.
The staged operation should require operator confirmation; no transaction has
been signed or broadcast by these HTTP calls.

## Explicit preparation and submission

These are the only spending-related steps. Run them individually in an operator
terminal, never in CI or an unattended script. Close any other process using the
wallet. The app's reconciler uses the same nonblocking wallet lock; a lock conflict
fails closed. A failed claimed operation is not automatically retryable.

```bash
backend/target/debug/veilpay-testnet review "$PAYMENT_ID"
backend/target/debug/veilpay-testnet prepare "$PAYMENT_ID" 100000
```

Review the testnet destination, exact 100000-zatoshi principal and maximum fee of
100000 zatoshis. Type the exact `PREPARE TESTNET ... MAX_FEE ...` line displayed by
the tool. It proposes offline, checks the actual fee, signs/builds via `calculate`,
saves via `quit`, and stores the actual txid and fee durably. It does **not**
transmit. The persisted signed transaction is inspected offline for the expected
recipient, amount, fee, and output pools. Extra recipients/donations, unknown fees,
and unsupported outputs are refused before submission. A signed transaction that
fails validation must never be transmitted manually. A fee above the ceiling is
rejected before `calculate`. Principal policy
budgets exclude the separately approved fee; total wallet debit includes both.

To deliberately authorize this one testnet broadcast:

```bash
backend/target/debug/veilpay-testnet submit "$PAYMENT_ID"
```

Review the exact txid, address, principal, and actual fee. Type the distinct
`BROADCAST TESTNET ... FEE ...` line. The tool commits its single submission claim
before invoking `transmit TXID`. Piped confirmation is refused. A timeout, process
failure, or crash leaves an ambiguous operation and held reservation. Do not call
Zingo `transmit`, `confirm`, `quicksend`, or recalculate manually to recover it.
Use read-only observations and operator review; VeilPay deliberately offers no
resend/reset route. A policy change, pause, or expiry before either manual action
blocks it; staged/signed reservations remain held for operator review.

## Independent verification and acknowledgment

After submission, wait for normal reconciliation and three confirmations. Poll:

```bash
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/customer-cookie.txt" \
  "http://localhost:4000/api/payments/$PAYMENT_ID"
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/merchant-cookie.txt" \
  "http://localhost:4000/api/payments/$PAYMENT_ID/verification"
```

Verification syncs the independent merchant wallet. It requires the actual
Orchard receiver, exact amount, expected txid, correct network, completed scan,
and three confirmations. Pending/unseen/expired/underpaid/overpaid/duplicate/
conflicting/reorged states are not successful receipts. No raw history or private
viewing material is returned. An unknown expected txid cannot be acknowledged.

Only after verification reports received/late with sufficient depth:

```bash
curl --fail-with-body --silent --show-error -b "$VEILPAY_WALLET_ROOT/merchant-cookie.txt" \
  -H "Origin: $FRONTEND_ORIGIN" -H "X-CSRF-Token: $MERCHANT_CSRF" \
  -H "Idempotency-Key: m3-ack-$REVIEW_ID" -H 'Content-Type: application/json' \
  --data '{}' "http://localhost:4000/api/payments/$PAYMENT_ID/acknowledgment"
```

The HMAC authenticates a merchant statement, not a publicly verifiable settlement
proof. A lost/moved receipt or reduced confirmation depth can invalidate current
reliance on that statement. Its signature and same-key API replay remain immutable
historical evidence; consult fresh verification for validity. Reorg recognition
uses synchronized wallet observations, not an independently verified header chain.
The pinned CLI does not expose a trusted per-receipt block hash in this integration.

## Offline review evidence

The source patch compiled with:

```bash
cargo +stable check --locked --manifest-path /tmp/veilpay-m3-source/zingo-cli/Cargo.toml --lib --target-dir /tmp/veilpay-wallet-build/target --jobs 2
```

That directory contains only the downloaded public source; no wallet command was
executed. Backend tests run synthetic JSON and a synthetic Python CLI executable,
with dummy marker files rather than real wallets. They test real process argument
construction and fee gating without network access or funds. Live sync, signing,
submission, and receipt compatibility remain untested in this development run.
