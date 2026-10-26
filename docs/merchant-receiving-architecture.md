# Merchant receiving architecture — Testnet recovery decision

**Status:** investigation only; no wallet was provisioned, imported, queried for
private material, or used to sign, send, or broadcast while preparing this
document.

**Scope:** Zcash Testnet only. This document does not relax the existing mainnet
guards, read-only Noir Wallet integration, or the prohibition on transmitting
wallet history, memos, viewing keys, seed phrases, or spending keys to VeilPay.

## Decision summary

The currently installed Noir Wallet SDK can return a shielded receiving address
to a browser after the user deliberately authorizes the site. It does **not**
provide a server-verifiable proof that the authenticated merchant controls that
shielded address. Consequently, VeilPay must not treat a browser-submitted
shielded address as an owned merchant receiving wallet, create a payable invoice
from it, or use it to authorize an irreversible payment.

The existing Zingo CLI tooling can operate a pre-existing Testnet merchant
wallet, but it is a server-managed wallet directory, not a merchant enrollment
system. Turning it into one would introduce custody, recovery, key-management,
and tenant-isolation obligations that are not implemented or reviewed.

For the hackathon, the safe minimum is to demonstrate genuine authenticated
accounts, account-scoped agents, persisted policies, and server-side policy
decisions only where there is a genuine backend record. Keep merchant invoice
creation unavailable in the live Testnet UI until a receiving-address ownership
binding is available. Do not represent test fixtures or declared destinations as
payable invoices or settlement evidence.

## Evidence examined

| Boundary | Evidence | Result |
| --- | --- | --- |
| Noir browser integration | `@noir-wallet/sdk` 0.1.9, `README.md`, `dist/index.d.ts`, and `dist/chunk-XCTAA2LD.mjs` | `connect`, `getAccounts`, and `getAddresses` return transparent and shielded addresses after site authorization. `getTransactionHistory` returns wallet-reported history. No method yields a shielded-address ownership proof for a backend verifier. |
| Noir signatures | SDK `signMessage`, `verifyMessageSignature`, and `publicKeyToAddress` declarations and implementation | Signatures are made with a **transparent-address key** and verification derives a transparent P2PKH address. They must not be used as proof of control of a shielded address. |
| Noir events | SDK README event examples | `accountsChanged` and `chainChanged` are browser lifecycle signals. They are not attestations for a server and must be followed by an authorized account refresh. |
| Read-only wallet boundary | `src/lib/noir-wallet.ts` | The product adapter intentionally uses observation methods only; it does not call send or signing APIs, and keeps wallet observations in the browser. |
| Server wallet boundary | `backend/src/wallet.rs` | `ZingoWallet` returns `BroadcastDisabled`; its default receiving-address operation is unsupported. `CliWallet` is Testnet-only and reports that an operator is required. HTTP submission stays disabled. |
| Zingo transport | `backend/src/transport.rs` and `docs/MILESTONE3_TESTNET.md` | The existing Testnet transport uses pre-existing `customer/` and `merchant/` wallet directories. Its merchant address operation runs `new_address o`; that changes wallet state and is not an enrollment proof. It can observe merchant history, which is sensitive wallet data. |
| Existing live guard | `backend/src/lib.rs` and `src/app/app/merchant/page.tsx` | When the live Zingo-disabled backend cannot safely issue an invoice, merchant invoice creation fails closed rather than creating a mock payable record. |

Address-prefix checks in the browser distinguish expected Testnet prefixes from
known mainnet prefixes. They are a network guard, not a complete ZIP-316
decoder or a proof of address control. Any future server acceptance must use a
reviewed, complete decoder and reject unknown receiver forms.

## Option 1 — merchant-managed wallet enrollment by declared address

### Feasibility

An authenticated merchant can declare a Testnet shielded destination obtained
from their own wallet. This is feasible only as an **unverified declaration**.
The browser can prove that the site was authorized to observe an account at that
moment, but a malicious client can submit a different address in an API request.
The backend therefore cannot safely call the declaration “merchant-owned.”

### What may safely be implemented

A future, explicitly non-payable record may contain:

- the authenticated merchant account ID;
- a validated Testnet shielded address or unified address containing a shielded
  receiver;
- `ownership_verification = unverified`;
- creation time, revocation time, and an audit event with no address value in
  logs.

It may be used as a private draft/contact destination for the merchant that
created it. It must not create an invoice, appear to a payer as a payment
destination, enable agent execution, or produce a paid/settled state. Restrict
updates and reads to the owning authenticated account and require explicit
reconfirmation before any future use.

### Security assumptions and risks

- Authentication establishes the backend account, not wallet ownership.
- TLS and same-origin session protections prevent network substitution, but do
  not make a submitted address truthful.
- Address substitution remains possible by a compromised browser, malicious
  extension, or merchant account takeover.
- A transparent-key message signature is not a substitute: it proves only a
  transparent key relationship, not control of the shielded receiver.

This option is therefore unsuitable for an irreversible payment path. It is
also not appropriate for the current live UI, because showing it as an invoice
would contradict the no-mock, no-false-settlement requirement.

### Privacy implications

