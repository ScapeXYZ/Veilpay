# VeilPay public-testnet integration

Working baseline: `e0c6402`. Deadline: 2026-10-28. OpenAPI remains v1.1.

## Compatibility decision, checked 2026-10-23

Use zingolib source revision `6d43e7c48343cc39cf99bad7e05349baaf4f0b90`.
[Upstream NU7 PR #2878](https://github.com/zingolabs/zingolib/pull/2878)
merged on October 9. It pins `zcash_protocol = 0.11.0-pre.0` and
`zcash_client_backend = 0.25.0-pre.1`, recognizes public-testnet NU7 at
height 4,465,026, and uses branch ID `77190ad9`. Its author tested sync
across activation, explicitly leaving a funded send untested. VeilPay must
establish send compatibility with an actual approved transaction.

The latest published zingolib tag queried from GitHub is `zingolib_v7.0.0`
(October 15), with no downloadable CLI assets. This run uses the exact NU7
merge revision above instead of a moving branch.

Zallet's latest published release queried from GitHub is `v0.1.0-beta.3`
(August 26). Its root and Zebra-backend lockfiles pin `zcash_protocol 0.10.5`
from librustzcash revision `1f6bb2072e7fcb142b0d90ff7b267a8699a84818`,
which predates the NU7 cohort. The current [Zallet changelog](https://github.com/zcash/zallet/blob/main/CHANGELOG.md)
also removes its Zaino backend and requires a local Linux Zebra read-state
backend. Do not install beta.3 merely because it is tagged "latest".

The Valar faucet pins [zecd 0.9.0-rc1](https://github.com/zecrocks/zecd/releases/tag/v0.9.0-rc1)
as its NU7-ready wallet. It is a fallback candidate. OpenAPI v1.1 does not
include `zecd` in `Health.walletBackend`; never mislabel it as Zallet.

## Prerequisites and reproducible commands

Verified machine: Linux x86_64, Rust/Cargo 1.99.1, CMake, Clang,
`pkg-config`, `protoc`, curl with HTTP/2. The source pins Rust 1.99.0;
`cargo +stable` selects the installed 1.99.1 toolchain explicitly.
Build jobs are limited to two per package for this machine's 8 GiB RAM.

## Sync timeout fix, checked 2026-10-24

Keep the NU7 revision above and apply the repository's
`scripts/patches/zingo-waitsync.patch` through the installer. The customer
wallet was already scanned through 4,533,936 after the reported timeout.
A diagnostic copy resumed, reached 4,533,982 in seconds, and continued
scanning newly mined blocks instead of exiting under `--waitsync`.

The pinned CLI applies `shutdown_on_completion = waitsync` only to newly
created wallets. `WalletConfig::Read` loads the existing wallet's saved
continuous-sync configuration, so `await_sync()` waits indefinitely even
after it has caught up. A subsequent transient RPC failure then appears
to be an initial synchronization failure. The original failing RPC cannot
be identified from the supplied error alone.

The patch uses zingolib's existing `sync_to_tip_and_await()` for the wait
path. That method overrides completion for one session and preserves the
stored settings. Sync failures return a failing process status. Existing
addresses, birthday, and recovery data are retained.

Relevant pinned source:
[CLI startup](https://github.com/zingolabs/zingolib/blob/6d43e7c48343cc39cf99bad7e05349baaf4f0b90/zingo-cli/src/lib.rs),
[one-shot sync](https://github.com/zingolabs/zingolib/blob/6d43e7c48343cc39cf99bad7e05349baaf4f0b90/zingolib/src/lightclient/sync.rs),
[RPC bounds](https://github.com/zingolabs/zingolib/blob/6d43e7c48343cc39cf99bad7e05349baaf4f0b90/zingo-netutils/src/time.rs).
Ordinary sync RPCs have a 10-second deadline, heavy RPCs 20 seconds, and
stream messages 15 seconds. These constants have no CLI timeout override.
The approximately 18-minute session duration is not a global sync timeout.
The exposed settings are performance, minimum confirmations, and transparent
discovery gap limit. Reducing discovery can miss funds and is unnecessary.

Sync uses clearnet. Nym starts for connected sessions and also participates
in server selection, while send and price fetch use the mixnet. Disabling
or replacing Nym does not fix the loaded-wallet completion bug.

Read-only endpoint checks found `testnet.zec.rocks:443` on branch
`77190ad9` at height 4,533,982 with responsive subtree-root RPCs. The
upstream-listed `zaino.testnet.unsafe.zec.rocks:443` returned HTTP 503,
`lwd.testnet.zec.pro:443` returned HTTP 521, and
`testnet.lightwalletd.com:9067` failed DNS. Retain the working server.
These are time-specific observations, not permanent server assessments.

After installing the patched CLI, synchronize the existing wallet with:

```bash
python3 scripts/sync-testnet-wallet.py customer
```

Close any other process using that wallet first. The helper requires an
existing wallet, copies its directory into an owner-only backup under the
wallet root, and checks the sync result for complete output scanning. It
verifies receiving-address and recovery files remain byte-identical. Raw
diagnostic logs remain private under the wallet root. Rerunning resumes
saved progress. The command performs no funding or transaction submission.

Live regression: the patched CLI synchronized the diagnostic copy through
4,533,988, reported 100% block/output scanning, saved, and exited zero.
The installed patched binary then synchronized the actual customer wallet
through 4,533,989 with 100% scanning and a clean exit. Offline comparison
confirmed the actual wallet-derived addresses matched the pre-sync backup.
Receiving-address and recovery files remained byte-identical. The original
binary is retained as `bin/zingo-cli.before-waitsync-fix` under the wallet
root. The helper printed the private backup and log locations. Only the
wallet CLI was rebuilt. Shell/Python syntax and patch reapplication checks
passed. No funds were requested or transactions submitted.

```bash
cd /home/temitope/veilpay
pkg-config --modversion sqlite3 openssl
python3 scripts/zcash-testnet-probe.py
bash scripts/install-testnet-wallet.sh
python3 scripts/provision-testnet-wallets.py
```

If build prerequisites are missing on Ubuntu:

```bash
sudo apt-get install build-essential clang cmake pkg-config libsqlite3-dev libssl-dev curl
```

The installer uses `cargo install --path ... --locked` for each binary.
An initial workspace build fetched unrelated test infrastructure through
workspace dev dependencies; installing the packages directly avoids that
build path. Normal CLI online mode requires the separate `nym-proxy`
next to `zingo-cli`. Offline address creation needs only the CLI.

The pinned upstream lockfiles warn about yanked `chacha20 0.10.1` and
Windows-only `clipboard-win 5.4.1`. The former was replaced upstream by
0.10.2 for an SSE4.1 instruction in the SSE2 backend. This run preserves
the source lockfiles; these are recorded build warnings, not ignored
backend Clippy failures. Review/update the wallet pin before production.

## Wallet custody

### Faucet receiver compatibility, checked 2026-10-23

Fastest funding route: the existing customer wallet already owns transparent
testnet address `tmPxCenDXLM41pb1VYU1XtcRpgqz8e23tPL` (account 0, index 0).
Retrieve it locally with this exact non-spending command, after closing other
processes using the customer wallet:

```bash
"${VEILPAY_WALLET_ROOT:-$HOME/.local/share/veilpay-testnet}/bin/zingo-cli" \
  --chain testnet --offline \
  --data-dir "${VEILPAY_WALLET_ROOT:-$HOME/.local/share/veilpay-testnet}/customer" \
  t_addresses
```

The two Orchard-only Unified Addresses are expected: the pinned spending
wallet defaults to an Orchard-only UA, and `provision-testnet-wallets.py`
explicitly adds another with `new_address o`. The `addresses` command lists
Unified Addresses. Its `has_transparent: false` describes each UA's receiver
set, while `t_addresses` lists the wallet's separate transparent addresses.

Installed CLI reports `Zingo CLI 0.1.1`; its source-revision marker matches
`6d43e7c48343cc39cf99bad7e05349baaf4f0b90`, and both installed binaries match
the recorded SHA-256 checksums. Installed help and pinned source agree:

| Command | Result |
| --- | --- |
| `new_address o` | Orchard-only UA |
| `new_address z` | Sapling-only UA, encoded as `utest1...` |
| `new_address oz` | UA containing Orchard and Sapling receivers |
| `t_addresses` | Existing standalone transparent addresses |
| `new_taddress` | New transparent address, subject to the unused-address guard |

An offline copy of the existing customer wallet successfully generated a
Sapling-only UA at index 2 and persisted it across CLI restarts. This proves
Sapling derivation is available in this wallet. The original wallet has not
been given that new address. If a Sapling receiver is desired later, back up
the existing wallet and run the same command above replacing `t_addresses`
with `new_address z`. This produces a Unified Address carrying Sapling,
rather than a standalone `ztestsapling...` string.

On the diagnostic copy, `new_taddress` refused because the latest transparent
address has received no funds. Reuse index 0. Avoid `new_taddress_allow_gap`,
which bypasses the seed-recovery discovery guard.

The [faucet worker](https://github.com/valargroup/valar-testnet-faucet/blob/main/internal/faucet/worker.go)
maps zecd RPC errors -5 and -8 to "the wallet cannot pay this address".
This identifies a sender-side address/payment rejection, but the public
message suppresses the underlying RPC detail. Orchard-only compatibility is
the leading explanation, not a proven exact zecd failure. Advertising Unified
Address support does not establish support for every receiver combination.
The existing transparent address avoids that receiver-selection ambiguity.
At this check, read-only `/api/status` reported ready, testnet, wallet synced,
height 4,534,023, payout 0.125 TAZ, and cap remaining 14.25 TAZ.

Faucet acceptance and receipt remain untested. No faucet claim or transaction
was submitted. Both original wallet files, receiving-address metadata, and
recovery files remained byte-identical throughout diagnostics. Diagnostic
copies and raw output are owner-only under `/tmp/veilpay-address-diagnostic-*`
and contain private wallet material. Preserve their confidentiality.

Retain the current customer and merchant wallets and the patched binary for
the October 28 demo. If the transparent address is also rejected, obtain the
underlying -5/-8 error from the faucet operator or arrange a direct testnet
transfer from an NU7-capable funded wallet to this existing receiver. These
are future operator actions requiring separate authorization. A new wallet
or seed migration adds work without addressing the demonstrated faucet-side
rejection.

Local root: `~/.local/share/veilpay-testnet`, mode 0700, outside Git.
Separate `customer/` and `merchant/` directories hold independent seeds.
`recovery-private.json` and `provision-private.log` are sensitive local
files. Never paste them into chat, commit them, or run recovery commands
without redirecting output into owner-only files. Back up the entire root
securely before funding. Provisioning prints public receiving addresses
only and never requests funds or sends a transaction.

## Live observations

At 2026-10-23 21:03:31 UTC, direct gRPC calls to
`https://testnet.zec.rocks` returned:

- network `test`, consensus branch `77190ad9`
- latest block height 4,533,664
- lightwalletd `v0.5.4`, backing node `v7.0.0+git.e8db87e`

The same probe queried the [Valar faucet status](https://faucet.testnet.valargroup.dev/api/status):
ready, wallet synced, height 4,533,664, payout 0.125 testnet ZEC,
remaining daily global cap 13.75. Status is an observation, not a payout
guarantee. Re-run the probe for current values.

The [faucet API source](https://github.com/valargroup/valar-testnet-faucet/blob/main/internal/web/server.go)
accepts `POST /api/claim` with `{"address":"utest1..."}`, returns an opaque
claim ID, and supports `GET /api/claim/{id}`. Its published limits are one
0.125 payout per IP/address per rolling 24 hours. No claim has been made
by this integration run. Requesting a payout triggers an on-chain send,
so it also waits for user approval.

## Evidence needed for the first payment

Record the actual wallet-returned txid, current best-chain block hash and
height, confirmation count from a live chain source, and the merchant
wallet's independently decrypted incoming amount and receipt. An explorer
can establish transaction inclusion and shielded transaction structure;
shielded recipient and amount verification requires the merchant's local
viewing capability. Never publish viewing/spending keys to demonstrate it.

Every real send must have a durable operation row committed before wallet
submission. An ambiguous timeout/crash holds the budget reservation and
remains unknown until a read-only reconciliation finds evidence. It must
never trigger another send. Operator approval must identify the concrete
network, destination, amount, and fee before broadcast.
