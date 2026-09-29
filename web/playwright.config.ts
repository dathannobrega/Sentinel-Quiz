import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the real stack (contract r4 §6): e2e/global-setup.ts starts the FastAPI backend
 * (uvicorn + temporary SQLite, fixture question bank, seeded admin) and `next start`, both on
 * free ports, and exports E2E_BASE_URL / E2E_API_URL for the tests (see e2e/fixtures.ts).
 *
 * Env knobs: E2E_PYTHON (python with backend deps, default "python3"), E2E_SKIP_BUILD=1 (reuse
 * an existing .next build), E2E_KEEP_TMP=1 (keep the temp DB/logs for debugging).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  globalSetup: "./e2e/global-setup.ts",
  // One shared backend + SQLite file: run serially for deterministic state.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    locale: "pt-BR",
    // Non-UTC zone on purpose: dates from the API must render the same instant (r4 §3).
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], locale: "pt-BR", timezoneId: "America/Sao_Paulo" } }]
});
