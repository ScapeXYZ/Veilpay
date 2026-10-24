# VeilPay — Submission Evidence and Screenshot Plan

## Evidence to include

The strongest evidence is a short screen recording of the deterministic local walkthrough plus a small, labelled screenshot set. Label every asset `Local regtest/mock simulation — no wallet, broadcast, or real funds`.

| Evidence | What to capture | What it substantiates |
| --- | --- | --- |
| Policy overview | Demo agent showing 1.00 ZEC total budget and 0.10 ZEC maximum payment, with the mock-practice banner visible | The owner-facing policy and the simulation boundary |
| Rejected request | The 0.20 ZEC invoice/request result showing `CAP_EXCEEDED` and “no money moved / nothing set aside” | Backend-enforced per-payment cap and no reservation on rejection |
| Authorized 0.05 ZEC request | The permitted request before execution | Policy-approved request and reservation lifecycle |
| Simulated execution | “Simulated complete,” the `mock_…` practice reference, and the explicit “not a txid / real transaction” wording | The implemented mock-only execution boundary |
| Merchant receipt | Merchant verification panel showing `Method: mock`, “Simulated, no chain read,” and received state | Merchant workflow without implying a chain scan |
| Merchant acknowledgment | Acknowledgment panel with its statement-not-settlement wording | Merchant acknowledgment as a service statement, not proof |
| Activity + final budget | Activity containing both `DEMO-BLOCKED-0.20` and `DEMO-ALLOWED-0.05`, then overview showing 0.05 ZEC spent and 0.95 ZEC remaining | Full policy outcome and budget accounting |

## Recommended capture sequence

1. Keep the persistent mock banner in frame whenever possible.
2. Capture the policy overview first, then the 0.20 ZEC rejection.
3. Capture the 0.05 ZEC authorized state and the simulated-complete state.
4. Switch to Merchant, enter the payment ID, and capture verification before acknowledgment.
5. Capture the acknowledgment wording and the final Activity/Overview result.

## Do not submit as evidence

- Terminal logs, browser DevTools, cookies, response bodies, Playwright traces, or test-result files.
- A `mock_…` reference presented as a transaction ID.
- A mock confirmation count or merchant acknowledgment presented as chain confirmation or settlement proof.
- Privacy-page text presented as an independently verified property of the mock run.
- Claims of live mainnet or funded testnet settlement.

## Reproducibility references

- `npm run demo:walkthrough` runs the isolated deterministic browser walkthrough.
- `tests/browser/demo.spec.ts` asserts the exact 1.00 / 0.20 / 0.05 / 0.95 ZEC narrative against live loopback Axum endpoints.
- `docs/HACKATHON_DEMO.md` provides the runner’s isolation and capture safeguards.
