import { expect, registerViaUi, test, uniqueEmail } from "./fixtures";
import { t } from "./i18n";

test.describe("signup", () => {
  test("landing → register → dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1").first()).toBeVisible();

    await page.getByRole("link", { name: t("common.actions.createAccount") }).first().click();
    await expect(page).toHaveURL(/\/register$/);

    const email = uniqueEmail("signup");
    await page.locator("#auth-display-name").fill("E2E Student");
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill("e2e-password-123");
    await page.getByRole("button", { name: t("common.actions.createAccount") }).click();

    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: t("dashboard.header.title") })).toBeVisible();

    // The session cookie is real: /auth/me resolves to the new account.
    const me = await page.request.get(`${process.env.E2E_API_URL}/api/auth/me`);
    expect(me.status()).toBe(200);
    expect((await me.json()).email).toBe(email);
  });

  test("duplicate registration is rejected without leaking a session", async ({ page }) => {
    const email = await registerViaUi(page);
    await page.context().clearCookies();
    await page.goto("/register");
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill("another-password-123");
    await page.getByRole("button", { name: t("common.actions.createAccount") }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/register$/);
  });
});
