import { describe, expect, it } from "vitest";

import {
  EMPTY_SELECTION,
  aiLanguageFor,
  aiLimitsFrom,
  buildApplyRequest,
  canAfford,
  initialSelection,
  isDraftBlocked,
  jobElapsedSeconds,
  jobStepIndex,
  needsKeyConfirmation,
  proposalChanges,
  resolveAiUnavailable,
  selectValidDrafts,
  sourceFormErrors,
  toGenerateIn,
  toggleDraft,
  topicFormErrors,
  type AiSourceForm,
  type AiTopicForm
} from "@/features/quiz-builder/lib/ai";
import { normalizeErrorResponse } from "@/lib/api/errors";
import type { AiCapabilities, AiDraftItem, AiIssue } from "@/types/api";

function draft(index: number, overrides: Partial<AiDraftItem> = {}): AiDraftItem {
  return {
    index,
    item_type: "single_choice",
    prompt: `Q${index}`,
    options: [
      { key: "A", text: "a", correct: true, why_wrong: null },
      { key: "B", text: "b", correct: false, why_wrong: "because" }
    ],
    accepted_answers: [],
    explanation: "",
    time_limit_s: 20,
    difficulty: "Medium",
    domain: "IAM",
    certification: "securityplus",
    issues: [],
    critic: null,
    applied: false,
    blocked: false,
    ...overrides
  };
}

const errorIssue: AiIssue = { code: "duplicate_option", severity: "error", message: "dup", field: "options" };
const warningIssue: AiIssue = { code: "length_bias", severity: "warning", message: "long", field: "options" };

const DRAFTS = [
  draft(0),
  draft(1, { issues: [warningIssue] }),
  draft(2, { issues: [errorIssue] }),
  draft(3, { blocked: true }),
  draft(4, { applied: true })
];

describe("draft selection", () => {
  it("treats error issues and blocked drafts as blocked (warnings are fine)", () => {
    expect(DRAFTS.map(isDraftBlocked)).toEqual([false, false, true, true, false]);
  });

  it("pre-selects every valid, not applied draft (capped by capacity)", () => {
    expect(selectValidDrafts(DRAFTS)).toEqual([0, 1]);
    expect(selectValidDrafts(DRAFTS, 1)).toEqual([0]);
    expect([...initialSelection(DRAFTS).selected]).toEqual([0, 1]);
  });

  it("cannot select a blocked draft without force, and forcing records it", () => {
    const blocked = DRAFTS[2] as AiDraftItem;
    expect(toggleDraft(EMPTY_SELECTION, blocked)).toBe(EMPTY_SELECTION);
    const forced = toggleDraft(EMPTY_SELECTION, blocked, { force: true });
    expect([...forced.selected]).toEqual([2]);
    expect([...forced.forced]).toEqual([2]);
    // Deselecting drops the force too.
    const cleared = toggleDraft(forced, blocked);
    expect(cleared.selected.size).toBe(0);
    expect(cleared.forced.size).toBe(0);
  });

  it("never toggles applied drafts and respects capacity", () => {
    const applied = DRAFTS[4] as AiDraftItem;
    expect(toggleDraft(EMPTY_SELECTION, applied)).toBe(EMPTY_SELECTION);
    const one = toggleDraft(EMPTY_SELECTION, DRAFTS[0] as AiDraftItem, { capacity: 1 });
    expect(toggleDraft(one, DRAFTS[1] as AiDraftItem, { capacity: 1 })).toBe(one);
  });

  it("builds the apply body: blocked drafts excluded unless forced, force only when needed", () => {
    // Blocked indexes slipped into `selected` without a force are dropped.
    const sneaky = { selected: new Set([0, 2, 3, 4]), forced: new Set<number>() };
    expect(buildApplyRequest(DRAFTS, sneaky)).toEqual({ indexes: [0], force: false });

    let selection = initialSelection(DRAFTS);
    expect(buildApplyRequest(DRAFTS, selection)).toEqual({ indexes: [0, 1], force: false });
    selection = toggleDraft(selection, DRAFTS[3] as AiDraftItem, { force: true });
    expect(buildApplyRequest(DRAFTS, selection)).toEqual({ indexes: [0, 1, 3], force: true });
  });

  it("flags drafts whose critic requires confirming the key", () => {
    expect(needsKeyConfirmation(null)).toBe(false);
    expect(needsKeyConfirmation({ solved_keys: ["A"], confidence: 0.9, flags: ["factual_issue"], notes: [] })).toBe(false);
    expect(needsKeyConfirmation({ solved_keys: ["B"], confidence: 0.9, flags: ["key_mismatch"], notes: [] })).toBe(true);
    expect(needsKeyConfirmation({ solved_keys: ["A"], confidence: 0.5, flags: ["ambiguous"], notes: [] })).toBe(true);
  });
});

