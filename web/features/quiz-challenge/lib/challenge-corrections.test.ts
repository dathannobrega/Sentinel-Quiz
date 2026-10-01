import { describe, expect, it } from "vitest";

import {
  correctionStatus,
  describeKey,
  describeYourAnswer,
  draftFromYourAnswer,
  revealFromFeedback,
  submissionFromFeedback
} from "@/features/quiz-challenge/lib/challenge-corrections";
import { question } from "@/features/quiz-challenge/lib/test-fixtures";
import type { LiveChallengeItemFeedback } from "@/types/api";

const base: LiveChallengeItemFeedback = {
  qi: 3,
  item_type: "single_choice",
  answered: true,
  correct: false,
  fraction: 0,
  points: 0,
  correct_option_ids: ["o_3a"],
  accepted_answers: [],
  explanation: "Porque sim.",
  your_answer: { choice: ["o_3b"] }
};

const ordering = question(3, {
  item_type: "ordering",
  options: [
    { id: "x1", text: "Detecção", index: 0 },
    { id: "x2", text: "Preparação", index: 1 },
    { id: "x3", text: "Contenção", index: 2 }
  ]
});

describe("correction status", () => {
  it("covers every verdict", () => {
    expect(correctionStatus({ answered: false, correct: null, fraction: null })).toBe("noAnswer");
    expect(correctionStatus({ answered: true, correct: null, fraction: null })).toBe("notScored");
    expect(correctionStatus({ answered: true, correct: true, fraction: 1 })).toBe("correct");
    expect(correctionStatus({ answered: true, correct: false, fraction: 0.5 })).toBe("partial");
    expect(correctionStatus({ answered: true, correct: false, fraction: 0 })).toBe("incorrect");
  });
});

describe("as text", () => {
  it("choice: option texts", () => {
    const q = question(3, { options: [{ id: "o_3a", text: "Treinamento", index: 0 }, { id: "o_3b", text: "Post-it", index: 1 }] });
    expect(describeYourAnswer(base, q, "pt-BR")).toBe("Post-it");
    expect(describeKey(base, q, "pt-BR")).toBe("Treinamento");
  });

  it("ordering: arrows in order", () => {
    const item = { ...base, item_type: "ordering" as const, correct_option_ids: [], correct_order_ids: ["x2", "x1", "x3"], your_answer: { order: ["x1", "x2", "x3"] } };
    expect(describeYourAnswer(item, ordering, "pt-BR")).toBe("Detecção → Preparação → Contenção");
    expect(describeKey(item, ordering, "pt-BR")).toBe("Preparação → Detecção → Contenção");
  });

  it("numeric: value ± tolerance with the unit in the locale", () => {
    const item = { ...base, item_type: "numeric" as const, correct_option_ids: [], numeric: { value: 256, tolerance: 10, unit: "bits" }, your_answer: { number: 275.5 } };
    expect(describeYourAnswer(item, null, "pt-BR")).toBe("275,5 bits");
    expect(describeKey(item, null, "pt-BR")).toBe("256 bits (± 10 bits)");
  });

  it("typed answers, word clouds and polls", () => {
    const typed = { ...base, item_type: "type_answer" as const, correct_option_ids: [], accepted_answers: ["smishing", "sms phishing"], your_answer: { text: "vishing" } };
    expect(describeYourAnswer(typed, null, "pt-BR")).toBe("vishing");
    expect(describeKey(typed, null, "pt-BR")).toBe("smishing · sms phishing");
    const cloud = { ...base, item_type: "word_cloud" as const, correct: null, correct_option_ids: [], your_answer: { words: ["mfa", "senha"] } };
    expect(describeYourAnswer(cloud, null, "pt-BR")).toBe("mfa · senha");
    expect(describeKey(cloud, null, "pt-BR")).toBeNull();
    expect(describeKey({ ...base, item_type: "poll" }, null, "pt-BR")).toBeNull();
    expect(describeYourAnswer({ ...base, answered: false, your_answer: undefined }, null, "pt-BR")).toBeNull();
  });
});

describe("reveal adapter", () => {
  it("builds a Reveal for the live feedback components", () => {
    const reveal = revealFromFeedback({ ...base, item_type: "ordering", correct_order_ids: ["x2", "x1", "x3"] }, ordering);
    expect(reveal.correct_option_ids).toEqual(["o_3a"]);
    expect(reveal.ordering?.correct_order_ids).toEqual(["x2", "x1", "x3"]);
    expect(reveal.my).toMatchObject({ answered: true, correct: false, points: 0, rank: null });
    expect(reveal.explanation).toBe("Porque sim.");
    expect(revealFromFeedback(base, null, 1800).my?.total_score).toBe(1800);
    const numeric = revealFromFeedback(
      { ...base, item_type: "numeric", numeric: { value: 256, tolerance: 10, unit: "bits" } },
      question(3, { item_type: "numeric", numeric: { min: 0, max: 1000, step: null, unit: "bits" } })
    );
    expect(numeric.numeric).toMatchObject({ value: 256, tolerance: 10, min: 0, max: 1000, n: 0 });
  });

  it("the person's answer as a submission (ordering ids travel in choice)", () => {
    expect(draftFromYourAnswer({ order: ["x1", "x2"] })).toEqual({ choice: ["x1", "x2"] });
    expect(submissionFromFeedback(base)?.answer).toEqual({ choice: ["o_3b"] });
    expect(submissionFromFeedback({ ...base, answered: false, your_answer: undefined })).toBeNull();
  });
});
