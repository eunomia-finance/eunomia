// Re-takes the product screenshots the README shows, from a real run on testnet:
//
//   npx playwright test --config playwright.shots.config.ts
//
// Not part of the test suites (its files end in .shots.ts, which the other configs do not
// match). Nothing in the pictures is staged: the treasury is created, funded with TRY through
// the anchor, paid from and refused from, in the run that photographs it.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.shots.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 600_000,
  use: {
    baseURL: "http://localhost:5173",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    // A selector that never matches should fail in seconds, not sit out the whole run.
    actionTimeout: 30_000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
    env: { VITE_ENABLE_TEST_SIGNER: "true" },
  },
});
