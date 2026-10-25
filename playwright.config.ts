import { defineConfig, devices } from "@playwright/test";

const frontendPort = Number(process.env.VEILPAY_DEMO_FRONTEND_PORT ?? 3101);
const backendPort = Number(process.env.VEILPAY_DEMO_BACKEND_PORT ?? 4001);
// Chromium treats localhost as a secure local context, so Axum's intentionally Secure
// __Host session cookie survives browser navigation. Keep the servers loopback-only.
const frontendOrigin = `http://localhost:${frontendPort}`;
const database = process.env.VEILPAY_DEMO_DATABASE ?? `/tmp/veilpay-playwright-${process.pid}.sqlite`;

export default defineConfig({
  testDir: "./tests/browser",
  // The loopback backend uses one explicit fixture database and cookie scope.
  // Keep scenarios isolated by running them serially; capture has its own config.
  testIgnore: "demo-capture.spec.ts",
  fullyParallel: false,
  workers: 1,
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
      // Do not call `npm run dev`: its production default pins the mainnet
      // backend on port 4000. This harness intentionally supplies its own
      // loopback regtest/mock endpoint above.
      command: `NEXT_PUBLIC_API_MODE=live VEILPAY_BACKEND_URL=http://127.0.0.1:${backendPort}/api ./node_modules/.bin/next dev -H 127.0.0.1 -p ${frontendPort}`,
      url: frontendOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
