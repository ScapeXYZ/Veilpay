import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 120_000 });

// Reviewer walkthrough corrections, exercised against the real Axum regtest/mock backend.

// Dismiss the optional tour through its own UI (no direct storage writes in tests either).
async function hideTour(page: Page) {
  await page.goto("/app");
  const skip = page.getByTestId("onboarding-skip");
  await skip.waitFor({ state: "visible", timeout: 5_000 }).then(() => skip.click(), () => undefined);
}

async function simulatedPayment(page: Page): Promise<string> {
  await page.goto("/app/merchant");
  const form = page.getByTestId("create-invoice");
  await expect(form).toBeVisible();
  await form.getByLabel("Reference").fill("BROWSER-CORRECTIONS");
  await form.getByLabel("Amount (ZEC)").fill("0.05");
  await form.getByRole("button", { name: "Create invoice" }).click();
  await expect(form.getByTestId("invoice-created")).toBeVisible();
  const invoice = (await form.getByTestId("invoice-id").textContent())!.trim();

  await page.goto("/app");
  const create = page.getByRole("button", { name: "Create demo agent" });
  const summary = page.getByTestId("agent-summary");
  await expect(create.or(summary)).toBeVisible({ timeout: 15_000 });
  if (await create.isVisible()) await create.click();
  await expect(summary).toBeVisible({ timeout: 15_000 });

  const paymentNavigationLabel = (page.viewportSize()?.width ?? 0) >= 768 ? "Payment requests" : "Requests";
  await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: paymentNavigationLabel }).click();
  await page.getByTestId("new-payment").click();
  const request = page.getByTestId("request-new");
  await request.getByLabel("Invoice ID").fill(invoice);
  await request.getByLabel("Amount (ZEC)").fill("0.05");
  await request.getByLabel("Reference").fill("BROWSER-CORRECTIONS");
  await request.getByTestId("request-new-submit").click();
  await expect(page.getByTestId("new-approved")).toBeVisible();
  await page.getByTestId("execute").click();
  await expect(page.getByText("Simulated complete", { exact: true }).first()).toBeVisible();
  const href = await page.getByTestId("open-payment").getAttribute("href");
  await page.goto(href!);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

// One test on purpose: the Axum demo backend allows 30 demo sessions per minute per IP
// (backend/src/lib.rs, demo_rate_limits) and the existing suite already uses most of that budget.
// Run this spec as its own `playwright test tests/browser/corrections.spec.ts` invocation: every
// invocation starts a fresh SQLite database, so the rate-limit window starts empty.
test("walkthrough corrections: payment id copy, simulated privacy/confirmations/labels, merchant verify journey", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await hideTour(page);
  const id = await simulatedPayment(page);

  // 1: visible Payment ID with one-click copy
  const record = page.getByTestId("send-record");
  await expect(record.getByTestId("payment-id-value")).toHaveText(id);
  await record.getByTestId("copy-payment-id").click();
  await expect(record.getByTestId("copy-payment-id-status")).toHaveText("Copied to clipboard");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  // 2: never "Not sent yet" after a completed simulated payment; mock execution vs real settlement
  await expect(record.getByTestId("detail-privacy")).not.toContainText(/not sent yet/i);
  await expect(record.getByTestId("detail-privacy")).toContainText(/mock execution only.*no real shielded settlement/i);
  // 4 + 7: simulated confirmations and one status vocabulary
  await expect(record.getByTestId("detail-confirmations")).toContainText(/simulated confirmation/);
  await expect(record.getByTestId("detail-status")).toHaveText("Simulated complete");
  await expect(page.getByTestId("timeline")).toContainText("Simulated complete");
  await page.screenshot({ path: testInfo.outputPath("corrections-payment-details.png"), fullPage: true });

  // 6 + 3 + 5: merchant copy-paste journey, simulated match wording, ack never claims funds arrived
  await page.getByRole("link", { name: "Merchant page" }).click();
  const lookup = page.getByTestId("lookup");
  await expect(lookup.getByTestId("verify-steps")).toContainText(/find Payment ID under Payment details and press Copy/i);
  await lookup.getByTestId("verify-input").fill(`  ${id}  `);
  await lookup.getByTestId("verify-input").press("Enter");
  const card = page.getByTestId("verification");
  await expect(card.getByTestId("verification-state")).toHaveText("Simulated match");
  await expect(card).toContainText("The simulated payment matches the invoice.");
  await expect(card).not.toContainText(/expected amount arrived|right amount arrived/i);
  await expect(card.getByTestId("verification-confirmations")).toContainText(/simulated confirmation/);
  await page.getByTestId("ack").click();
  await expect(page.getByTestId("acknowledged")).toContainText(/not proof that any funds arrived/i);
  await page.screenshot({ path: testInfo.outputPath("corrections-merchant.png"), fullPage: true });
});
