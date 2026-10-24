import { defineConfig, devices } from "@playwright/test";

const frontendPort = 3101;
const backendPort = 4001;
// Chromium treats localhost as a secure local context, so Axum's intentionally Secure
// __Host session cookie survives browser navigation. Keep the servers loopback-only.
const frontendOrigin = `http://localhost:${frontendPort}`;
const database = `/tmp/veilpay-playwright-${process.pid}.sqlite`;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: frontendOrigin, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "chromium-mobile", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: [
    {
      command: `NETWORK=regtest WALLET_BACKEND=mock DATABASE_URL=sqlite://${database} FRONTEND_ORIGIN=${frontendOrigin} BIND_ADDR=127.0.0.1:${backendPort} cargo run --locked --manifest-path backend/Cargo.toml`,
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `NEXT_PUBLIC_API_MODE=live VEILPAY_BACKEND_URL=http://127.0.0.1:${backendPort}/api npm run dev -- -p ${frontendPort}`,
      url: frontendOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
