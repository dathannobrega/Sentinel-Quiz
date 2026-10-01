/**
 * Corrections of a challenge (per-item `feedback` with policy "each" and `summary.items`) in the
 * vocabulary of the live screens: the reveal components take a `Reveal` + `MyReveal`, and the
 * final list shows "your answer" / "right answer" as text.
 */
import type { LiveAnswerDraft, LiveSubmission } from "@/features/quiz-live/lib/live-store";
import { formatWithUnit } from "@/features/quiz-live/lib/numeric";
import type { PublicQuestion, Reveal } from "@/features/quiz-live/lib/protocol";
import type { LiveChallengeItemFeedback, LiveChallengeYourAnswer } from "@/types/api";

export type CorrectionStatus = "correct" | "partial" | "incorrect" | "noAnswer" | "notScored";

export function correctionStatus(item: Pick<LiveChallengeItemFeedback, "answered" | "correct" | "fraction">): CorrectionStatus {
  if (!item.answered) {
    return "noAnswer";
  }
  if (item.correct === null) {
    return "notScored";
  }
  if (item.correct) {
    return "correct";
  }
  return item.fraction !== null && item.fraction > 0 ? "partial" : "incorrect";
}

/** The person's answer as the pads send it (ordering ids travel in `choice`). */
export function draftFromYourAnswer(answer: LiveChallengeYourAnswer | undefined): LiveAnswerDraft {
  if (!answer) {
    return {};
  }
  const draft: LiveAnswerDraft = {};
  if (answer.order) {
    draft.choice = answer.order;
  } else if (answer.choice) {
    draft.choice = answer.choice;
  }
  if (typeof answer.text === "string") {
    draft.text = answer.text;
  }
  if (typeof answer.number === "number") {
    draft.number = answer.number;
  }
  if (answer.words) {
    draft.words = answer.words;
  }
  return draft;
}

/**
 * A `Reveal` for the live RevealFeedback component: the key from the correction, no room
 * statistics (a challenge has no room), the person's own result in `my`.
 */
export function revealFromFeedback(feedback: LiveChallengeItemFeedback, question: PublicQuestion | null, runningScore: number | null = null): Reveal {
  const reveal: Reveal = {
    qi: feedback.qi,
    item_type: feedback.item_type,
    correct_option_ids: feedback.correct_option_ids ?? [],
    accepted_answers: feedback.accepted_answers ?? [],
    counts: {},
    answered: 0,
    total: 0,
    pct_correct: null,
    avg_ms: null,
    explanation: feedback.explanation ?? null,
    my: {
      answered: feedback.answered,
      correct: feedback.correct,
      fraction: feedback.fraction,
      points: feedback.points ?? 0,
      total_score: runningScore ?? 0,
      rank: null,
      rank_delta: 0,
      streak: 0
    }
  };
  if (feedback.item_type === "ordering") {
    reveal.ordering = { correct_order_ids: feedback.correct_order_ids ?? [], slot_pct_correct: [], exact: 0 };
  }
  if (feedback.item_type === "numeric" && feedback.numeric) {
    const spec = question?.numeric;
    reveal.numeric = {
      min: spec?.min ?? 0,
      max: spec?.max ?? 0,
      bins: [],
      n: 0,
      mean: null,
      median: null,
      value: feedback.numeric.value,
      tolerance: feedback.numeric.tolerance,
      unit: feedback.numeric.unit
    };
  }
  return reveal;
}

/** The person's answer as an accepted submission (what the reveal compares with the key). */
export function submissionFromFeedback(feedback: LiveChallengeItemFeedback, fallback?: LiveAnswerDraft): LiveSubmission | null {
  const answer = feedback.your_answer ? draftFromYourAnswer(feedback.your_answer) : (fallback ?? null);
  if (!answer || !feedback.answered) {
    return null;
  }
  return { qi: feedback.qi, answerId: null, answer, status: "accepted", ack: "accepted" };
}

function optionTexts(question: PublicQuestion | null, ids: readonly string[] | undefined): string[] {
  if (!ids?.length) {
    return [];
  }
  const byId = new Map((question?.options ?? []).map((option) => [option.id, option.text]));
  return ids.map((id) => byId.get(id)).filter((text): text is string => typeof text === "string");
}

/** "Your answer" as text (null when there is none). */
export function describeYourAnswer(item: LiveChallengeItemFeedback, question: PublicQuestion | null, locale: string): string | null {
  const answer = item.your_answer;
  if (!item.answered || !answer) {
    return null;
  }
  if (answer.order?.length) {
    return optionTexts(question, answer.order).join(" → ") || null;
  }
  if (answer.choice?.length) {
    return optionTexts(question, answer.choice).join(", ") || null;
  }
  if (typeof answer.number === "number") {
    return formatWithUnit(answer.number, item.numeric?.unit ?? question?.numeric?.unit, locale);
  }
  if (answer.words?.length) {
    return answer.words.join(" · ");
  }
  if (typeof answer.text === "string" && answer.text.trim()) {
    return answer.text;
  }
  return null;
}

/** The key as text (null for polls and word clouds, which have no right answer). */
export function describeKey(item: LiveChallengeItemFeedback, question: PublicQuestion | null, locale: string): string | null {
  switch (item.item_type) {
    case "ordering":
      return optionTexts(question, item.correct_order_ids).join(" → ") || null;
    case "type_answer":
      return item.accepted_answers.length ? item.accepted_answers.join(" · ") : null;
    case "numeric": {
      if (!item.numeric || typeof item.numeric.value !== "number") {
        return null;
      }
      const value = formatWithUnit(item.numeric.value, item.numeric.unit, locale);
      return item.numeric.tolerance ? `${value} (± ${formatWithUnit(item.numeric.tolerance, item.numeric.unit, locale)})` : value;
    }
    case "poll":
    case "word_cloud":
    case "content":
    case "leaderboard":
      return null;
    default:
      return optionTexts(question, item.correct_option_ids).join(", ") || null;
  }
}
