import { expect, test, type Page } from "@playwright/test";

/**
 * Wallet setup UX against an isolated testnet health fixture and the loopback
 * Axum backend. The fake window.noirwallet exists only in this harness; the
 * production mainnet path never fabricates wallet data. Screenshots go to
 * WALLET_UX_SHOTS when set.
 */
const testnetHealth = {
  status: "ok", network: "testnet", wallet: "ready", walletBackend: "zingo", chainHeight: null,
  confirmationsRequired: 3, mode: "real", reconciler: { lastRunAt: null, unresolved: 0 },
  chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 100, deepReorgAlert: false },
};

type FakeOpts = { network?: "mainnet" | "testnet"; reject?: boolean; unsynced?: boolean; syncError?: boolean; canary?: boolean };

async function installNoir(page: Page, opts: FakeOpts = {}) {
  await page.addInitScript((o: FakeOpts) => {
    // This suite exercises the separate testnet setup workflow. Mainnet
    // observation is covered by noir-wallet.spec.ts.
    const test = o.network !== "mainnet";
    const c = o.canary ? "Zq9Canary" : "";
    const accounts = [
      { id: "wallet-a:0", label: o.canary ? "Zq9CanaryTreasuryLabel" : "Treasury", walletId: "wallet-a", accountId: "0",
        addresses: { transparent: test ? "tmTreasuryTransparent000000000000" : "t1TreasuryTransparent000000000000", shielded: test ? "utest1treasuryshieldedunifiedaddress0000000000" : "u1treasuryshieldedunifiedaddress00000000000000" } },
      { id: "wallet-b:0", label: o.canary ? "Zq9CanaryOpsLabel" : "Operations", walletId: "wallet-b", accountId: "0",
        addresses: { transparent: test ? "tmOperationsTransparent0000000000" : "t1OperationsTransparent0000000000", shielded: test ? "utest1operationsshieldedunifiedaddress00000000" : "u1operationsshieldedunifiedaddress000000000000" } },
    ];
    if (c) for (const a of accounts) { a.addresses.shielded = a.addresses.shielded.replace(/0{8}$/, "zq9canry"); a.addresses.transparent = a.addresses.transparent.replace(/0{8}$/, "Zq9Canry"); }
    let authorized = false;
    const listeners: Array<(a: unknown) => void> = [];
    const calls: string[] = [];
    (window as unknown as { __noirCalls: string[] }).__noirCalls = calls;
    (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit = (a: unknown) => { if (!Array.isArray(a) || a.length === 0) authorized = false; listeners.forEach((l) => l(a)); };
    (window as Window & { noirwallet?: unknown }).noirwallet = {
      isNoirWallet: true,
      zcash: {
        request: async ({ method, params }: { method: string; params?: Array<{ accountId?: string }> }) => {
          calls.push(method);
          if (method === "zcash_getAccounts") return authorized ? { transparent: accounts[0].addresses.transparent, shielded: accounts[0].addresses.shielded, accounts } : null;
          if (method === "zcash_requestAccounts") {
            if (o.reject) throw Object.assign(new Error("User rejected"), { code: 4001 });
            authorized = true;
            return { transparent: accounts[0].addresses.transparent, shielded: accounts[0].addresses.shielded, accounts };
          }
          if (method === "zcash_getBalance") {
            void params;
            if (o.syncError) throw new Error("Wallet is still syncing");
            if (o.canary) return { transparent: "0", shielded: "0", accounts: accounts.map((a, i) => ({ id: a.id, walletId: a.walletId, accountId: a.accountId,
              synced: true, balance: { transparent: i === 0 ? "3.1417" : "4.2718", shielded: i === 0 ? "7.7731" : "8.8842", available: i === 0 ? "6.6620" : "5.5519", total: i === 0 ? "9.9953" : "13.1560" } })) };
            return { transparent: "0", shielded: "0", accounts: accounts.map((a, i) => ({ id: a.id, walletId: a.walletId, accountId: a.accountId,
              synced: !(o.unsynced && i === 0), balance: { transparent: "0", shielded: i === 0 ? "2.50" : "1.25", available: i === 0 ? "2.00" : "1.00", total: i === 0 ? "2.60" : "1.30" } })) };
          }
          if (method === "zcash_disconnect") { authorized = false; return null; }
          throw new Error(`Unexpected wallet method ${method}`);
        },
        on: (_e: string, h: (a: unknown) => void) => listeners.push(h),
        removeListener: (_e: string, h: (a: unknown) => void) => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); },
      },
    };
  }, opts);
}

async function open(page: Page) {
  await page.route("**/api/health", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(testnetHealth) }));
  await page.goto("/app/wallet");
  const card = page.getByTestId("noir-wallet-card");
  // Wait for the real silent getAccounts() restoration before exercising an
  // authorization click. This avoids racing a deliberate connect against the
  // SDK's documented non-popup account check.
  await expect(card).not.toContainText("Checking existing authorization");
  return card;
}

test("connect is deliberate, account selection is local, and disconnect clears the card", async ({ page }) => {
  await installNoir(page);
  const card = await open(page);
  await expect(card.getByTestId("connect-noir-wallet")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __noirCalls: string[] }).__noirCalls)).not.toContain("zcash_requestAccounts");
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText("2.50 ZEC");
  await card.getByTestId("noir-account-select").selectOption("wallet-b:0");
  await expect(card).toContainText("1.25 ZEC");
  await card.getByTestId("disconnect-noir-wallet").click();
  await expect(card.getByTestId("connect-noir-wallet")).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __noirCalls: string[] }).__noirCalls);
  expect(calls.filter((c) => !["zcash_getAccounts", "zcash_requestAccounts", "zcash_getBalance", "zcash_getTransactionHistory", "zcash_disconnect"].includes(c))).toEqual([]);
});

