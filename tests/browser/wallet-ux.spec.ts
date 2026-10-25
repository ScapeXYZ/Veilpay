import { expect, test, type Page } from "@playwright/test";

/**
 * Wallet UX against the real Axum backend, with /api/health stubbed to a mainnet read-only
 * server and a FAKE window.noirwallet injected by this test harness only. App code never
 * fabricates wallet data. Screenshots go to WALLET_UX_SHOTS when set.
 */
const mainnetHealth = {
  status: "ok", network: "mainnet", wallet: "ready", walletBackend: "zingo", chainHeight: null,
  confirmationsRequired: 3, mode: "real", reconciler: { lastRunAt: null, unresolved: 0 },
  chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 100, deepReorgAlert: false },
};

type FakeOpts = { network?: "mainnet" | "testnet"; reject?: boolean; unsynced?: boolean };

async function installNoir(page: Page, opts: FakeOpts = {}) {
  await page.addInitScript((o: FakeOpts) => {
    const test = o.network === "testnet";
    const accounts = [
      { id: "wallet-a:0", label: "Treasury", walletId: "wallet-a", accountId: "0",
        addresses: { transparent: test ? "tmTreasuryTransparent000000000000" : "t1TreasuryTransparent000000000000", shielded: test ? "utest1treasuryshieldedunifiedaddress0000000000" : "u1treasuryshieldedunifiedaddress00000000000000" } },
      { id: "wallet-b:0", label: "Operations", walletId: "wallet-b", accountId: "0",
        addresses: { transparent: test ? "tmOperationsTransparent0000000000" : "t1OperationsTransparent0000000000", shielded: test ? "utest1operationsshieldedunifiedaddress00000000" : "u1operationsshieldedunifiedaddress000000000000" } },
    ];
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
  await page.route("**/api/health", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(mainnetHealth) }));
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
  await installNoir(page, { network: "testnet" });
  await open(page);
  await page.getByTestId("wallet-connect").click();
  await expect(page.getByTestId("wallet-state-wrong_network")).toContainText("wallet is on testnet");
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
