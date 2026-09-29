// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionRunnerShell } from "@/features/session-runner/components/session-runner-shell";
import { ORDERING_FEEDBACK, ORDERING_PAYLOAD } from "@/features/session-runner/lib/pbq-test-fixtures";
import { apiClient } from "@/lib/api/client";
import { createTranslator, getMessages } from "@/lib/i18n/core";
import { I18nProvider } from "@/lib/i18n/provider";
import type {
  ExamAnswerFeedback,
  ExamQuestionState,
  ExamReviewScreen,
  SessionResponse,
  StudyAnswerFeedback,
  StudyNextQuestionResponse,
  StudySessionResponse
} from "@/types/api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/exam/s1",
  useSearchParams: () => new URLSearchParams()
}));

const { t } = createTranslator(getMessages("en-US"));

const PBQ_QUESTION = {
  id: "sq_pbq_1",
  exam_id: "securityplus",
  prompt: "Resposta a incidentes",
  multi_select: false,
  domain: "Security Operations",
  difficulty: "Medium",
  certification: "Security+",
  tags: null,
  options: [],
  format: "pbq",
  pbq: ORDERING_PAYLOAD
};

function examSession(experienceMode: "standard" | "exam_day"): SessionResponse {
  return {
    id: "s1",
    exam_id: "securityplus",
    selection_strategy: "standard",
    selection_mix: {},
    active_filters: {},
    total_questions: 2,
    current_index: 0,
    current_position: 0,
    correct_count: experienceMode === "exam_day" ? null : 0,
    wrong_count: experienceMode === "exam_day" ? null : 0,
    answered_count: 0,
    marked_for_review_count: 0,
    experience_mode: experienceMode,
    time_limit_seconds: null,
    remaining_seconds: null,
    expires_at: null,
    paused: false,
    pause_count: 0,
    auto_submitted: false,
    finished: false
  };
}

const EXAM_QUESTION_STATE: ExamQuestionState = {
  finished: false,
  question: { ...PBQ_QUESTION, selected_keys: [], is_answered: false, marked_for_review: false, elapsed_seconds: null },
  progress_index: 0,
  current_position: 0,
  total_questions: 2,
  answered_count: 0,
  marked_for_review_count: 0,
  experience_mode: "standard"
};

const REVIEW_SCREEN: ExamReviewScreen = {
  session_id: "s1",
  total_questions: 2,
  answered_count: 0,
  unanswered_count: 2,
  marked_for_review_count: 0,
  current_position: 0,
  items: [
    { position: 0, question_id: "sq_pbq_1", answered: false, selected_keys: [], marked_for_review: false, is_current: true, format: "pbq" },
    { position: 1, question_id: "q2", answered: false, selected_keys: [], marked_for_review: false, is_current: false, format: "mcq" }
  ]
};

const BASE_FEEDBACK = {
  justification: null,
  feedback_summary: null,
  progress_index: 1,
  total_questions: 2,
  answered_count: 1,
  finished: false,
  official_references: [],
  insight: null
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <I18nProvider locale="en-US" localeFromCookie>
        {children}
      </I18nProvider>
    </QueryClientProvider>
  );
}

function mockExamApi(experienceMode: "standard" | "exam_day", feedback: ExamAnswerFeedback) {
  vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
    if (path === "/sessions/s1") {
      return examSession(experienceMode);
    }
    if (path === "/sessions/s1/questions/0") {
      return { ...EXAM_QUESTION_STATE, experience_mode: experienceMode };
    }
    if (path === "/sessions/s1/review-screen") {
      return REVIEW_SCREEN;
    }
    throw new Error(`unexpected GET ${path}`);
  });
  return vi.spyOn(apiClient, "put").mockResolvedValue(feedback);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function moveFirstItemDown() {
  const down = await screen.findByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) });
  fireEvent.click(down);
}

