import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./constants";
import { expect, test } from "./fixtures";
import { t } from "./i18n";

test("admin: login → question list is visible", async ({ page }) => {
  // The proxy (proxy.ts) guard sends anonymous visitors to /login?next=/admin.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);

  await page.locator("#auth-email").fill(ADMIN_EMAIL);
  await page.locator("#auth-password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: t("common.actions.signIn") }).click();
  await page.waitForURL("**/admin");

  await expect(page.getByRole("heading", { name: t("admin.browser.title") })).toBeVisible();
  // Fixture prompts (e2e/fixtures/questions) are listed.
  await expect(page.getByText(/tríade CIA|Web Application Firewall|SIEM|BIA|Bell-LaPadula/).first()).toBeVisible();
});
