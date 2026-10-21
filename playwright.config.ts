import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8790",
    viewport: { width: 1440, height: 1100 },
    // Installed Chrome by default; PW_CHROMIUM_PATH points at any other Chromium build (CI, sandboxes).
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox", "--disable-gpu"] } }
      : { channel: "chrome" }),
    trace: "retain-on-failure",
  },
  workers: 1,
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev:worker",
        url: "http://127.0.0.1:8790/health",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
