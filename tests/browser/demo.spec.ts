import { expect, test } from "@playwright/test";

async function createAgent(page: import("@playwright/test").Page) {
  await page.goto("/app");
  const create = page.getByRole("button", { name: "Create demo agent" });
  const summary = page.getByTestId("agent-summary");
  await expect(create.or(summary)).toBeVisible({ timeout: 15_000 });
  let agentId: string | null = null;
  if (await create.isVisible()) {
    const response = page.waitForResponse((r) => r.url().endsWith("/api/agents") && r.request().method() === "POST");
    await create.click();
    agentId = (await (await response).json()).id;
  }
  await expect(summary).toBeVisible({ timeout: 15_000 });
  return agentId;
}

async function createInvoice(page: import("@playwright/test").Page, amount: string, reference: string) {
  await page.goto("/app/merchant");
  const form = page.getByTestId("create-invoice");
  await expect(form).toBeVisible();
  await form.getByLabel("Reference").fill(reference);
  await form.getByLabel("Amount (ZEC)").fill(amount);
  await form.getByRole("button", { name: "Create invoice" }).click();
  await expect(form.getByTestId("invoice-created")).toBeVisible();
  return (await form.getByTestId("invoice-id").textContent())!.trim();
}

test("live regtest/mock presents the redesigned application shell as a simulation", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByTestId("mock-banner")).toContainText(/mock practice mode/i);
  await expect(page.getByTestId("status-strip").first()).toContainText("regtest");

  const primary = page.getByRole("navigation", { name: "Main" }).first();
  if ((page.viewportSize()?.width ?? 0) >= 768) {
    await expect(primary.getByRole("link")).toHaveCount(5);
    await expect(primary).toContainText("Overview");
    await expect(primary).toContainText("Spending rules");
    await expect(primary).toContainText("Payments");
    await expect(primary).toContainText("Merchant");
    await expect(primary).toContainText("Help & demo");
  } else {
    await expect(primary.getByRole("link")).toHaveCount(4);
    await page.getByTestId("nav-more").click();
    await expect(page.getByRole("dialog", { name: "More navigation" }).getByRole("link", { name: "Help & demo" })).toBeVisible();
    return;
  }

  await page.getByRole("link", { name: "Spending rules" }).click();
  await expect(page.getByRole("heading", { name: "Spending rules" })).toBeVisible();
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await page.getByRole("link", { name: "Merchant" }).click();
  await expect(page.getByRole("heading", { name: /merchant/i })).toBeVisible();
  await page.getByRole("link", { name: "Help & demo" }).click();
  await expect(page.getByRole("heading", { name: /help/i })).toBeVisible();
});

test("mobile More exposes only secondary privacy and activity routes", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "mobile navigation only");
  await page.goto("/app");
  await page.getByTestId("nav-more").click();
  const menu = page.getByRole("dialog", { name: "More navigation" });
  await expect(menu.getByRole("link", { name: "Activity" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Privacy" })).toBeVisible();
  await menu.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { name: /privacy/i })).toBeVisible();
  await page.getByTestId("nav-more").click();
  await page.getByRole("dialog", { name: "More navigation" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
});

test("backend-unavailable state is read-only and never labelled real", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort("connectionrefused"));
  await page.goto("/app");
  await expect(page.getByTestId("unknown-banner")).toContainText(/nothing on screen should be treated as real/i);
});

test("actual Axum mock flow enforces the allowance, simulates one permitted payment, and verifies its merchant receipt", async ({ page }, testInfo) => {
  const allowedInvoice = await createInvoice(page, "0.10", "BROWSER-ALLOWED");
  const agentId = await createAgent(page);
  expect(agentId).toMatch(/^agt_/);

  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /payments/i }).click();
  await page.getByTestId("new-payment").click();
  const request = page.getByTestId("request-new");
  await request.getByLabel("Invoice ID").fill(allowedInvoice);
  await request.getByLabel("Amount (ZEC)").fill("0.10");
  await request.getByLabel("Reference").fill("BROWSER-ALLOWED");
  await request.getByTestId("request-new-submit").click();
  await expect(page.getByTestId("new-approved")).toContainText(/approved: within your spending rules/i);
  await page.getByTestId("execute").click();
  await expect(page.getByTestId("send-record")).toContainText(/practice reference/i);
  await expect(page.getByTestId("send-record")).toContainText(/not a txid or a real transaction/i);
  await expect(page.getByText("Simulated complete", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("mock-banner")).toContainText(/no real money moves/i);
  await page.screenshot({ path: testInfo.outputPath("axum-regtest-permitted-payment.png"), fullPage: true });

  const paymentHref = await page.getByTestId("open-payment").getAttribute("href");
  expect(paymentHref).toMatch(/^\/app\/payments\/pay_/);
  await page.goto(paymentHref!);
  await expect(page).toHaveURL(/\/app\/payments\/pay_/);
  const paymentId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.goto("/app/merchant");
  const lookup = page.getByTestId("lookup");
  await lookup.getByLabel("Payment ID to verify").fill(paymentId);
  await lookup.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("verification")).toContainText(/method: mock.*simulated, no chain read/i);
  await expect(page.getByTestId("verification-state")).toContainText("Received");
  await page.getByTestId("ack").click();
  await expect(page.getByTestId("acknowledged")).toContainText(/marked as received/i);
  await expect(page.getByTestId("acknowledged")).toContainText(/merchant's own statement/i);
});

