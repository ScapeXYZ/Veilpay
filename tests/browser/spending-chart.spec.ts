import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 150_000 });

// Overview "Agent spending activity" chart against the real Axum regtest/mock backend.
// Run as its own `playwright test tests/browser/spending-chart.spec.ts` invocation (fresh SQLite,
// fresh demo-session rate-limit window), like corrections.spec.ts. Three sessions in total.

async function hideTour(page: Page) {
  await page.goto("/app");
  const skip = page.getByTestId("onboarding-skip");
  await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => skip.click(), () => undefined);
}

async function createAgent(page: Page) {
  await page.goto("/app");
  const create = page.getByRole("button", { name: "Create demo agent" });
  const summary = page.getByTestId("agent-summary");
  await expect(create.or(summary)).toBeVisible({ timeout: 15_000 });
  if (await create.isVisible()) await create.click();
  await expect(summary).toBeVisible({ timeout: 15_000 });
}

async function createInvoice(page: Page, amount: string, reference: string) {
  await page.goto("/app/merchant");
  const form = page.getByTestId("create-invoice");
  await expect(form).toBeVisible();
  await form.getByLabel("Reference").fill(reference);
  await form.getByLabel("Amount (ZEC)").fill(amount);
  await form.getByRole("button", { name: "Create invoice" }).click();
  await expect(form.getByTestId("invoice-created")).toBeVisible();
  return (await form.getByTestId("invoice-id").textContent())!.trim();
}

// Follow the visible main-nav link (desktop sidebar or mobile bottom bar) by keyboard, keeping the
// in-memory agent selection. Keyboard, because on the 390px dev server the Next.js dev-tools badge
// sits over the bottom-left Overview link and swallows pointer clicks (dev-only, not in a prod build).
async function navTo(page: Page, href: string) {
  const link = page.locator(`nav[aria-label="Main"] a[href="${href}"]:visible`).first();
  await link.focus();
  await link.press("Enter");
  await page.waitForURL((u) => u.pathname === href);
}

// Go through the owner Overview and the main nav: a direct /app/payments/new load drops the in-memory agent selection.
async function request(page: Page, invoice: string, amount: string, reference: string) {
  await navTo(page, "/app");
  await expect(page.getByTestId("agent-summary")).toBeVisible({ timeout: 15_000 });
  await navTo(page, "/app/payments");
  await page.getByTestId("new-payment").click();
  const form = page.getByTestId("request-new");
  await form.getByLabel("Invoice ID").fill(invoice);
  await form.getByLabel("Amount (ZEC)").fill(amount);
  await form.getByLabel("Reference").fill(reference);
  await form.getByTestId("request-new-submit").click();
}

test("spending chart: simulated completed spend, blocked attempt shown separately and excluded", async ({ page }, testInfo) => {
  await hideTour(page);
  const ok = await createInvoice(page, "0.05", "CHART-OK");
  const big = await createInvoice(page, "0.75", "CHART-OVER-CAP");
  await createAgent(page);

  await request(page, ok, "0.05", "CHART-OK");
  await expect(page.getByTestId("new-approved")).toBeVisible();
  await page.getByTestId("execute").click();
  await expect(page.getByText("Simulated complete", { exact: true }).first()).toBeVisible();

  await request(page, big, "0.75", "CHART-OVER-CAP");
  await expect(page.getByTestId("new-rejected")).toContainText(/blocked: this breaks a spending rule/i);

  await navTo(page, "/app");
  const card = page.getByTestId("spending-activity");
  await expect(card.getByTestId("spending-chart")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId("spending-sim-label")).toContainText(/simulated/i);
  await expect(card.getByTestId("spending-total")).toHaveText("0.05 ZEC");
  await expect(card.getByTestId("spending-blocked")).toContainText(/^1 /);
  await expect(card.getByTestId("spending-blocked")).toContainText("not spent, no money moved");
  await expect(card.getByRole("img", { name: /1 simulated payment totalling 0\.05 ZEC in the last 7 days\. 1 blocked attempt, not counted as spent/ })).toBeVisible();
  await expect(card.getByTestId("spending-footnote")).toContainText(/no funds moved and no chain settlement/i);
  await expect(card).not.toContainText(/0\.80 ZEC|0\.8 ZEC/);

  // Mobile: the card never scrolls sideways.
  const overflow = await card.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: testInfo.outputPath("chart-populated-7d.png") });

  await card.getByTestId("spending-range-30").click();
  await expect(card.getByTestId("spending-range-30")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("spending-total")).toHaveText("0.05 ZEC");
  await expect(card.getByRole("img", { name: /in the last 30 days/ })).toBeVisible();
  expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await card.screenshot({ path: testInfo.outputPath("chart-populated-30d.png") });
  await page.screenshot({ path: testInfo.outputPath("overview-with-chart.png"), fullPage: true });
});

test("spending chart: honest empty state for a fresh demo agent", async ({ page }, testInfo) => {
  await hideTour(page);
  await createAgent(page);
  const card = page.getByTestId("spending-activity");
  await expect(card.getByTestId("spending-empty")).toHaveText(/No simulated payments or blocked attempts in the last 7 days\./, { timeout: 15_000 });
  await expect(card.getByTestId("spending-chart")).toHaveCount(0);
  await card.screenshot({ path: testInfo.outputPath("chart-empty.png") });
});

test("spending chart: error state when payment history fails to load", async ({ page }, testInfo) => {
  await hideTour(page);
  // Fail only the payment-history list; the agent selection lives in memory, so no reload.
  await page.route(/\/api\/payments(\?|$)/, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "test outage" } }) }));
  await createAgent(page);
  const card = page.getByTestId("spending-activity");
  await expect(card.getByTestId("spending-error")).toContainText(/payment history could not be loaded, so no chart is shown/i, { timeout: 30_000 });
  await expect(card.getByTestId("spending-chart")).toHaveCount(0);
  await card.screenshot({ path: testInfo.outputPath("chart-error.png") });
});
