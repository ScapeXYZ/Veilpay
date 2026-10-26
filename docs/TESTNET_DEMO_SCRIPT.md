# Accurate Testnet demonstration script

1. Open `/app` and identify the Testnet, broadcast-disabled status.
2. Connect Noir Wallet. State that addresses, balances, and activity are
   reported by the wallet directly to this browser; VeilPay does not upload
   them and cannot spend.
3. Create a VeilPay workspace. State that this is separate from wallet
   connection and grants ownership only of the user's VeilPay records.
4. Create an agent with a total budget, per-payment cap, approved merchant IDs,
   and optional expiration. Show the saved policy sheet and pause/resume action.
5. Open Payment requests. State that the app intentionally refuses to create a
   payable request without a securely verified merchant receiving address. No
   invoice, transaction, receipt, or financial activity has been invented.
6. Open Safety & settings and revoke the VeilPay session. Then use the wallet
   disconnect control separately to show that backend login and wallet access
   are independent.

Never state that VeilPay sent, signed, broadcast, confirmed, or independently
verified a shielded payment in this build.