describe("forms", () => {
  const limits = aiLimitsFrom(undefined);
  const topic: AiTopicForm = {
    topic: "",
    certification: "",
    domains: [],
    audience: "",
    level: "mixed",
    n: 5,
    types: ["single_choice"],
    language: "pt-BR"
  };

  it("requires a topic or a certification, types and a valid count", () => {
    expect(topicFormErrors(topic, limits, 20)).toEqual(["topicOrCertification"]);
    expect(topicFormErrors({ ...topic, certification: "securityplus" }, limits, 20)).toEqual([]);
    expect(topicFormErrors({ ...topic, topic: "x".repeat(501), types: [], n: 21 }, limits, 20)).toEqual(["topicTooLong", "types", "count"]);
  });

  it("builds GenerateIn without empty optionals (domains only with a certification)", () => {
    expect(toGenerateIn("q1", { ...topic, topic: "  IAM  ", domains: ["x"] })).toEqual({
      quiz_id: "q1",
      topic: "IAM",
      level: "mixed",
      n: 5,
      types: ["single_choice"],
      language: "pt-BR"
    });
    expect(toGenerateIn("q1", { ...topic, certification: "c", domains: ["d"], audience: "SOC" })).toMatchObject({
      certification: "c",
      domains: ["d"],
      audience_note: "SOC"
    });
  });

  it("validates the pasted text between 200 and the source limit", () => {
    const source: AiSourceForm = { text: "a".repeat(199), titleHint: "", level: "Easy", n: 3, types: ["true_false"], language: "en" };
    expect(sourceFormErrors(source, limits, 20)).toEqual(["sourceTooShort"]);
    expect(sourceFormErrors({ ...source, text: "a".repeat(200) }, limits, 20)).toEqual([]);
    expect(sourceFormErrors({ ...source, text: "a".repeat(20001) }, limits, 20)).toEqual(["sourceTooLong"]);
  });

  it("maps the quiz language", () => {
    expect(aiLanguageFor("en-US")).toBe("en");
    expect(aiLanguageFor("pt-BR")).toBe("pt-BR");
  });
});

describe("availability, credits and progress", () => {
  const caps = (overrides: Partial<AiCapabilities> = {}): AiCapabilities => ({
    enabled: true,
    reason: null,
    provider: "fake",
    model: "m",
    critic_enabled: true,
    credits: { daily_limit: 300, used_today: 10, remaining: 290 },
    limits: { max_items: 20, source_max_chars: 20000, topic_max_chars: 500 },
    item_types: ["single_choice"],
    certifications: [],
    ...overrides
  });

  it("resolves why AI is unavailable", () => {
    expect(resolveAiUnavailable(caps(), null)).toBeNull();
    expect(resolveAiUnavailable(caps({ enabled: false, reason: "not_allowed" }), null)).toBe("not_allowed");
    expect(resolveAiUnavailable(caps({ credits: { daily_limit: 300, used_today: 300, remaining: 0 } }), null)).toBe("quota_exhausted");
    const disabled = normalizeErrorResponse({ status: 404, body: JSON.stringify({ detail: "x", code: "ai_disabled" }) });
    expect(resolveAiUnavailable(undefined, disabled)).toBe("ai_disabled");
  });

  it("checks the cost against the remaining credits (null = unlimited)", () => {
    expect(canAfford(caps(), 290)).toBe(true);
    expect(canAfford(caps(), 291)).toBe(false);
    expect(canAfford(caps({ credits: { daily_limit: null, used_today: 0, remaining: null } }), 9999)).toBe(true);
  });

  it("maps stages to stepper steps", () => {
    expect(jobStepIndex({ status: "queued", progress: { stage: "queued", pct: 0 } })).toBe(0);
    expect(jobStepIndex({ status: "running", progress: { stage: "validating", pct: 50 } })).toBe(1);
    expect(jobStepIndex({ status: "running", progress: { stage: "critic", pct: 80 } })).toBe(2);
    expect(jobStepIndex({ status: "succeeded", progress: { stage: "done", pct: 100 } })).toBe(4);
  });

  it("computes elapsed seconds until the job finished", () => {
    const start = "2026-09-30T10:00:00Z";
    expect(jobElapsedSeconds({ created_at: start, finished_at: null }, Date.parse(start) + 12_400)).toBe(12);
    expect(jobElapsedSeconds({ created_at: start, finished_at: "2026-09-30T10:00:30Z" }, Date.parse(start) + 99_000)).toBe(30);
  });
});

describe("proposalChanges", () => {
  it("lists before/after only for changed fields", () => {
    const item = { prompt: "Old?", options: [{ key: "A", text: "x", correct: true }], explanation: null };
    const changes = proposalChanges(item, {
      prompt: "New?",
      explanation: "Because",
      options: [{ key: "A", text: "y", correct: true }],
      changed: ["prompt", "explanation"]
    });
    expect(changes).toEqual([
      { field: "prompt", before: "Old?", after: "New?" },
      { field: "explanation", before: "", after: "Because" }
    ]);
  });
});
