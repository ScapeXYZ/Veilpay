import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Sealed Ledger redesign against the real Axum mock backend (regtest, practice mode), plus a
 * stubbed mainnet read-only /api/health for the connected-mode overview. Asserts the practice
 * frame, every simulation disclosure that existed before, the merchant badge wording, and that
 * no live payment chart is drawn outside practice mode. Shots go to SEALED_SHOTS when set.
 */
const SHOTS = process.env.SEALED_SHOTS;
async function shot(page: Page, name: string, testInfo: TestInfo) {
  if (!SHOTS) return;
  const vp = testInfo.project.name.includes("mobile") ? "mobile" : "desktop";
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${vp}-sealed-${name}.png`, fullPage: true });
}
async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}
async function quietTour(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("veilpay.onboarding.v1", "hidden"));
}

test("practice mode: frame, disclosures, policy sheet, privacy sheet, merchant badges", async ({ page }, testInfo) => {
  await quietTour(page);
  await page.goto("/app");
  await expect(page.getByTestId("mock-banner")).toContainText("Mock practice mode · No real money moves.");
  await expect(page.getByTestId("practice-frame")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("practice-line")).toHaveText("Practice mode. Simulated payments, no funds move.");
  const create = page.getByRole("button", { name: "Create demo agent" });
  const summary = page.getByTestId("agent-summary");
  await expect(create.or(summary)).toBeVisible({ timeout: 15_000 });
  if (await create.isVisible()) await create.click();
  await expect(summary).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("mode-card")).toContainText(/no funds move/i);
  await expect(page.getByTestId("wallet-unavailable")).toHaveText("Unavailable");
  await expect(page.getByTestId("spending-live-withheld")).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "overview", testInfo);

  // Client-side navigation keeps the demo agent selected (a full reload would drop it).
  await page.locator('a[href="/app/spending-rules"]:visible').first().click();
  const sheet = page.getByTestId("policy-sheet");
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet.getByTestId("sheet-practice")).toHaveText("practice agent");
  await expect(sheet.getByTestId("policy-sentence")).toContainText(/per payment/);
  await expect(page.getByTestId("policy-form")).toBeVisible();
  await noSideScroll(page);
  await shot(page, "policy", testInfo);

  await page.goto("/app/privacy");
  await expect(page.getByTestId("sealed-open-sheet")).toContainText("don't hide that you use VeilPay");
  await expect(page.getByTestId("privacy-chip-shielded")).toContainText("shielded");
  await expect(page.getByTestId("privacy-chip-transparent")).toContainText("transparent, visible on chain");
  await noSideScroll(page);
  await shot(page, "privacy", testInfo);

  await page.goto("/app/wallet");
  await expect(page.getByTestId("wallet-off-mock")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("wallet-journey")).toBeVisible();
  await expect(page.getByTestId("wallet-reads-sheet")).toContainText("Your keys or seed phrase");
  await noSideScroll(page);
  await shot(page, "wallet-practice", testInfo);

  await page.goto("/app/merchant");
  const form = page.getByTestId("create-invoice");
  await expect(form).toBeVisible({ timeout: 15_000 });
  await form.getByLabel("Reference").fill("INV-SEALED");
  await form.getByLabel("Amount (ZEC)").fill("0.01");
  await form.getByRole("button", { name: "Create invoice" }).click();
  await expect(form.getByTestId("invoice-created")).toBeVisible();
  const badges = page.getByTestId("invoices").locator('[data-testid^="invoice-badge-"]');
  await expect(badges.first()).toBeVisible();
  for (const t of await badges.allTextContents()) expect(t).not.toMatch(/^Paid( late)?$/);
  await noSideScroll(page);
  await shot(page, "merchant", testInfo);
});

const mainnetHealth = {
  status: "ok", network: "mainnet", wallet: "ready", walletBackend: "zingo", chainHeight: null,
  confirmationsRequired: 3, mode: "real", reconciler: { lastRunAt: null, unresolved: 0 },
  chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 100, deepReorgAlert: false },
};

test("connected read-only: no practice frame, read-only line, no live payment chart", async ({ page }, testInfo) => {
  await quietTour(page);
  await page.route("**/api/health", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(mainnetHealth) }));
  await page.goto("/app");
  await expect(page.getByTestId("mainnet-banner")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("read-only-line")).toHaveText("Read-only. VeilPay can't sign or send from here.");
  await expect(page.getByTestId("practice-frame")).toHaveCount(0);
  await expect(page.getByTestId("spending-live-withheld")).toContainText(/independently verified as confirmed/);
  await expect(page.getByTestId("spending-chart")).toHaveCount(0);
  await expect(page.getByTestId("spending-sim-label")).toHaveCount(0);
  await noSideScroll(page);
  await shot(page, "overview-readonly", testInfo);
  await page.goto("/app/wallet");
  await expect(page.getByTestId("wallet-reads-sheet")).toBeVisible({ timeout: 15_000 });
  await noSideScroll(page);
  await shot(page, "wallet-readonly", testInfo);
});

test("fonts are self-hosted: no request leaves for a font CDN", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/.test(r.url())) external.push(r.url()); });
  await quietTour(page);
  await page.goto("/app");
  await expect(page.getByTestId("practice-frame")).toBeVisible({ timeout: 15_000 });
  const families = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, h1: getComputedStyle(document.querySelector("h1")!).fontFamily }));
  expect(families.body).toMatch(/geist/i);
  expect(families.h1).toMatch(/newsreader/i);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").length)).toBeGreaterThan(0);
  expect(external).toEqual([]);
});