test("unsynced wallet is labelled incomplete rather than treated as settled", async ({ page }) => {
  await installNoir(page, { unsynced: true });
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText(/sync is incomplete/i);
  await expect(card).toContainText("2.50 ZEC");
});

test("wrong network fails closed", async ({ page }) => {
  await installNoir(page, { network: "mainnet" });
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText(/not a Noir Wallet testnet connection/i);
  await expect(card.getByTestId("noir-balances")).toHaveCount(0);
});

test("declined connection keeps nothing", async ({ page }) => {
  await installNoir(page, { reject: true });
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText(/connection was declined/i);
  await expect(card.getByTestId("noir-balances")).toHaveCount(0);
});

test("no extension is explicit and never triggers an authorization request", async ({ page }) => {
  const card = await open(page);
  await expect(card).toContainText(/was not detected/i);
  await expect(card.getByTestId("connect-noir-wallet")).toBeVisible();
});

test("wallet balance errors retain no fabricated balance", async ({ page }) => {
  await installNoir(page, { syncError: true });
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card.getByTestId("noir-balances")).toContainText("Unavailable");
  await expect(card).toContainText("Syncing");
});

test("wallet lock event clears balances", async ({ page }) => {
  await installNoir(page);
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText("2.50 ZEC");
  await page.evaluate(() => (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit([]));
  await expect(card).toContainText(/locked/i);
  await expect(card.getByTestId("noir-balances")).toHaveCount(0);
});

test("wallet disconnect event clears everything", async ({ page }) => {
  await installNoir(page);
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText("2.50 ZEC");
  await page.evaluate(() => (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit(null));
  await expect(card.getByTestId("connect-noir-wallet")).toBeVisible();
  await expect(card.getByTestId("noir-balances")).toHaveCount(0);
});

test("leak audit: current Noir card keeps wallet data out of console, network, storage and cookies", async ({ page, context }) => {
  const console_: string[] = [];
  const net: string[] = [];
  page.on("console", (m) => console_.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => console_.push(`pageerror ${e.message}`));
  page.on("request", (r) => net.push(`${r.method()} ${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ""}`));
  await installNoir(page, { canary: true });
  const card = await open(page);
  await card.getByTestId("connect-noir-wallet").click();
  await expect(card).toContainText("7.7731 ZEC");
  await card.getByTestId("noir-account-select").selectOption("wallet-b:0");
  await expect(card).toContainText("8.8842 ZEC");
  await page.reload();
  await expect(page.getByTestId("noir-wallet-card")).toBeVisible();
  await page.waitForTimeout(500);

  const storage = await page.evaluate(async () => {
    const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => [s.key(i)!, s.getItem(s.key(i)!)]));
    const idb: Record<string, unknown> = {};
    const dbs = (await indexedDB.databases?.()) ?? [];
    for (const d of dbs) {
      if (!d.name) continue;
      idb[d.name] = await new Promise((resolve) => {
        const req = indexedDB.open(d.name!);
        req.onerror = () => resolve("open-failed");
        req.onsuccess = async () => {
          const db = req.result; const out: Record<string, unknown> = {};
          for (const name of Array.from(db.objectStoreNames)) {
            out[name] = await new Promise((r) => { const g = db.transaction(name).objectStore(name).getAll(); g.onsuccess = () => r(g.result); g.onerror = () => r("read-failed"); });
          }
          db.close(); resolve(out);
        };
      });
    }
    return { local: dump(localStorage), session: dump(sessionStorage), idb, cookie: document.cookie };
  });
  const cookies = await context.cookies();
  const haystacks: Record<string, string> = {
    console: console_.join("\n"), network: net.join("\n"),
    localStorage: JSON.stringify(storage.local), sessionStorage: JSON.stringify(storage.session),
    indexedDB: JSON.stringify(storage.idb), cookies: JSON.stringify(cookies) + storage.cookie,
  };
  const canaries = ["Zq9Canary", "zq9canry", "Zq9Canry", "wallet-a:0", "wallet-b:0", "wallet-a", "wallet-b",
    "7.7731", "8.8842", "3.1417", "4.2718", "6.6620", "5.5519", "9.9953", "13.1560", "u1treasury", "u1operations", "t1Treasury", "t1Operations"];
  const hits: string[] = [];
  for (const [where, text] of Object.entries(haystacks)) for (const k of canaries) if (text.includes(k)) hits.push(`${k} in ${where}`);
  const report = { consoleLines: console_.length, requests: net.length,
    localKeys: Object.keys(storage.local), sessionKeys: Object.keys(storage.session), idbDatabases: Object.keys(storage.idb), cookies: cookies.map((c) => c.name), hits };
  if (process.env.WALLET_UX_LEAK_REPORT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.WALLET_UX_LEAK_REPORT, JSON.stringify(report) + "\n");
  }
  expect(hits).toEqual([]);
  expect(net.length).toBeGreaterThan(0);
  expect(storage.local["veilpay.businessDraft.v1"]).toBeUndefined();
});
