import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Opt-in check against the REAL Noir Wallet Chrome extension (no provider mock).
// Skipped unless NOIR_EXT_PATH points at the unpacked extension (Chrome Web Store id
// mfoghjbpfanobmnoemoepenjjcmfpmdn, verified with v1.0.39). The approval popup is a real
// chrome.windows popup, which headless Chromium cannot open, so run headed, e.g.:
//   NOIR_EXT_PATH=/path/to/unpacked xvfb-run -a npx playwright test \
//     tests/browser/noir-extension-real.spec.ts --project=chromium-desktop
// The connect test creates a throwaway, never-funded wallet inside a temporary profile.
// Its recovery phrase and password exist only in memory (never logged or screenshotted) and
// the profile is deleted after each test.
const EXT = process.env.NOIR_EXT_PATH;
const APP = process.env.NOIR_APP_URL ?? `http://localhost:${process.env.VEILPAY_DEMO_FRONTEND_PORT ?? 3101}`;

test.describe("real Noir Wallet extension", () => {
  test.skip(!EXT, "set NOIR_EXT_PATH to the unpacked Noir Wallet extension to run");
  test.skip(({ isMobile }) => isMobile, "extensions only load in desktop Chromium");
  test.setTimeout(180_000);

  let ctx: BrowserContext;
  let profile: string;
  let extId: string;

  test.beforeEach(async () => {
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "noir-real-"));
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    extId = new URL(sw.url()).host;
  });

  test.afterEach(async () => {
    await ctx?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  });

  test("injects window.noirwallet on localhost but not on 127.0.0.1", async () => {
    const page = await ctx.newPage();
    await page.goto(`${APP}/app`, { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => Boolean((window as { noirwallet?: { isNoirWallet?: boolean } }).noirwallet?.isNoirWallet)), { timeout: 15_000 }).toBe(true);

    // The extension's content_scripts only match https://*/* and http://localhost/*.
    const loopback = await ctx.newPage();
    await loopback.goto(`${APP.replace("//localhost", "//127.0.0.1")}/app`, { waitUntil: "domcontentloaded" });
    await loopback.waitForTimeout(3_000);
    expect(await loopback.evaluate(() => "noirwallet" in window)).toBe(false);
  });

  test("Connect Noir Wallet opens the real approval popup and connects after approval", async () => {
    const { page, accounts } = await connectApp(ctx, extId);
    expect(accounts.shielded).toMatch(/^u1/);
    expect(accounts.transparent).toMatch(/^t1/);
    await expect(page.getByTestId("noir-balances")).toContainText(/0 ZEC/);

    // Read-only means nothing wallet-derived lands in page storage or goes to the backend.
    const storage = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }));
    for (const a of [accounts.shielded!, accounts.transparent!]) expect(storage).not.toContain(a);
  });

  test("Disconnect revokes site access and resets the card", async () => {
    const { page } = await connectApp(ctx, extId);
    await page.getByTestId("disconnect-noir-wallet").click();
    await expect(page.getByRole("button", { name: /connect noir wallet/i }).first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as unknown as { noirwallet: { zcash: { request: (a: { method: string; params: unknown[] }) => Promise<unknown> } } }).noirwallet.zcash.request({ method: "zcash_getAccounts", params: [] }))).toBeNull();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /connect noir wallet/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("disconnect-noir-wallet")).toHaveCount(0);
  });

  // The connected overview must render the wallet-reported addresses. The 09db9c9 card does not
  // render them yet, so this runs only when NOIR_EXPECT_ADDRESSES=1 (the Stage 2A overview).
  test("connected overview renders the real shielded and transparent addresses", async () => {
    test.skip(!process.env.NOIR_EXPECT_ADDRESSES, "set NOIR_EXPECT_ADDRESSES=1 on a build whose overview renders addresses");
    const { page, accounts } = await connectApp(ctx, extId);
    const body = await page.locator("body").innerText();
    for (const a of [accounts.shielded!, accounts.transparent!]) expect(body.includes(a) || body.includes(a.slice(0, 8))).toBe(true);
  });
});

type Accounts = { shielded?: string; transparent?: string };
async function connectApp(ctx: BrowserContext, extId: string): Promise<{ page: Page; accounts: Accounts }> {
  await createThrowawayWallet(await ctx.newPage(), extId);
  const page = await ctx.newPage();
  await page.goto(`${APP}/app`, { waitUntil: "domcontentloaded" });
  const connect = page.getByRole("button", { name: /connect noir wallet/i }).first();
  await expect(connect).toBeVisible({ timeout: 30_000 });
  const popupP = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("#approval"), timeout: 30_000 });
  await connect.click();
  const popup = await popupP;
  await expect(popup.getByText(/wants to connect to your wallet/i)).toBeVisible();
  // The popup closes itself on approval.
  await popup.getByRole("button", { name: /^connect( \(\d+\))?$/i }).click({ noWaitAfter: true }).catch((e) => { if (!/closed/i.test(String(e))) throw e; });
  await expect(page.getByRole("button", { name: /disconnect and revoke site access/i })).toBeVisible({ timeout: 30_000 });
  const accounts = await page.evaluate(() => (window as unknown as { noirwallet: { zcash: { request: (a: { method: string; params: unknown[] }) => Promise<Accounts> } } }).noirwallet.zcash.request({ method: "zcash_getAccounts", params: [] }));
  return { page, accounts };
}

async function createThrowawayWallet(ui: Page, extId: string) {
  const password = `Zx!${Math.random().toString(36).slice(2, 12)}Q9#`;
  await ui.goto(`chrome-extension://${extId}/index.html`);
  await ui.getByText(/create wallet/i).first().click();
  const fields = ui.locator('input[type="password"]');
  for (let i = 0; i < (await fields.count()); i++) await fields.nth(i).fill(password);
  await ui.locator('[role="checkbox"][aria-checked="false"]').first().click();
  await ui.getByRole("button", { name: /^create$/i }).click();
  await ui.getByRole("button", { name: /start backup/i }).click();
  await ui.getByRole("button", { name: /reveal seed/i }).click();
  const words: string[] = await ui.evaluate(() => {
    const out: string[] = [];
    const walk = (n: Element) => {
      for (const c of Array.from(n.children)) {
        if (c.childElementCount === 0) { const t = (c.textContent ?? "").trim(); if (/^[a-z]{3,8}$/.test(t)) out.push(t); } else walk(c);
      }
    };
    walk(document.body);
    return out;
  });
  expect(words).toHaveLength(24);
  await ui.getByText("I acknowledge").click({ force: true });
  await ui.getByRole("button", { name: /^next$/i }).click();
  const prompt = await ui.getByText(/select the \d+\w* and \d+\w* words/i).innerText();
  const [, a, b] = prompt.match(/(\d+)\w* and (\d+)\w*/) ?? [];
  for (const n of [a, b]) await ui.getByRole("button", { name: words[Number(n) - 1], exact: true }).first().click();
  await ui.getByRole("button", { name: /^confirm$/i }).click();
  const gotIt = ui.getByRole("button", { name: /^got it$/i });
  await expect(gotIt).toBeVisible({ timeout: 15_000 });
  await gotIt.click();
  await ui.close();
}
