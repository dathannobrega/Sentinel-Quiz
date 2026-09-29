import { expect, expectNoSeriousA11yViolations, registerViaUi, test } from "./fixtures";
import { t } from "./i18n";

test.describe("a11y smoke (axe: fail on serious/critical)", () => {
  test("landing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "landing");
  });

  test("dashboard (with study track)", async ({ page }) => {
    await registerViaUi(page);
    // Answer one Security+ study question so the plan targets a certification (track card).
    await page.goto("/start");
    await page.locator("#exam-id").selectOption({ label: "E2E Security+" });
    await page.locator("#session-mode").selectOption("study");
    await page.locator("#total-questions").fill("1");
    await page.getByRole("button", { name: t("launcher.actions.createStudyBlock") }).click();
    await page.waitForURL(/\/study\/[^/]+$/);
    await page.locator('[role="radiogroup"] [role="radio"], [role="group"] [role="checkbox"]').first().click();
    await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();
    await expect(page.locator("#confidence-level")).toBeDisabled();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: t("dashboard.header.title") })).toBeVisible();
    await expect(page.locator("main[aria-busy=true]")).toHaveCount(0);
    await expect(page.getByTestId("study-track-card")).toBeVisible();
    await expectNoSeriousA11yViolations(page, "dashboard");
  });

  test("runner (exam)", async ({ page }) => {
    await registerViaUi(page);
    await page.goto("/start");
    await page.locator("#exam-id").selectOption({ label: "E2E Security+" });
    await page.locator("#total-questions").fill("3");
    await page.getByRole("button", { name: t("launcher.actions.createExam") }).click();
    await page.waitForURL(/\/exam\/[^/]+$/);
    await expect(page.locator('[role="radiogroup"], [role="group"]').first()).toBeVisible();
    await expectNoSeriousA11yViolations(page, "runner");
  });
});
