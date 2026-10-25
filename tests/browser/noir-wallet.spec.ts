import { expect, test, type Page } from "@playwright/test";

const mainnetHealth = {
  status: "ok", network: "mainnet", wallet: "ready", walletBackend: "zingo", chainHeight: null,
  confirmationsRequired: 3, mode: "real", reconciler: { lastRunAt: null, unresolved: 0 },
  chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 100, deepReorgAlert: false },
};

async function installNoir(page: Page, reject = false, emptyHistory = false) {
  await page.addInitScript(({ shouldReject, noHistory }: { shouldReject: boolean; noHistory: boolean }) => {
    const accounts = [
      { id: "wallet-a:0", label: "Treasury", walletId: "wallet-a", accountId: "0", addresses: { transparent: "t1a", shielded: "u1a" } },
      { id: "wallet-b:0", label: "Operations", walletId: "wallet-b", accountId: "0", addresses: { transparent: "t1b", shielded: "u1b" } },
    ];
    let authorized = false;
    const listeners: Array<() => void> = [];
    (window as Window & { noirwallet?: unknown }).noirwallet = {
      isNoirWallet: true,
      zcash: {
        request: async ({ method, params }: { method: string; params?: Array<{ accountId?: string }> }) => {
          if (method === "zcash_getAccounts") return authorized ? { transparent: "t1a", shielded: "u1a", accounts } : null;
          if (method === "zcash_requestAccounts") {
            if (shouldReject) throw Object.assign(new Error("User rejected"), { code: 4001 });
            authorized = true;
            return { transparent: "t1a", shielded: "u1a", accounts };
          }
          if (method === "zcash_getBalance") {
            const id = params?.[0]?.accountId ?? accounts[0].id;
            const operations = id === accounts[1].id;
            return { transparent: "0", shielded: operations ? "1.25" : "2.50", available: operations ? "1.00" : "2.00", total: operations ? "1.30" : "2.60", accounts: accounts.map((account) => ({ id: account.id, walletId: account.walletId, accountId: account.accountId, synced: account.id !== accounts[1].id, balance: { transparent: "0", shielded: account.id === accounts[1].id ? "1.25" : "2.50", available: account.id === accounts[1].id ? "1.00" : "2.00", total: account.id === accounts[1].id ? "1.30" : "2.60" } })) };
          }
          if (method === "zcash_getTransactionHistory") return noHistory ? [] : [{ txid: "a".repeat(64), type: "receive", amount: "0.25", status: "mined", timestamp: 1700000000000, memo: "do not display" }];
          if (method === "zcash_disconnect") { authorized = false; return null; }
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on: (_event: string, handler: () => void) => listeners.push(handler),
        removeListener: (_event: string, handler: () => void) => { const index = listeners.indexOf(handler); if (index >= 0) listeners.splice(index, 1); },
      },
    };
  }, { shouldReject: reject, noHistory: emptyHistory });
}

test("Noir Wallet connects only on click, switches authorized accounts, and disconnects", async ({ page }) => {
  await installNoir(page);
  await page.route("**/api/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(mainnetHealth) }));
  await page.goto("/app");
  const card = page.getByTestId("noir-wallet-card");
  await expect(card).toContainText(/connect an account/i);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText("2.50 ZEC");
  await expect(card.getByTestId("noir-addresses")).toContainText("t1a");
  await expect(card.getByTestId("noir-activity-list")).toContainText("Receive");
  await expect(card).not.toContainText("do not display");
  await card.getByTestId("noir-account-select").selectOption("wallet-b:0");
  await expect(card).toContainText("1.25 ZEC");
  await expect(card).toContainText(/sync is incomplete/i);
  await card.getByTestId("disconnect-noir-wallet").click();
  await expect(card).toContainText(/connect an account/i);
});

test("Noir Wallet reports a rejected authorization without showing a balance", async ({ page }) => {
  await installNoir(page, true);
  await page.route("**/api/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(mainnetHealth) }));
  await page.goto("/app");
  const card = page.getByTestId("noir-wallet-card");
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText(/connection was declined/i);
  await expect(card.getByTestId("noir-balances")).toHaveCount(0);
});

test("mainnet wallet with no reported history renders an empty 7/30-day activity view", async ({ page }) => {
  await installNoir(page, false, true);
  await page.route("**/api/health", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(mainnetHealth) }));
  await page.goto("/app");
  const card = page.getByTestId("noir-wallet-card");
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card.getByTestId("noir-wallet-chart-empty")).toContainText("No transactions reported in the last 7 days.");
  await expect(card.getByTestId("noir-wallet-bars")).toHaveCount(0);
  await expect(card.getByTestId("noir-wallet-recent")).toContainText("No transactions reported.");
  await card.getByTestId("noir-wallet-range-30").click();
  await expect(card.getByTestId("noir-wallet-chart-empty")).toContainText("No transactions reported in the last 30 days.");
});
