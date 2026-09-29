import type { Route } from "@playwright/test";

import {
  CATEGORIZATION_PAYLOAD,
  MATCHING_PAYLOAD,
  ORDERING_PAYLOAD,
  SELECT_IN_EXHIBIT_PAYLOAD,
  TABLE_FORM_PAYLOAD
} from "@/features/session-runner/lib/pbq-test-fixtures";
import type { PbqPayload, PbqTask } from "@/types/api";

import { expect, expectNoSeriousA11yViolations, registerViaUi, test } from "./fixtures";
import { t } from "./i18n";

/** Every task type in one PBQ (ids prefixed per source so they stay unique). */
function combinedPayload(): PbqPayload {
  const sources: Array<[string, PbqPayload]> = [
    ["ord", ORDERING_PAYLOAD],
    ["cat", CATEGORIZATION_PAYLOAD],
    ["mat", MATCHING_PAYLOAD],
    ["tab", TABLE_FORM_PAYLOAD],
    ["sel", SELECT_IN_EXHIBIT_PAYLOAD]
  ];
  const tasks: PbqTask[] = sources.flatMap(([prefix, payload]) =>
    payload.tasks.map((task) => ({ ...task, id: `${prefix}-${task.id}` }) as PbqTask)
  );
  return {
    title: "PBQ completa (E2E, API simulada)",
    scenario: SELECT_IN_EXHIBIT_PAYLOAD.scenario,
    exhibits: SELECT_IN_EXHIBIT_PAYLOAD.exhibits,
    tasks
  };
}

/**
 * Real-browser check of the PBQ UI with the session API mocked (runs regardless of backend PBQ
 * support): axe on every task type, keyboard ordering, native drag and drop, response shape.
 */
test("PBQ runner UI (mocked session API): keyboard, drag and drop, axe, response shape", async ({ page }) => {
  await registerViaUi(page);
  const payload = combinedPayload();
  const session = {
    id: "mock-pbq",
    exam_id: "e2e-pbq",
    selection_strategy: "standard",
    selection_mix: {},
    active_filters: {},
    total_questions: 1,
    current_index: 0,
    current_position: 0,
    correct_count: 0,
    wrong_count: 0,
    answered_count: 0,
    marked_for_review_count: 0,
    experience_mode: "standard",
    time_limit_seconds: null,
    remaining_seconds: null,
    expires_at: null,
    paused: false,
    pause_count: 0,
    auto_submitted: false,
    finished: false
  };
  const question = {
    id: "mock_pbq_1",
    exam_id: "e2e-pbq",
    prompt: payload.title,
    multi_select: false,
    domain: "Security Operations",
    difficulty: "Medium",
    certification: "Security+",
    tags: null,
    options: [],
    format: "pbq",
    pbq: payload,
    selected_keys: [],
    is_answered: false,
    marked_for_review: false,
    elapsed_seconds: null
  };
  let submitted: Record<string, unknown> | null = null;
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/sessions/mock-pbq**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^.*\/api/, "");
    const method = route.request().method();
    if (method === "GET" && path === "/sessions/mock-pbq") {
      return json(route, session);
    }
    if (method === "GET" && path === "/sessions/mock-pbq/questions/0") {
      return json(route, {
        finished: false,
        question,
        progress_index: 0,
        current_position: 0,
        total_questions: 1,
        answered_count: 0,
        marked_for_review_count: 0,
        experience_mode: "standard"
      });
    }
    if (method === "GET" && path === "/sessions/mock-pbq/review-screen") {
      return json(route, {
        session_id: "mock-pbq",
        total_questions: 1,
        answered_count: 0,
        unanswered_count: 1,
        marked_for_review_count: 0,
        current_position: 0,
        items: [{ position: 0, question_id: "mock_pbq_1", answered: false, selected_keys: [], marked_for_review: false, is_current: true, format: "pbq" }]
      });
    }
    if (method === "PUT" && path === "/sessions/mock-pbq/questions/mock_pbq_1/response") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      return json(route, {
        format: "pbq",
        is_correct: false,
        score: 0.5,
        points_earned: 1.5,
        points_possible: 3,
        task_results: payload.tasks.map((task, index) => ({ task_id: task.id, score: index % 2 ? 0 : 1, is_correct: index % 2 === 0 })),
        pbq_solution: { "ord-t1": { order: ["p", "d", "c"] }, "cat-t1": { assignment: { k1: "prev", k2: "det" } } },
        pbq_explanations: { "ord-t1": { summary: "Preparação antes da detecção.", per_item: {} } },
        justification: null,
        feedback_summary: null,
        progress_index: 0,
        total_questions: 1,
        answered_count: 1,
        correct_count: 0,
        wrong_count: 1,
        finished: false,
        official_references: [],
        insight: null,
        current_position: 0,
        marked_for_review_count: 0
      });
    }
    return route.fallback();
  });

  await page.goto("/exam/mock-pbq");
  const pbq = page.getByTestId("pbq-question");
  await expect(pbq).toBeVisible();
  await expectNoSeriousA11yViolations(page, "PBQ (all task types)");

  // Ordering: keyboard alternative (Enter on the "Down" button) + announcement.
  const down = pbq.getByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(t("pbq.ordering.moved", { item: "Contenção", position: 2, total: 3 }))).toBeAttached();
  // …and native drag and drop: "Detecção" dropped on the first slot.
  await pbq.getByTestId("pbq-order-item-d").dragTo(pbq.getByTestId("pbq-order-item-p"), { sourcePosition: { x: 8, y: 8 } });
  await expect(page.getByText(t("pbq.ordering.moved", { item: "Detecção", position: 1, total: 3 }))).toBeAttached();

  // Categorization: native drag and drop into a bucket.
  // Grab the item by its text (not the select inside the card).
  await pbq.getByTestId("pbq-cat-item-k1").dragTo(pbq.getByTestId("pbq-bucket-prev"), { sourcePosition: { x: 12, y: 12 } });
  await expect(pbq.getByTestId("pbq-bucket-prev").getByText("Bloqueio de conta", { exact: true })).toBeVisible();
  // …and the select alternative.
  await pbq.getByLabel(t("pbq.categorization.selectLabel", { item: "Alerta do SIEM" })).selectOption("det");

  await pbq.getByLabel(t("pbq.matching.selectLabel", { item: "' OR '1'='1" })).selectOption("a_sqli");
  await pbq.getByLabel(t("pbq.tableForm.cellLabel", { row: "Regra 1", column: "Valor" })).fill("30.000");
  await pbq.getByLabel(/Accepted password for deploy/).check();

  await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();
  await expect(page.getByRole("button", { name: t("pbq.feedback.hideSolution") })).toBeVisible();
  expect(submitted).not.toBeNull();
  const body = submitted as unknown as { pbq_response: Record<string, unknown>; selected_keys?: unknown };
  expect(body.selected_keys).toBeUndefined();
  expect(body.pbq_response["ord-t1"]).toEqual(["d", "p", "c"]);
  expect(body.pbq_response["cat-t1"]).toEqual({ k1: "prev", k2: "det" });
  expect(body.pbq_response["mat-t1"]).toEqual({ i1: "a_sqli" });
  expect(body.pbq_response["tab-t1"]).toEqual({ r1: { val: 30000 } });
  expect(body.pbq_response["sel-t1"]).toEqual(["l02"]);
  expect(body.pbq_response["sel-t2"]).toEqual([]);

  await expect(pbq.getByText(t("pbq.ordering.correctOrder"))).toBeVisible();
  await expectNoSeriousA11yViolations(page, "PBQ feedback with answer key");
});

