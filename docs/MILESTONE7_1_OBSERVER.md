# Milestone 7.1: isolated mainnet viewing-wallet observer

## Implemented foundation

`backend/src/observer.rs` defines a local Unix-domain-socket protocol for a separate observer process. The VeilPay process sends only a versioned `snapshot` request and a local IPC token; it receives a bounded JSON line containing a sanitized mainnet snapshot. The observer client rejects non-absolute sockets, empty/oversized tokens, insecure parent directories, connection/write/read timeouts, process failures, malformed JSON, unsupported versions, stale/future timestamps, non-mainnet data, contradictory scan/chain heights, malformed balances, invalid Orchard-capable addresses, and mismatched parsed history.

`ObserverWallet` implements the existing `WalletAdapter` only for `read_only_snapshot`. Its submit path is conclusively `BroadcastDisabled`, observation is `Unknown`, and it has no prepare/transmit/key APIs. It is not configured from HTTP and does not weaken operator-token authentication on `/api/operator/mainnet/read-only`.

## Mock-only status

The protocol and validation fixtures are mock-only. No observer daemon, viewing key, wallet database, binary, node, lightwallet server, or chain connection was started. The current application does not automatically construct `ObserverWallet`; production configuration must be reviewed separately.

## Custody and isolation

An eventual observer must receive only an operator-provisioned UFVK/UInVK through a private root-owned configuration mechanism. It must reject seeds, spending keys, and ZIP-32 spending material before parsing. Run it under a dedicated non-login account, with a private `0700` runtime directory, a Unix socket accessible only to the VeilPay service group, no public listener, read-only code/data mounts, and egress allowlisted only to approved chain/lightwallet sources. Viewing keys are sensitive: they reveal received shielded transactions and wallet activity to the observer; they do not authorize spending. Never log them, return them through IPC/HTTP, or bundle them into frontend code.

## Real scanning dependency and blocker

The intended official dependency surface is `zcash_client_backend::data_api::chain::scan_cached_blocks` for compact-block trial decryption and note discovery, `zcash_client_backend::data_api::WalletRead` for persisted wallet summaries, and the unified viewing-key types (`UnifiedIncomingViewingKey` or the operator-approved full viewing-key form) for Orchard-capable scanning. The `orchard` feature of `zcash_client_backend` is required. That crate also contains transaction-construction modules, so a live adapter requires a separately reviewed observer binary that compiles only the scanning/data API surface, persists its own wallet state outside this repository, and proves its build provenance. This milestone intentionally does not link librustzcash or accept a real key.

Independent chain evidence remains unavailable. A future independent observer must validate tip height and block hash from pinned sources; chain inclusion alone cannot prove that a shielded output belongs to this viewing wallet. `chainEvidence.trusted` remains false.

## Attribution and remaining blockers

The database has no agent-to-wallet binding. A shared observer balance or observation must never be presented as an agent balance. Remaining blockers are observer daemon review, viewing-key custody, full ZIP-316 decoding, pinned chain source validation, reorg handling, process attestation, production authentication, and explicit operator controls. No signing, preparation, or broadcasting is enabled.

## Validation

All checks used mock fixtures only. `cargo fmt --check` and `WALLET_BACKEND=mock cargo clippy --all-targets -- -D warnings` passed. `WALLET_BACKEND=mock cargo test` passed **63 tests**: 5 observer unit tests, 4 mainnet HTTP tests, 40 Milestone 1 tests, and 14 Milestone 3 tests. The observer cases cover absent observer, invalid IPC token, wrong network, stale and future timestamps, contradictory heights, malformed balances/history, timeout, peer/process closure, unrecognized fields including `agentId`, and disabled construction/transmission paths. `node scripts/validate-openapi.mjs` passed; the focused contract suite passed **29 tests in 1 file**.

The sandbox denies Unix-domain socket binding with `EPERM`. The client still uses a production Unix-domain socket, but observer protocol tests use Tokio in-memory duplex streams to exercise authentication, timeout, malformed response, and peer-failure behavior. A deployment acceptance test must bind the real socket under the private service runtime directory before enabling a real observer.
