import type { Page } from "@playwright/test";

import { expect, registerViaUi, test } from "./fixtures";
import { t } from "./i18n";

async function launchSession(page: Page, options: { mode: "exam" | "study"; total: number }) {
  await page.goto("/start");
  await page.locator("#exam-id").selectOption({ label: "E2E Security+" });
  await page.locator("#session-mode").selectOption(options.mode);
  await page.locator("#total-questions").fill(String(options.total));
  const launchLabel = options.mode === "study" ? t("launcher.actions.createStudyBlock") : t("launcher.actions.createExam");
  await page.getByRole("button", { name: launchLabel }).click();
  await page.waitForURL(options.mode === "study" ? /\/study\/[^/]+$/ : /\/exam\/[^/]+$/);
}

function options(page: Page) {
  return page.locator('[role="radiogroup"] [role="radio"], [role="group"] [role="checkbox"]');
}

test.describe("sessions", () => {
  test("standard exam: answer all → submit → result shows the score", async ({ page }) => {
    await registerViaUi(page);
    const total = 4;
    await launchSession(page, { mode: "exam", total });
    const sessionUrl = page.url();

    for (let index = 0; index < total; index += 1) {
      await expect(page.getByText(t("runner.announce.question", { current: index + 1, total })).first()).toBeAttached();
      await options(page).first().click();
      await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();
      if (index < total - 1) {
        const next = page.getByRole("button", { name: t("common.actions.nextQuestion") });
        await expect(next).toBeEnabled();
        await next.click();
      }
    }

    await page.getByRole("button", { name: t("runner.actions.submitExam") }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: t("runner.submitConfirm.confirm") }).click();

    await page.waitForURL(`${sessionUrl}/result`);
    const score = page.getByTestId("result-score");
    await expect(score).toBeVisible();
    await expect(score.locator("dt")).toHaveText(t("results.summary.score"));
    await expect(score.locator("dd").first()).toHaveText(/^\d+(\.\d)?%$/);
  });

  test("study mode: answer with confidence and request a hint", async ({ page }) => {
    await registerViaUi(page);
    await launchSession(page, { mode: "study", total: 3 });

    await expect(options(page).first()).toBeVisible();
    await page.getByRole("button", { name: t("runner.hints.hintButton", { level: 1 }) }).click();
    await expect(page.getByText(t("runner.labels.level", { level: 1 }))).toBeVisible();

    await options(page).first().click();
    await page.locator("#confidence-level").selectOption("confident");
    await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();

    const feedback = page
      .getByRole("status")
      .filter({ hasText: new RegExp(`${t("runner.feedback.correct")}|${t("runner.feedback.wrong")}`) })
      .first();
    await expect(feedback).toBeVisible();
    await expect(page.locator("#confidence-level")).toBeDisabled();
    await expect(page.getByRole("button", { name: t("common.actions.nextQuestion") })).toBeEnabled();
  });
});
