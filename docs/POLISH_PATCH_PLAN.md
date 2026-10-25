# VeilPay polish patch plan (approved items, not yet applied)

Source: Temi's approval, 2026-10-25. Existing layout, structure and navigation stay.
No redesign, no landing page, no mock/demo display, no fake financial data, no
memo content. **Desktop only** (Temi, 2026-10-25 update): mobile UI, responsive
layouts, mobile header wrapping and mobile tap-target fixes are out of scope for
now; items 1 and 4 are dropped and item 2 covers desktop text only. Measurements are from a DOM audit at 1440px and 390px widths on
`/app`, `/app/activity` and `/app/merchant` (mainnet, wallet disconnected).

**Not edited yet.** Codex has uncommitted changes in `src/components/shell.tsx`,
`src/app/app/page.tsx`, `src/components/noir-wallet-card.tsx` and
`src/components/onboarding.tsx`. Items in those files are **BLOCKED** until their
mainnet work is pushed and ownership is agreed. Items in other files are
**READY**, but still wait for the same coordination before anyone edits them.

| # | Approved item | File(s) | Status |
|---|---|---|---|
| 1 | ~~Mobile header wrapping~~ | `shell.tsx` | DROPPED (desktop only) |
| 2 | Very small text to 12px (desktop) | `shell.tsx`, `app/app/page.tsx` | BLOCKED |
| 3 | Noir read-only badge alignment | `noir-wallet-card.tsx` (`ui.tsx` only if the fix belongs in `Badge`) | BLOCKED |
| 4 | ~~Three undersized tap targets~~ | `shell.tsx` | DROPPED (desktop only) |
| 5 | Clear "Can view, cannot spend" explanation | `noir-wallet-card.tsx` | BLOCKED |
| 6 | Empty-state wording, no fake data | `app/app/activity/page.tsx`, `app/app/payments/page.tsx` READY; `app/app/page.tsx` BLOCKED | split |
| 7 | Remove outdated simulation language from live mainnet | `app/app/merchant/page.tsx`, `app/app/help/page.tsx`, `app/page.tsx` READY; `onboarding.tsx`, `shell.tsx` BLOCKED | split |

## 1. Mobile header wrapping (DROPPED, kept for later) (`src/components/shell.tsx`, `StatusStrip`, ~L114-121)

At 390px the strip (`flex flex-wrap gap-x-3 gap-y-1`) puts "· wallet sending off"
and "read-only" on a second row.

- Below `sm`, hide the long words and keep the short state:
  `wallet {WALLET_WORD[h.wallet]}` → `<span className="hidden sm:inline">wallet </span>{WALLET_WORD[h.wallet]}`.
- Render the block height only from `sm` up (`hidden sm:inline`); it stays on the Overview card.
- Keep `read-only` with its lock icon always visible, with `whitespace-nowrap`.
- Target: one row at 390px, unchanged at 1440px.

## 2. Very small text to 12px (`shell.tsx`, `app/app/page.tsx`)

11px text found by the audit, each `text-[11px]` → `text-xs` (12px):

- `shell.tsx` L59 "View as" label.
- `shell.tsx` L185 "More" heading (keep uppercase + tracking).
- `shell.tsx` L192 "Owner and merchant views are separate demo sessions…" note (wording also covered in item 7).
- ~~`shell.tsx` L213 and L217 mobile bottom-nav labels~~ (mobile, dropped).
- `app/app/page.tsx` L61 block-number footnote.

## 3. Noir read-only badge alignment (`src/components/noir-wallet-card.tsx`, L135)

The card's `Read-only` badge sits about 3px off-centre vertically against the
card title, unlike the other cards' badges. Fix in the card first: wrap the
`action` badge in `self-center` (or match the other cards' action wrapper). Only
touch `Badge` in `ui.tsx` if every badge is affected, which the audit did not show.

## 4. Three undersized tap targets (DROPPED, kept for later) (`src/components/shell.tsx`)

Under 40px tall in the audit:

- L61-69 "View as" toggle buttons Customer and Merchant (`px-2.5 py-1`, ~24px):
  → `min-h-10 px-3 py-2` on touch widths (`sm:min-h-0 sm:py-1` keeps desktop as is).
- L134 More-sheet Close button (`p-1.5` + 16px icon, ~28px): → `grid h-10 w-10 place-items-center`.
- Target: 40px minimum, 44px where the row allows.

## 5. "Can view, cannot spend" explanation (`src/components/noir-wallet-card.tsx`)

Add one short line near the top of the card, visible before and after connect
(after the title, above the Connect button), using the existing `ShieldCheck` style:

> **Can view, cannot spend.** VeilPay only reads what Noir Wallet shares. It cannot spend, sign or broadcast, and your recovery phrase never leaves Noir.

Keep the existing L161 footnote ("never sends seed phrases…") as the detail line.

## 6. Empty-state wording, no fake data

Each says why it is empty and where data comes from, without sample rows:

- READY `app/app/activity/page.tsx` L74 "Nothing here right now." → "No activity yet. Payments your agent requests will show here once the VeilPay server records them."
- READY `app/app/payments/page.tsx` L64 "Nothing here." → "No payments match this filter."
- BLOCKED `app/app/page.tsx` L136 "No payments yet." → "No payments yet. Nothing has been requested on this network."
- The Noir card's activity line stays as Codex's wallet-reported activity lands; no change from us there.

## 7. Outdated simulation language in the live mainnet experience

Rule: in mainnet mode (`useNetworkMode()`: `mode.kind !== "mock"`), no copy says
payments are simulated or "practice". Mock/regtest and `/demo` keep their labels.

READY (not in the 4 Codex files):

- `app/app/merchant/page.tsx` L174 subtitle ends "In practice mode receipts and confirmations are simulated." (the audit saw it on mainnet) → append that sentence only when `isMockClient(api)`.
- `app/app/merchant/page.tsx` L133 and L178 "(simulated in practice mode)" → same gate.
- `app/app/help/page.tsx` L41-47 "Interactive demo / Simulation only" card → keep, but title it "Practice demo (separate from your wallet)" on mainnet, or hide it there; your call.
- `app/app/help/page.tsx` L28 page title "Help & demo" → "Help" on mainnet (nav label lives in `shell.tsx`, BLOCKED).
- `app/page.tsx` L55, L60-62, L73-75, L104: "Zecathon 2026 demo" badge, "payments… are simulated" note, the two "Simulation" preview rows (0.75 / 0.12 ZEC) and the privacy line. On mainnet: drop the two preview rows and the note, replace with the read-only line from item 5. No new landing page, same section.

BLOCKED (Codex files):

- `onboarding.tsx` L25 tour step "In this build every payment is a simulation…" → on mainnet: "VeilPay connects to your Noir Wallet read-only. It shows what the wallet reports and cannot spend."
- `onboarding.tsx` L46 "It opens as a separate demo session…" → gate to mock mode.
- `shell.tsx` L83 nav label "Help & demo" → "Help" on mainnet; L137 "Guided demo" item → mock mode only; L192 "separate demo sessions" note → mock mode only.

Out of scope (mock/demo only, unchanged): `app/demo/page.tsx`, `app/app/payments/new/page.tsx` presets, `simLabels` in activity/payments (already gated), `app/merchant/page.tsx` mock labels.

## Order once the SHA lands

1. No merge or rebase until they say; agree file ownership on their pushed SHA first.
2. Apply READY items first, then BLOCKED items in files they hand over.
3. Re-run the DOM audit at 1440 and the real-extension spec with `NOIR_EXPECT_ADDRESSES=1`.