/**
 * PBQ flow (contract r5 §A) against the real backend and the e2e/fixtures/questions/e2e_pbq.json
 * bank (1 PBQ + 2 MCQs). Backends without PBQ support ignore `pbq_count` and skip the PBQ item
 * while ingesting, so the test skips itself instead of failing until the backend ships PBQs.
 */
test("exam with 1 PBQ: keyboard answer → graded feedback → review shows the answer key", async ({ page }) => {
  await registerViaUi(page);
  await page.goto("/start");

  const examSelect = page.locator("#exam-id");
  // The exam list loads asynchronously: wait for a fixture exam that always exists before probing.
  await expect(examSelect.locator("option", { hasText: "E2E Security+" })).toBeAttached();
  const hasPbqBank = (await examSelect.locator("option", { hasText: "E2E PBQ" }).count()) > 0;
  test.skip(!hasPbqBank, "e2e PBQ bank not loaded by this backend");
  await examSelect.selectOption({ label: "E2E PBQ" });
  await page.locator("#session-mode").selectOption("exam");
  await page.locator("#total-questions").fill("2");
  await page.locator("#pbq-count").selectOption("1");
  await page.getByRole("button", { name: t("launcher.actions.createExam") }).click();

  const createdSession = await page
    .waitForURL(/\/exam\/[^/]+$/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!createdSession, "backend could not build a PBQ session (PBQs not supported yet)");

  const pbq = page.getByTestId("pbq-question");
  const mcqOptions = page.locator('[role="radiogroup"] [role="radio"], [role="group"] [role="checkbox"]');
  await expect(pbq.or(mcqOptions.first())).toBeVisible();
  test.skip(!(await pbq.isVisible()), "backend does not serve PBQs yet (first question is an MCQ)");

  // Ordering via the keyboard alternative: move the first item down with the button.
  const firstItemText = (await pbq.locator("[data-testid^=pbq-order-item-]").first().locator("[data-pbq-item-text]").innerText()).trim();
  const moveDown = pbq.getByRole("button", { name: t("pbq.ordering.moveDown", { item: firstItemText }) });
  await moveDown.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(t("pbq.ordering.moved", { item: firstItemText, position: 2, total: 3 }))).toBeAttached();

  // Select-in-exhibit: pick the attacker's successful login line.
  await pbq.getByLabel(/Accepted password for deploy/).check();

  await expectNoSeriousA11yViolations(page, "runner (PBQ)");

  await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();
  await expect(page.getByText(new RegExp(t("pbq.feedback.title"))).first()).toBeVisible();
  await expect(page.getByText(new RegExp(t("pbq.feedback.score", { percent: 999 }).replace("999", "\\d+"))).first()).toBeVisible();
  await expect(page.getByRole("button", { name: t("pbq.feedback.hideSolution") })).toBeVisible();

  // Answer the MCQ and submit the exam.
  await page.getByRole("button", { name: t("common.actions.nextQuestion") }).click();
  await expect(mcqOptions.first()).toBeVisible();
  await mcqOptions.first().click();
  await page.getByRole("button", { name: t("runner.actions.confirmAnswer") }).click();
  await page.getByRole("button", { name: t("runner.actions.submitExam") }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t("runner.submitConfirm.confirm") }).click();

  await page.waitForURL(/\/exam\/[^/]+\/result$/);
  await expect(page.getByText(t("pbq.review.title")).first()).toBeAttached();
  await expect(page.getByTestId("pbq-question").first()).toBeAttached();
});
