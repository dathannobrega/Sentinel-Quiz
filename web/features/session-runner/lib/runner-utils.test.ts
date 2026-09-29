import { describe, expect, it } from "vitest";

import { resolveFeedbackMessage, type AnswerFeedback } from "@/features/session-runner/lib/runner-utils";
import { createTranslator, getMessages } from "@/lib/i18n/core";

const en = createTranslator(getMessages("en-US")).t;

function studyFeedback(insight: Partial<NonNullable<AnswerFeedback["insight"]>>, extra: Partial<AnswerFeedback> = {}) {
  return {
    is_correct: true,
    justification: null,
    feedback_summary: null,
    progress_index: 1,
    total_questions: 5,
    answered_count: 1,
    correct_count: 1,
    wrong_count: 0,
    finished: false,
    official_references: [],
    confidence_level: "low",
    confidence_signal: "low",
    uncertain_correct: true,
    next_review_at: null,
    review_due_count: 0,
    insight: {
      accuracy_percent: 100,
      remaining_questions: 4,
      current_correct_streak: 1,
      weakest_area: null,
      message: "Acerto com baixa confianca.",
      ...insight
    },
    ...extra
  } as AnswerFeedback;
}

describe("resolveFeedbackMessage", () => {
  it("translates insight.message_code", () => {
    const feedback = studyFeedback({ message_code: "study_feedback.correct_low_confidence", message_params: {} });
    expect(resolveFeedbackMessage(feedback, en)).toBe(
      "Correct, but with low confidence. The review comes back early to consolidate it."
    );
  });

  it("accepts the code on the feedback itself", () => {
    const feedback = studyFeedback({}, { message_code: "study_feedback.wrong_review_soon" });
    expect(resolveFeedbackMessage(feedback, en)).toBe(
      "Mistake turned into a review. This question will come back soon for reinforcement."
    );
  });

  it("falls back to the backend message without a code or for unknown codes", () => {
    expect(resolveFeedbackMessage(studyFeedback({}), en)).toBe("Acerto com baixa confianca.");
    expect(resolveFeedbackMessage(studyFeedback({ message_code: "study_feedback.unknown" }), en)).toBe(
      "Acerto com baixa confianca."
    );
  });
});
