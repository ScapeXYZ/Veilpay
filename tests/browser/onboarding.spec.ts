import { expect, test, type Page } from "@playwright/test";

const tour = (page: Page) => page.getByTestId("onboarding");

async function openHelp(page: Page) {
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    await page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name: "Safety & settings" }).click();
  } else {
    await page.getByTestId("nav-more").click();
    await page.getByRole("dialog", { name: "More navigation" }).getByRole("link", { name: "Safety & settings" }).click();
  }
  await expect(page.getByRole("heading", { name: /help & demo/i })).toBeVisible();
}

test("first visit to /app offers an optional tour that does not block the page", async ({ page }) => {
  await page.goto("/app");
  await expect(tour(page)).toBeVisible();
  await expect(tour(page)).toHaveAttribute("aria-modal", "false");
  await expect(page.getByRole("heading", { name: "Welcome to VeilPay" })).toBeFocused();
  await expect(page.getByTestId("mock-banner")).toBeVisible();
  await expect(page.getByTestId("onboarding-back")).toBeDisabled();
});

test("Next and Back walk the wallet, agent, policy, request, authorization, merchant, and activity journey", async ({ page }) => {
  await page.goto("/app");
  const steps: [RegExp, string][] = [
    [/\/app\/wallet$/, "Wallet and privacy"],
    [/\/app\/spending-rules$/, "Your payment agent"],
    [/\/app\/spending-rules$/, "Spending rules"],
    [/\/app\/payments$/, "Payment requests"],
    [/\/app\/payments$/, "Wallet authorization"],
    [/\/app\/merchant$/, "Merchant verification"],
    [/\/app\/activity$/, "Activity and receipts"],
  ];
  for (const [url, title] of steps) {
    await page.getByTestId("onboarding-next").click();
    await expect(page).toHaveURL(url);
    await expect(tour(page).getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByTestId("onboarding-back").click();
  await expect(page).toHaveURL(/\/app\/merchant$/);
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("onboarding-next").click(); // Finish
  await expect(tour(page)).toHaveCount(0);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test("Skip closes the tour without navigating", async ({ page }) => {
  await page.goto("/app");
  await page.getByTestId("onboarding-skip").click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/app$/);
});

test("keyboard only: Tab reaches the controls, Enter advances, Escape closes", async ({ page }) => {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Welcome to VeilPay" })).toBeFocused();
  // Focus starts on the step heading. Tab order after it: don't-show-again, skip, back (disabled, skipped), next.
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("onboarding-hide")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(tour(page).getByRole("button", { name: "Close the tour" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("onboarding-hide")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("onboarding-skip")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("onboarding-next")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/wallet$/);
  await expect(tour(page).getByRole("heading", { name: "Wallet and privacy" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
});

test("Don't show again persists across reloads and new sessions, and Safety & settings restarts it", async ({ page, context }) => {
  await page.goto("/app");
  await page.getByTestId("onboarding-hide").check();
  await page.getByTestId("onboarding-skip").click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);

  const fresh = await context.newPage(); // new tab = new sessionStorage, same localStorage
  await fresh.goto("/app");
  await expect(fresh.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  await expect(tour(fresh)).toHaveCount(0);
  await fresh.close();

  await openHelp(page);
  await expect(page.getByTestId("help-start-demo")).toHaveText(/try interactive demo/i);
  await page.getByTestId("help-restart-onboarding").click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(tour(page)).toBeVisible();
  await expect(page.getByTestId("onboarding-hide")).toBeChecked();
});

test("reviewed pages never scroll sideways (long ids and notes wrap on mobile)", async ({ page }) => {
  for (const path of ["/", "/app", "/app/spending-rules", "/app/payments", "/app/merchant", "/app/activity", "/app/privacy", "/app/help", "/demo"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Compare with the configured viewport: on mobile emulation innerWidth itself grows with the overflow.
    const overflow = (await page.evaluate(() => document.documentElement.scrollWidth)) - page.viewportSize()!.width;
    expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});

test("copy: interactive demo naming and simulation qualifiers are present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("cta-demo")).toHaveText(/try interactive demo/i);
  await expect(page.getByTestId("landing-demo-note")).toContainText(/simulated/i);
  await expect(page.getByText(/watch the 2-minute demo/i)).toHaveCount(0);
  await page.goto("/app/help");
  await expect(page.getByTestId("help-start-demo")).toHaveText(/try interactive demo/i);
  await expect(page.getByText(/watch the 2-minute demo/i)).toHaveCount(0);
  await page.goto("/app/merchant");
  await expect(page.getByRole("heading", { name: "Merchant portal" })).toBeVisible();
  await expect(page.getByTestId("mock-banner")).toContainText(/mock practice mode/i);
  await expect(page.getByText(/mainnet.*watch/i)).toHaveCount(0);
});