The declaration should remain visible only to its merchant account and should
not be copied into analytics or logs. Reusing one address enables correlation;
no payment history, memo, viewing key, or payer data should be requested to
compensate for the missing proof.

## Option 2 — VeilPay-managed Testnet receiving wallet

### Feasibility

The existing pinned Zingo CLI integration demonstrates that a pre-existing
Testnet wallet can derive an Orchard receiving address (`new_address o`) and
that an operator can inspect its own wallet history. The existing implementation
has exactly one role directory named `merchant/`; it does not provision one
isolated wallet per authenticated merchant, bind a wallet to an account, or
provide a receiving-only credential.

It is technically possible to build a separate custodial Testnet service, but
it is not safe to introduce as a small invoice feature. The current CLI wallet
can sign when used by the separately gated operator path. A process able to open
that wallet is not receiving-only merely because the HTTP route refrains from
calling send.

### Required design before implementation

| Requirement | Current state | Required before a merchant-facing implementation |
| --- | --- | --- |
| Wallet isolation | One fixed merchant directory | One canonical internal wallet reference per merchant, separate locked storage, and no cross-tenant CLI selection. |
| Key custody | Existing private local wallet root | Reviewed custody model, encryption with an external secret/KMS, strict OS identity and file permissions, rotation and incident response. |
| Recovery | Existing recovery artifacts are intentionally not read | Documented backup/recovery ceremony, access control, loss procedure, and test recovery without exposing material to the app. |
| Network binding | Testnet transport checks its configured chain | Network must be immutable per wallet and verified on every CLI response; refuse mainnet, regtest, and unknown chain data. |
| Receiving-only observation | CLI wallet is capable of the separate signing flow | A separately provisioned watch-only observer (for example an independently reviewed UFVK workflow) with no spend authority. This is not implemented or validated here. |
| Invoice matching | Merchant history is available to the wallet process | Unique shielded receiver per invoice, minimal matching state, reorg/confirmation handling, and no raw history API. |
| Merchant account control | No account-to-wallet binding | Authenticated enrollment/admin recovery with explicit merchant consent, no address replacement without a new verification ceremony. |

No wallet directories, seeds, recovery artifacts, spending keys, or viewing keys
were generated, imported, exposed, or stored for this investigation.

### Privacy and operational risks

- A shared merchant wallet makes invoices and incoming transfers linkable to
  the service and reveals all history available to the process that scans it.
- A full-spend wallet on an application host is incompatible with a
  “receiving-only” claim. Separating it from a watch-only observer is essential.
- Per-invoice receiving addresses reduce simple address reuse but do not by
  themselves make an invoice reference cryptographic payment evidence.
- Settlement needs exact receiver, amount rules, chain/network, scanned height,
  confirmation depth, duplicate/overpayment/reorg handling, and an explicit
  unknown state. A caller-supplied txid is not independent proof.
- The service must never solicit a payer viewing key or upload a payer’s history
  to solve merchant matching.

### Conclusion

Do not use the current `Role::Merchant` CLI directory as an authenticated
merchant wallet product. It remains appropriate only for the existing
operator-controlled Testnet research procedure. A custodial architecture needs
a separate security design and review, not an incremental frontend change.

## Option 3 — independent shielded-address verification

### Feasibility

No supported mechanism was found in the installed Noir Wallet SDK 0.1.9 to
perform a challenge-response proof for a shielded receiving address. The SDK’s
only message-signing facility is explicitly transparent-address based. Browser
authorization (`connect`/`getAccounts`) is local to the dapp session and cannot
be independently verified by the backend as an address-control proof.

Zcash shielded receivers are not interchangeable with transparent signing keys.
VeilPay must not construct a protocol that asks a merchant to sign with a
transparent key and then infer ownership of a unified or shielded address.

### What is blocked

- merchant-controlled shielded-address enrollment with server-verifiable proof;
- safe use of a browser-observed shielded address as a genuine payable invoice;
- independent settlement verification based solely on wallet-reported txids;
- invoice-reference matching in the shielded pool when it depends on a memo or
  undisclosed payer wallet history.

Future work may revisit this only when a maintained wallet/protocol integration
offers a proof whose verified public statement explicitly binds the exact
Testnet shielded receiver, relying party, nonce, expiry, and account context.

## What is safe now

1. Keep real Noir Wallet Testnet observation entirely browser-local: addresses,
   wallet-reported balances, and sanitized activity are observations, not
   independently verified settlement.
2. Keep authenticated backend accounts, account-scoped agents, persistent
   budgets, merchant allow-lists, expirations, enable/disable state, and
   server-side allow/deny evaluations. The current policy has an optional
   persisted `expiresAt`; the backend rejects new requests after it elapses.
   The current authenticated session can also be explicitly revoked through
   `DELETE /api/session` before its normal expiry.
3. Keep the live merchant invoice route fail-closed when the backend does not
   have a securely bound receiving wallet.
4. Use isolated fixtures/regtest data only in automated tests, never as live
   Testnet agents, invoices, balances, requests, receipts, or settlement.
5. Optionally store an unverified destination declaration only after a separate
   product decision, and keep it non-payable and private as described in option
   1. This is not required for the hackathon demonstration.

