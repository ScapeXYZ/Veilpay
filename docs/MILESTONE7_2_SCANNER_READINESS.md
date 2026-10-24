# Milestone 7.2: observer IPC acceptance and scanner readiness

## Unix-socket acceptance

`backend/src/observer.rs` now contains a minimal mock observer server used by the explicitly runnable `unix_socket_acceptance_uses_observer_wallet` test. It binds a synthetic snapshot server to a Unix-domain socket inside a freshly created `0700` directory, reads the versioned request and IPC token, and returns only the existing sanitized snapshot schema. The client side is the production `LocalObserverClient` wrapped by `ObserverWallet`.

The test is intentionally ignored in the ordinary suite because this execution sandbox prevents `AF_UNIX` binding. The explicit command was:

```sh
cd backend
WALLET_BACKEND=mock cargo test observer::tests::unix_socket_acceptance_uses_observer_wallet --lib -- --ignored
```

It failed before a connection was made at `UnixListener::bind`: `Os { code: 1, kind: PermissionDenied, message: "Operation not permitted" }`. An independent Python `AF_UNIX` bind probe in a new `0700` `/tmp` directory failed with `PermissionError: [Errno 1] Operation not permitted` as well. This is an environment restriction, not a fallback to TCP, abstract sockets, a public listener, or in-memory transport.

The non-ignored mock tests exercise authenticated valid snapshots, wrong token, malformed response, stale/future response, timeout, disconnect, absent socket, unsafe socket-directory permissions, and disabled payment operations. The real-socket acceptance test must pass on the target host before an observer daemon is enabled.

## Viewing-only scanner seam

`backend/src/scanner.rs` is a synthetic, no-key scanner interface. `ViewingOnlyScanner` accepts an opaque operator key reference, a network, and compact-block fixtures; it returns only scan height and tip hash. It has no transaction, fee, signing, broadcast, wallet-creation, or network-client API. `FixtureScanner` validates mainnet selection, nonempty key references, sequential block heights, previous-hash continuity, and reports `RewindRequired` for a reorganization. Tests use synthetic hashes and no Zcash key material.

The selected future dependency candidate is an exact `zcash_client_backend = "=0.24.0"` pin with the `orchard` and `sapling` scanning capabilities reviewed before introduction. It is **not yet added to Cargo.toml**, deliberately: a live observer must first get a dependency/SBOM review and a separately reproducible binary build.

The required official APIs are:

- `zcash_client_backend::keys::UnifiedIncomingViewingKey::decode`, `has_orchard`, and `has_sapling` for ZIP-316 UInVK validation. A UInVK is sufficient for incoming-note discovery; an approved UFVK may reveal additional outgoing metadata and needs a separate policy decision.
- `zcash_client_backend::data_api::chain::scan_cached_blocks` with its `BlockSource`, `ChainState`, and `WalletWrite` persistence boundary. It checks continuity and reports scan errors; callers must rewind durable wallet state and cached blocks on reorganization.
- `WalletRead::get_wallet_summary` for wallet-reported summaries. The observer must report scan height separately from a trusted chain-source tip; matching heights only indicate the observer's state is current relative to its selected source.

`scan_cached_blocks` requires a persistent wallet database that stores accounts/viewing-key references, scanned compact blocks, block metadata, nullifiers, note commitment trees, and migration state. Schema migrations and backup/restore procedures belong to the observer service, outside the VeilPay application database. Reorg processing must truncate state to a safe prior height, delete/re-fetch cached blocks, and rescan; confirmations must be recalculated from the currently trusted tip and can decrease.

The observer must receive viewing keys only from an operator-controlled private configuration source. It must reject seed phrases, spending keys, ZIP-32 spending material, and keys for any non-mainnet network before scanning. Run it as a separate non-login account with a private `0700` runtime directory, no public listener, read-only executable/config mounts, a private wallet-state directory, and egress restricted to reviewed compact-block and independent chain-tip sources. Preserve reproducible build provenance, dependency lockfiles/SBOMs, and signed release artifacts. Viewing keys remain sensitive because they disclose wallet activity.

## Evidence and remaining blockers

No live scanner, view key, lightwallet server, full node, wallet database, or chain source was accessed. The fixture scanner is not evidence that librustzcash scanning works. Independent evidence remains unavailable: an on-chain transaction proves inclusion only, not shielded receipt ownership; `chainEvidence.trusted` must remain false until independently pinned tip/hash validation is implemented and tested.

Before live observation: pass real-socket acceptance on the deployment host; implement a reviewed standalone scanner daemon; pin and audit librustzcash; implement mainnet UInVK/UFVK validation; create encrypted/permissioned state storage with migrations; pin multiple chain sources and reorg handling; add health/lag monitoring; and define operator custody, rotation, recovery, and incident response. The existing database still has no agent-to-wallet binding, so no shared observer balance may be attributed to an agent.

## Results

The real Unix-socket acceptance result is **FAIL (environment blocked)**. No isolation rule was weakened. `cargo fmt --check` and `WALLET_BACKEND=mock cargo clippy --all-targets -- -D warnings` passed. `WALLET_BACKEND=mock cargo test` passed **67 tests**, with **1 ignored** host-dependent Unix-socket acceptance test and no failures. `node scripts/validate-openapi.mjs` passed. The ignored acceptance test was then run explicitly and failed at bind with the `EPERM` error above.
