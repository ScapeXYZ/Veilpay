import { expect, test, type Page } from "@playwright/test";

async function createCustomerAgent(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Agent spending, shielded and on a leash")).toBeVisible();
  await expect(page.getByTestId("unknown-banner")).toHaveCount(0);
  await expect(page.getByText("regtest", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create demo agent" }).click();
  await expect(page.getByTestId("agent-summary")).toBeVisible();
}

test("live regtest/mock journey labels simulation, enforces policy, and verifies receipt", async ({ page }) => {
  await createCustomerAgent(page);
  await page.getByRole("link", { name: "Agent policy" }).click();
  await expect(page.getByRole("heading", { name: "Agent policy" })).toBeVisible();
  await expect(page.getByTestId("policy-form")).toContainText("Per-payment cap (ZEC)");

  await page.getByRole("button", { name: "Merchant" }).click();
  await page.getByRole("link", { name: "Merchant", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Merchant verification" })).toBeVisible();
  await page.getByLabel("Reference").fill("PLAYWRIGHT mock coffee");
  await page.getByLabel("Amount (ZEC)").fill("0.05");
  await page.getByRole("button", { name: "Create invoice" }).click();
  const invoice = page.getByTestId("invoice-request");
  await expect(page.getByRole("status").filter({ hasText: "Invoice created" })).toBeVisible();
  await expect(invoice).toContainText("DEMO ONLY");
  const invoiceId = await invoice.locator("p.font-mono").first().textContent();
  expect(invoiceId).toMatch(/^inv_/);

  await page.getByRole("button", { name: "Customer" }).click();
  await page.getByRole("link", { name: "Overview" }).click();
  const request = page.getByTestId("request-happy");
  await request.getByLabel("Invoice id").fill(invoiceId!);
  await request.getByLabel("Amount (ZEC)").fill("0.05");
  await request.getByRole("button", { name: "Agent: request this payment" }).click();
  await expect(page.getByTestId("payment-detail")).toContainText("Backend policy approved this payment");
  await page.getByTestId("execute").click();
  await expect(page.getByTestId("payment-detail")).toContainText("MOCK completed; simulated payment, not blockchain settlement");
  await expect(page.getByTestId("payment-detail")).toContainText("not a txid");

  const blocked = page.getByTestId("replay-blocked");
  await blocked.getByLabel("Invoice id").fill(invoiceId!);
  await blocked.getByLabel("Amount (ZEC)").fill("0.75");
  await blocked.getByRole("button", { name: "Agent: request this payment" }).click();
  await expect(page.getByTestId("violation-CAP_EXCEEDED")).toBeVisible();

  await page.getByRole("button", { name: "Merchant" }).click();
  await page.getByRole("link", { name: "Merchant", exact: true }).click();
  await expect(page.getByTestId("verification")).toContainText("Method: mock");
  await expect(page.getByTestId("verification")).toContainText("Simulated, no chain read");
  await expect(page.getByText("regtest", { exact: true })).toBeVisible();
  await expect(page.getByText("Testnet only. Demo sessions are role isolation, not authentication.")).toBeVisible();
});

test("backend unavailable state never labels data as real", async ({ page }) => {
  await page.route("**/api/health", (route) => route.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByTestId("unknown-banner")).toContainText("Backend unreachable: data source unknown");
  await expect(page.getByTestId("unknown-banner")).toContainText("Nothing on screen should be treated as real");
});