## Current policy-flow demonstration

The agent and policy records are genuine authenticated backend records: account
ownership is persisted, mutations are session- and CSRF-protected, and policy
evaluation occurs server-side. That supports an honest demonstration of:

- creating an authenticated user account and session;
- creating, listing, editing, and disabling only that user’s agent;
- configuring total and per-payment limits, approved merchant identifiers, and
  expiration; and
- showing a genuine policy decision for a backend request only when its inputs
  are supported by a genuine backend record.

It does **not** currently support an honest live demonstration of a payable
merchant invoice or a real settlement. The live invoice guard deliberately
rejects invoice creation rather than substituting a mock record. Until a secure
receiving architecture exists, the interface must say that invoice issuance is
unavailable and retain an empty payment-request/receipt state. Policy approval
must remain “policy allowed, awaiting owner authorization” at most; it never
means a payment was signed, sent, broadcast, or settled.

## Recommended minimal hackathon architecture

**Recommended now:** retain the current non-custodial, read-only Testnet wallet
connection and fail-closed invoice state. Demonstrate the policy-control part of
the journey with authenticated backend records, clearly separating it from the
unimplemented owner-authorized shielded payment and settlement steps.

**Recommended path to genuine invoices:** select one of the following only after
the stated acceptance gates are met:

1. **Merchant-controlled path (preferred):** a supported wallet exposes a
   verifier-checkable proof binding the exact shielded Testnet receiver to an
   authenticated merchant enrollment challenge. The server stores only the
   verified receiver and binding metadata, not merchant keys. Each invoice gets
   a receiver appropriate for the supported protocol, and payment execution
   remains owner-authorized in the payer’s wallet.
2. **Explicit custody path (not a Milestone 4 shortcut):** a separately reviewed
   Testnet custodial system provisions a distinct merchant wallet and an
   independent watch-only observer. It has a written key-management, recovery,
   tenant-isolation, monitoring, and incident-response design before any account
   can receive funds.

Neither path authorizes automatic sending. Policy approval stays separate from
the owner’s explicit wallet authorization, and settlement remains pending until
the designated observer has independently met the documented confirmation
criteria.

## Implementation and testing plan

### Phase 0 — retain the safe current state

- Keep merchant invoice creation unavailable in live Testnet mode.
- Test that unknown, mainnet, regtest, transparent-only, malformed, and
  unverified receiver inputs cannot become payable invoices.
- Test account/session ownership, CSRF, logout/revocation, cross-account
  denial, policy expiry, and that policy approval does not alter payment or
  invoice settlement state.

### Phase 1 — choose and validate an ownership primitive

- Obtain documented SDK/protocol support for shielded receiver proof, or approve
  the separate custody design.
- Build a test vector suite for nonce binding, relying-party/origin binding,
  expiry, replay, network, and exact receiver verification.
- Require external security review before accepting any receiving enrollment.

### Phase 2 — minimal invoice records

- Persist merchant-account ownership, an opaque receiver reference, exact zatoshi
  amount, invoice reference, creation/expiry, Testnet network, and `open` state.
- Use integer zatoshis; validate network and complete receiver format server-side.
- Authorize merchant reads/writes only for the owner; do not log addresses,
  memos, full wallet history, viewing keys, or secrets.
- Bind server policy evaluation to the stored invoice and preserve a strict
  state machine: `open` → policy decision → owner authorization (separate) →
  submitted (only after an approved future execution design) → confirmed or
  failed/expired. No transition may infer settlement from a policy result.

### Phase 3 — receiving observation and settlement

- Use a receiving-only observer that is technically unable to spend, not merely
  an HTTP route that declines to spend.
- Match only the invoice’s designated receiver and exact documented amount
  rules; expose no unrelated merchant/payer history.
- Verify Testnet chain, completed scan, unique match, transaction identity where
  independently available, confirmation depth, and reorg status. Preserve
  `unknown`/`pending` on every ambiguity.
- Add integration tests for underpayment, overpayment, duplicate matches,
  expiry, reorg/lost confirmation, malformed data, and cross-merchant access.

### Phase 4 — payment execution, separately scoped

Do not begin this phase as part of merchant receiving. It requires an explicit
owner-authorization UX, a security review of the wallet’s actual Testnet send
API, exact destination/amount verification, transaction-id handling, and an
independent settlement model. No agent may receive private keys or unrestricted
spending authority.

## Acceptance criteria before enabling a real payable invoice

- A verifier can prove the authenticated merchant controls the exact shielded
  Testnet receiving address, or a separately reviewed custody model owns it.
- Full receiver/network validation is implemented; prefix checks alone are not
  accepted as validation.
- The application has no ability to log or transmit payer wallet history, memos,
  seed phrases, spending keys, or viewing keys.
- Invoice state is persistent, account-scoped, and cannot be marked paid by a
  caller, a policy result, or a declared txid.
- Receiving observation is independent of payer assertions and has explicit
  confirmation/reorg behavior.
- Desktop regression, backend authorization, privacy, and network-isolation
  tests pass, followed by a dedicated security review.
