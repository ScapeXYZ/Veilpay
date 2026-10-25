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
    (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit = (a: unknown) => { if (Array.isArray(a) && a.length === 0) authorized = false; listeners.forEach((l) => l(a)); };
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

const SHOTS = process.env.WALLET_UX_SHOTS;
async function shot(page: Page, name: string, testInfo: { project: { name: string } }) {
  if (!SHOTS) return;
  const vp = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  // Full-page shots start at the top so sticky header/banner and the fixed nav paint where users see them.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${vp}-${name}.png`, fullPage: true });
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function open(page: Page) {
  await page.route("**/api/health", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(testnetHealth) }));
  await page.goto("/app/wallet");
  await expect(page.getByTestId("wallet-ux-panel")).toBeVisible();
}

test("connect on click, pick accounts, onboarding saves a local draft only", async ({ page }, info) => {
  await installNoir(page);
  await open(page);
  await expect(page.getByTestId("wallet-state-disconnected")).toBeVisible();
  await shot(page, "01-disconnected", info);
  expect(await page.evaluate(() => (window as unknown as { __noirCalls: string[] }).__noirCalls)).not.toContain("zcash_requestAccounts");
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("2.50 ZEC");
  await noSideScroll(page);
  await shot(page, "02-connected", info);
  await page.getByTestId("wallet-account-wallet-b:0").getByRole("radio").check();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("1.25 ZEC");
  await shot(page, "03-account-picked", info);

  const ob = page.getByTestId("business-onboarding");
  await expect(ob.getByTestId("draft-badge")).toHaveText("Local draft · Not registered");
  await ob.getByTestId("business-name").fill("Ada Coffee");
  await ob.getByLabel("Services").check();
  await shot(page, "04-onboarding-business", info);
  await ob.getByTestId("onboarding-next").click();
  await ob.getByTestId("payout-wallet-a:0").check();
  await shot(page, "05-onboarding-payout", info);
  await ob.getByTestId("onboarding-next").click();
  await expect(ob.getByTestId("review-disclosure")).toContainText("not registered");
  await shot(page, "06-onboarding-review", info);
  const apiWrites: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") apiWrites.push(`${r.method()} ${r.url()}`); });
  await ob.getByTestId("onboarding-save").click();
  await expect(ob.getByTestId("saved-summary")).toHaveText("Ada Coffee · Services");
  await noSideScroll(page);
  await shot(page, "07-onboarding-saved", info);
  // Scrolled to the end, the last card must sit above the fixed mobile nav (not under it).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const gap = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="business-onboarding"]')!.getBoundingClientRect();
    const nav = [...document.querySelectorAll("nav")].find((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().height > 0);
    return nav ? nav.getBoundingClientRect().top - card.bottom : window.innerHeight - card.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name.includes("mobile") ? "mobile" : "desktop"}-07b-bottom-viewport.png` });
  expect(apiWrites).toEqual([]);
  const stored = await page.evaluate(() => window.localStorage.getItem("veilpay.businessDraft.v1"));
  expect(JSON.parse(stored!)).toMatchObject({ businessName: "Ada Coffee", registered: false });
  expect(stored).not.toMatch(/u1|t1|wallet-/);
  const calls = await page.evaluate(() => (window as unknown as { __noirCalls: string[] }).__noirCalls);
  expect(calls.filter((c) => !["zcash_getAccounts", "zcash_requestAccounts", "zcash_getBalance"].includes(c))).toEqual([]);

  await page.evaluate(() => (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit([]));
  await expect(page.getByTestId("wallet-state-locked")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await shot(page, "08-locked", info);
});

test("unsynced balance shows Unavailable, never 0", async ({ page }, info) => {
  await installNoir(page, { unsynced: true });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("Unavailable");
  await expect(page.getByTestId("wallet-balance-total")).toHaveText("Unavailable");
  await shot(page, "09-unsynced", info);
});

test("wrong network fails closed", async ({ page }, info) => {
  await installNoir(page, { network: "mainnet" });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-state-wrong_network")).toContainText("wallet is on mainnet");
  await expect(page.getByTestId("wallet-account-picker")).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "10-wrong-network", info);
});

test("declined connection keeps nothing", async ({ page }, info) => {
  await installNoir(page, { reject: true });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-state-rejected")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await shot(page, "11-declined", info);
});

test("no extension: not installed on desktop, desktop-only on phones", async ({ page }, info) => {
  await open(page);
  const mobile = info.project.name.includes("mobile");
  await expect(page.getByTestId(mobile ? "wallet-state-mobile_unsupported" : "wallet-state-not_installed")).toBeVisible();
  await expect(page.getByTestId("wallet-connect")).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "12-no-extension", info);
});

test("syncing: wallet still scanning shows Syncing + Unavailable, never 0", async ({ page }, info) => {
  await installNoir(page, { syncError: true });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-status-badge")).toHaveText("Connected · Syncing");
  await expect(page.getByTestId("wallet-syncing")).toContainText("not finished syncing");
  for (const k of ["shielded", "available", "total"]) await expect(page.getByTestId(`wallet-balance-${k}`)).toHaveText("Unavailable");
  await expect(page.getByTestId("wallet-balance")).not.toContainText(/\b0(\.0+)? ZEC/);
  await noSideScroll(page);
  await shot(page, "13-syncing", info);
});

test("account switching in the wallet drops balances and asks to pick again", async ({ page }, info) => {
  await installNoir(page);
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("2.50 ZEC");
  await page.evaluate(() => (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit(["wallet-b:0"]));
  await expect(page.getByTestId("wallet-state-account_changed")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await expect(page.getByTestId("wallet-account-picker")).toContainText("Pick an account again");
  await noSideScroll(page);
  await shot(page, "14-account-switched", info);
  await page.getByTestId("wallet-account-wallet-b:0").getByRole("radio").check();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("1.25 ZEC");
});

test("disconnected by the wallet clears everything", async ({ page }, info) => {
  await installNoir(page);
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("2.50 ZEC");
  await page.evaluate(() => (window as unknown as { __noirEmit: (a: unknown) => void }).__noirEmit(null));
  await expect(page.getByTestId("wallet-state-disconnected")).toBeVisible();
  await expect(page.getByTestId("wallet-balance")).toHaveCount(0);
  await expect(page.getByTestId("wallet-account-picker")).toHaveCount(0);
  await shot(page, "15-disconnected-by-wallet", info);
});

test("leak audit: no wallet data in console, network, storage or cookies", async ({ page, context }, info) => {
  const console_: string[] = [];
  const net: string[] = [];
  page.on("console", (m) => console_.push(`${m.type()} ${m.text()}`));
  page.on("pageerror", (e) => console_.push(`pageerror ${e.message}`));
  page.on("request", (r) => net.push(`${r.method()} ${r.url()}\n${JSON.stringify(r.headers())}\n${r.postData() ?? ""}`));
  await installNoir(page, { canary: true });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("7.7731 ZEC");
  await page.getByTestId("wallet-account-wallet-b:0").getByRole("radio").check();
  await expect(page.getByTestId("wallet-balance-shielded")).toHaveText("8.8842 ZEC");
  await page.getByTestId(`copy-wallet-b:0`).click().catch(() => undefined);
  const ob = page.getByTestId("business-onboarding");
  await ob.getByTestId("business-name").fill("Leak Audit Cafe");
  await ob.getByLabel("Services").check();
  await ob.getByTestId("onboarding-next").click();
  await ob.getByTestId("payout-wallet-b:0").check();
  await ob.getByTestId("onboarding-next").click();
  await ob.getByTestId("onboarding-save").click();
  await expect(ob.getByTestId("saved-summary")).toHaveText("Leak Audit Cafe · Services");
  await page.reload();
  await expect(page.getByTestId("wallet-ux-panel")).toBeVisible();
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
  const report = { viewport: info.project.name, consoleLines: console_.length, requests: net.length,
    localKeys: Object.keys(storage.local), sessionKeys: Object.keys(storage.session), idbDatabases: Object.keys(storage.idb), cookies: cookies.map((c) => c.name), hits };
  if (process.env.WALLET_UX_LEAK_REPORT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.WALLET_UX_LEAK_REPORT, JSON.stringify(report) + "\n");
  }
  expect(hits).toEqual([]);
  expect(net.length).toBeGreaterThan(0);
  expect(JSON.parse(storage.local["veilpay.businessDraft.v1"] ?? "{}")).toMatchObject({ businessName: "Leak Audit Cafe", registered: false });
});