test("actual Axum rejects an over-cap request and leaves it visibly unpaid", async ({ page }) => {
  const oversizedInvoice = await createInvoice(page, "0.75", "BROWSER-OVER-CAP");
  await createAgent(page);

  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /payments/i }).click();
  await page.getByTestId("new-payment").click();
  const request = page.getByTestId("request-new");
  await request.getByLabel("Invoice ID").fill(oversizedInvoice);
  await request.getByLabel("Amount (ZEC)").fill("0.75");
  await request.getByTestId("request-new-submit").click();
  const rejected = page.getByTestId("new-rejected");
  await expect(rejected).toContainText(/blocked: this breaks a spending rule/i);
  await expect(rejected.getByTestId("violation-CAP_EXCEEDED")).toBeVisible();
  await expect(rejected).toContainText(/no money moved and nothing was set aside/i);
});

test("deterministic hackathon walkthrough uses one 1 ZEC agent for blocked and simulated-complete payments", async ({ page }) => {
  // All values here are the narrated demo values. The configured web servers are the
  // real loopback Axum regtest/mock backend and the Next proxy; no route is intercepted.
  const blockedInvoice = await createInvoice(page, "0.20", "DEMO-BLOCKED-0.20");
  const allowedInvoice = await createInvoice(page, "0.05", "DEMO-ALLOWED-0.05");
  const agentId = await createAgent(page);
  expect(agentId).toMatch(/^agt_/);
  await expect(page.getByTestId("agent-summary")).toContainText("1.00 ZEC");
  await expect(page.getByTestId("agent-summary")).toContainText("0.10 ZEC");

  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /payments/i }).click();
  await page.getByTestId("new-payment").click();
  let request = page.getByTestId("request-new");
  await request.getByLabel("Invoice ID").fill(blockedInvoice);
  await request.getByLabel("Amount (ZEC)").fill("0.20");
  await request.getByLabel("Reference").fill("DEMO-BLOCKED-0.20");
  await request.getByTestId("request-new-submit").click();
  const rejected = page.getByTestId("new-rejected");
  await expect(rejected.getByTestId("violation-CAP_EXCEEDED")).toBeVisible();
  await expect(rejected).toContainText(/no money moved and nothing was set aside/i);

  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: /payments/i }).click();
  await page.getByTestId("new-payment").click();
  request = page.getByTestId("request-new");
  await request.getByLabel("Invoice ID").fill(allowedInvoice);
  await request.getByLabel("Amount (ZEC)").fill("0.05");
  await request.getByLabel("Reference").fill("DEMO-ALLOWED-0.05");
  await request.getByTestId("request-new-submit").click();
  await expect(page.getByTestId("new-approved")).toBeVisible();
  await page.getByTestId("execute").click();
  await expect(page.getByText("Simulated complete", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("tx-ref")).toContainText(/practice only, not a txid or a real transaction/i);
  await expect(page.getByTestId("tx-ref")).toContainText(/^mock_[0-9a-f]{32}/i);

  const paymentHref = await page.getByTestId("open-payment").getAttribute("href");
  expect(paymentHref).toMatch(/^\/app\/payments\/pay_/);
  const paymentId = paymentHref!.split("/").at(-1)!;
  await page.goto("/app/merchant");
  const lookup = page.getByTestId("lookup");
  await lookup.getByLabel("Payment ID to verify").fill(paymentId);
  await lookup.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("verification-method")).toContainText(/mock.*simulated, no chain read.*not evidence/i);
  await page.getByTestId("ack").click();
  await expect(page.getByTestId("acknowledged")).toContainText(/not independent blockchain settlement/i);

  await page.goto("/app/activity");
  await expect(page.getByTestId("activity-table")).toContainText("DEMO-BLOCKED-0.20");
  await expect(page.getByTestId("activity-table")).toContainText("DEMO-ALLOWED-0.05");
  await page.getByTestId("view-blocked").click();
  await expect(page.getByTestId("activity-table")).toContainText("DEMO-BLOCKED-0.20");
  await page.getByTestId("view-verified").click();
  await expect(page.getByTestId("activity-table")).toContainText("DEMO-ALLOWED-0.05");

  await page.goto("/app");
  await page.getByLabel("Existing agent ID").fill(agentId!);
  await page.getByRole("button", { name: "Select agent" }).click();
  await expect(page.getByTestId("metric-spent")).toContainText("0.05 ZEC");
  await expect(page.getByTestId("metric-remaining")).toContainText("0.95 ZEC");
  await expect(page.getByTestId("mock-banner")).toContainText(/every payment, confirmation and receipt here is pretend/i);
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length }))).toEqual({ local: 0, session: 0 });
});

test("loading state is shown while the Axum health response is pending", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  const loading = page.goto("/app");
  await expect(page.getByRole("status", { name: "Loading" }).first()).toBeVisible();
  await loading;
});

test("mainnet read-only view fails closed", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      status: "ok", network: "mainnet", wallet: "ready", walletBackend: "zingolib", mode: "real",
      chainHeight: null, confirmationsRequired: 3,
      reconciler: { lastRunAt: null, unresolved: 0 },
      chainWatcher: { supported: false, lastBlockAt: null, watchDepth: 0, deepReorgAlert: false },
    }),
  }));
  await page.goto("/app/payments/new");
  await expect(page.getByTestId("new-payment-mainnet")).toContainText(/no new payments on mainnet/i);
  await expect(page.getByTestId("new-payment-mainnet")).toContainText(/never requests or sends payments there/i);
});

test("dashboard does not claim a wallet balance or privacy guarantees it cannot prove", async ({ page }) => {
  await createAgent(page);
  await expect(page.getByTestId("metric-wallet")).toContainText(/not shown.*shared/i);
  await expect(page.getByTestId("wallet-unavailable")).toHaveText("Unavailable");
  await expect(page.getByTestId("mode-card")).toContainText(/no funds move/i);
});
