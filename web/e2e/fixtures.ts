import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "@playwright/test";

/** baseURL comes from global-setup (free port chosen at runtime). */
export const test = base.extend({
  baseURL: async ({}, use) => {
    const url = process.env.E2E_BASE_URL;
    if (!url) {
      throw new Error("E2E_BASE_URL is not set: run through `npm run e2e` (global setup).");
    }
    await use(url);
  }
});

export { expect };

let counter = 0;

/** Unique e-mail per call (the SQLite DB lives for the whole run). */
export function uniqueEmail(prefix = "e2e"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}@example.com`;
}

/** Registers through the UI (REGISTRATION_EMAIL_VERIFICATION=false → signed in) and lands on /dashboard. */
export async function registerViaUi(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto("/register");
  await page.locator("#auth-display-name").fill("E2E Student");
  await page.locator("#auth-email").fill(email);
  await page.locator("#auth-password").fill("e2e-password-123");
  await page.locator("form button[type=submit]").click();
  await page.waitForURL("**/dashboard");
  return email;
}

/** Fails on serious/critical axe violations (WCAG 2.x A/AA rules). */
export async function expectNoSeriousA11yViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  const summary = blocking.map(
    (violation) =>
      `${violation.impact} ${violation.id}: ${violation.help}\n  ${violation.nodes
        .slice(0, 5)
        .map((node) => node.target.join(" "))
        .join("\n  ")}`
  );
  expect(summary, `axe serious/critical violations on ${label}`).toEqual([]);
}
