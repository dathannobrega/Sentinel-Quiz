import { describe, expect, it } from "vitest";

import {
  applyItemPatch,
  defaultItemWrite,
  hasBlockingIssue,
  moveInArray,
  normalizeAnswer,
  optionsToWrite,
  validateItem
} from "@/features/quiz-builder/lib/items";
import { CHAR_LIMITS, charLength, charLimitState, clampTimeLimit } from "@/features/quiz-builder/lib/limits";
import type { LiveItem } from "@/types/api";

function item(overrides: Partial<LiveItem> = {}): LiveItem {
  return {
    id: "i1",
    position: 1,
    item_type: "single_choice",
    prompt: "Qual porta usa o HTTPS?",
    options: [
      { key: "A", text: "443", correct: true },
      { key: "B", text: "80", correct: false }
    ],
    accepted_answers: [],
    allow_multiple: false,
    all_or_nothing: false,
    body: null,
    time_limit_s: 20,
    points_multiplier: 1,
    explanation: null,
    presenter_notes: null,
    source_kind: "custom",
    source_question_id: null,
    source_version_id: null,
    license_scope: "own",
    review_state: "ok",
    domain: null,
    certification: null,
    difficulty: null,
    updated_at: "2026-09-30T00:00:00Z",
    ...overrides
  };
}

describe("charLimitState", () => {
  it("is ok up to the warning, warns above it and blocks above the max", () => {
    expect(charLimitState("a".repeat(120), CHAR_LIMITS.prompt).level).toBe("ok");
    expect(charLimitState("a".repeat(121), CHAR_LIMITS.prompt).level).toBe("warn");
    expect(charLimitState("a".repeat(400), CHAR_LIMITS.prompt).level).toBe("warn");
    const blocked = charLimitState("a".repeat(401), CHAR_LIMITS.prompt);
    expect(blocked).toMatchObject({ level: "block", length: 401, remaining: -1, max: 400, warn: 120 });
    expect(charLimitState("a".repeat(61), CHAR_LIMITS.option).level).toBe("warn");
    expect(charLimitState("a".repeat(121), CHAR_LIMITS.option).level).toBe("block");
  });

  it("never warns when the limit has no warning threshold", () => {
    expect(charLimitState("a".repeat(60), CHAR_LIMITS.acceptedAnswer).level).toBe("ok");
    expect(charLimitState("a".repeat(61), CHAR_LIMITS.acceptedAnswer).level).toBe("block");
  });

  it("counts code points (emoji count once) and tolerates null", () => {
    expect(charLength("🔐ok")).toBe(3);
    expect(charLimitState(null, CHAR_LIMITS.prompt).length).toBe(0);
  });

  it("clamps the time limit into [5, 240] and keeps null", () => {
    expect(clampTimeLimit(2)).toBe(5);
    expect(clampTimeLimit(999)).toBe(240);
    expect(clampTimeLimit(30.4)).toBe(30);
    expect(clampTimeLimit(null)).toBeNull();
  });
});

describe("validateItem", () => {
  it("accepts a complete single choice (several correct allowed)", () => {
    expect(validateItem(item())).toEqual([]);
    expect(validateItem(item({ options: [{ key: "A", text: "x", correct: true }, { key: "B", text: "y", correct: true }] }))).toEqual([]);
  });

  it("flags missing prompt, empty option and no correct answer", () => {
    const issues = validateItem(item({ prompt: " ", options: [{ key: "A", text: "", correct: false }, { key: "B", text: "b", correct: false }] }));
    expect(issues.map((issue) => issue.code)).toEqual(["prompt_required", "option_text_required", "no_correct"]);
    expect(issues.every((issue) => issue.severity === "error")).toBe(true);
  });

  it("blocks over-limit text", () => {
    const long = item({ prompt: "a".repeat(401) });
    expect(validateItem(long)[0]).toMatchObject({ code: "prompt_too_long", severity: "block" });
    expect(hasBlockingIssue(long)).toBe(true);
  });

  it("true_false needs exactly one correct", () => {
    const tf = item({
      item_type: "true_false",
      options: [
        { key: "T", text: "V", correct: true },
        { key: "F", text: "F", correct: true }
      ]
    });
    expect(validateItem(tf).map((issue) => issue.code)).toEqual(["true_false_exactly_one"]);
  });

  it("type_answer needs 1..10 accepted answers of ≤ 60 chars", () => {
    expect(validateItem(item({ item_type: "type_answer", options: [] })).map((issue) => issue.code)).toEqual(["accepted_required"]);
    expect(
      validateItem(item({ item_type: "type_answer", options: [], accepted_answers: ["a".repeat(61)] })).map((issue) => issue.code)
    ).toEqual(["accepted_too_long"]);
  });

  it("polls have no correct answer and leaderboards no fields", () => {
    expect(validateItem(item({ item_type: "poll", options: [{ key: "A", text: "a", correct: false }, { key: "B", text: "b", correct: false }] }))).toEqual([]);
    expect(validateItem(item({ item_type: "leaderboard", prompt: "", options: [] }))).toEqual([]);
  });
});

describe("item helpers", () => {
  it("default payloads follow the contract per type", () => {
    const labels = { true: "Verdadeiro", false: "Falso" };
    expect(defaultItemWrite("single_choice", labels).options).toHaveLength(4);
    expect(defaultItemWrite("true_false", labels).options?.map((option) => option.key)).toEqual(["T", "F"]);
    expect(defaultItemWrite("content", labels).time_limit_s).toBeNull();
    expect(defaultItemWrite("leaderboard", labels)).toEqual({ item_type: "leaderboard", time_limit_s: null, points_multiplier: 0 });
  });

  it("optionsToWrite keeps server keys and drops placeholders", () => {
    expect(
      optionsToWrite([
        { key: "A", text: "a", correct: true },
        { key: "new-1", text: "b", correct: false }
      ])
    ).toEqual([{ key: "A", text: "a", correct: true }, { text: "b", correct: false }]);
  });

  it("applyItemPatch overlays pending edits", () => {
    const patched = applyItemPatch(item(), { prompt: "Novo", options: [{ text: "x", correct: true }, { key: "B", text: "y" }] });
    expect(patched.prompt).toBe("Novo");
    expect(patched.options).toEqual([
      { key: "A", text: "x", correct: true },
      { key: "B", text: "y", correct: false }
    ]);
    expect(applyItemPatch(item(), { time_limit_s: null }).time_limit_s).toBeNull();
  });

  it("moveInArray is pure and ignores out-of-range moves", () => {
    const list = ["a", "b", "c"];
    expect(moveInArray(list, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveInArray(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveInArray(list, 0, 5)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
  });

  it("normalizeAnswer ignores case, accents, spaces and final punctuation", () => {
    expect(normalizeAnswer("  Criptografia   ASSIMÉTRICA. ")).toBe(normalizeAnswer("criptografia assimetrica"));
  });
});