describe("session runner with a PBQ", () => {
  it("exam (standard): sends pbq_response instead of selected_keys and shows score + answer key", async () => {
    const put = mockExamApi("standard", {
      ...BASE_FEEDBACK,
      ...ORDERING_FEEDBACK,
      is_correct: false,
      correct_count: 0,
      wrong_count: 1,
      current_position: 0,
      marked_for_review_count: 0
    });
    render(<SessionRunnerShell sessionId="s1" mode="exam" />, { wrapper });

    expect(await screen.findByTestId("pbq-question")).toBeTruthy();
    // No MCQ options / option shortcuts help for a PBQ.
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(t("runner.keyboard.help"))).toBeNull();

    await moveFirstItemDown();
    fireEvent.click(screen.getByRole("button", { name: t("runner.actions.confirmAnswer") }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [path, body] = put.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/sessions/s1/questions/sq_pbq_1/response");
    expect(body).toMatchObject({ question_id: "sq_pbq_1", pbq_response: { t1: ["p", "c", "d"] } });
    expect(body).not.toHaveProperty("selected_keys");
    expect(typeof body.elapsed_seconds).toBe("number");

    expect(await screen.findByText(new RegExp(t("pbq.feedback.score", { percent: 33 })))).toBeTruthy();
    expect(screen.getByText(t("pbq.ordering.correctOrder"))).toBeTruthy();
    expect(screen.getByText("Preparação vem antes da detecção.")).toBeTruthy();
    // Locked after answering.
    expect(screen.queryByRole("button", { name: t("pbq.ordering.moveDown", { item: "Contenção" }) })).toBeNull();
  });

  it("exam_day: records the answer without any grading, even if the backend leaks it", async () => {
    const put = mockExamApi("exam_day", {
      ...BASE_FEEDBACK,
      ...ORDERING_FEEDBACK,
      is_correct: null,
      correct_count: null,
      wrong_count: null,
      current_position: 0,
      marked_for_review_count: 0
    });
    render(<SessionRunnerShell sessionId="s1" mode="exam" />, { wrapper });

    await screen.findByTestId("pbq-question");
    // The navigator flags the PBQ item.
    const nav = screen.getByRole("navigation", { name: t("runner.navigator.listLabel") });
    expect(within(nav).getByRole("button", { name: new RegExp(t("pbq.formatLabel").replace(/[()]/g, "\\$&")) })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("runner.actions.confirmAnswer") }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t("runner.examDay.answerRecordedTitle"))).toBeTruthy();
    expect(screen.queryByText(new RegExp(t("pbq.feedback.score", { percent: 33 })))).toBeNull();
    expect(screen.queryByText(t("pbq.ordering.correctOrder"))).toBeNull();
    expect(screen.queryByText("Preparação vem antes da detecção.")).toBeNull();
    expect(screen.queryByText(new RegExp(t("pbq.feedback.taskPartial")))).toBeNull();
  });

  it("study: posts pbq_response with the confidence level", async () => {
    const studySession: StudySessionResponse = {
      id: "st1",
      exam_id: null,
      selection_strategy: "standard",
      selection_mix: {},
      total_questions: 1,
      current_index: 0,
      answered_count: 0,
      correct_count: 0,
      wrong_count: 0,
      finished: false
    };
    const next: StudyNextQuestionResponse = { finished: false, question: PBQ_QUESTION, progress_index: 0, total_questions: 1, answered_count: 0 };
    vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
      if (path === "/study/sessions/st1") {
        return studySession;
      }
      if (path === "/study/sessions/st1/next") {
        return next;
      }
      if (path.startsWith("/study/questions/")) {
        return { question_id: "sq_pbq_1", is_bookmarked: false, note: "", updated_at: null, scope: "user" };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const feedback: StudyAnswerFeedback = {
      ...BASE_FEEDBACK,
      ...ORDERING_FEEDBACK,
      score: 1,
      is_correct: true,
      correct_count: 1,
      wrong_count: 0,
      finished: true,
      task_results: [{ task_id: "t1", score: 1, is_correct: true }],
      confidence_level: "confident",
      confidence_signal: "aligned",
      uncertain_correct: false,
      next_review_at: null,
      review_due_count: 0
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(feedback);
    render(<SessionRunnerShell sessionId="st1" mode="study" />, { wrapper });

    await screen.findByTestId("pbq-question");
    fireEvent.change(screen.getByLabelText(t("runner.labels.confidence")), { target: { value: "confident" } });
    fireEvent.click(screen.getByRole("button", { name: t("runner.actions.confirmAnswer") }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(([path]) => path === "/study/sessions/st1/answer");
    expect(call?.[1]).toMatchObject({
      question_id: "sq_pbq_1",
      pbq_response: { t1: ["c", "p", "d"] },
      confidence_level: "confident"
    });
    expect(call?.[1]).not.toHaveProperty("selected_keys");
    expect(await screen.findByText(new RegExp(t("pbq.feedback.fullCredit")))).toBeTruthy();
  });
});
