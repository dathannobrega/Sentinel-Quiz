import { CHAR_LIMITS, charLimitState } from "@/features/quiz-builder/lib/limits";
import type { LiveItem, LiveItemNumeric, LiveItemOption, LiveItemType, LiveItemWrite, LiveQuizDetail } from "@/types/api";

export const ITEM_TYPES: LiveItemType[] = [
  "single_choice",
  "multi_choice",
  "true_false",
  "type_answer",
  "ordering",
  "numeric",
  "poll",
  "word_cloud",
  "content",
  "leaderboard"
];

export const SCORED_TYPES: ReadonlySet<LiveItemType> = new Set(["single_choice", "multi_choice", "true_false", "type_answer", "ordering", "numeric"]);
export const OPTION_TYPES: ReadonlySet<LiveItemType> = new Set(["single_choice", "multi_choice", "true_false", "poll"]);
/** Types with an answering phase (timer / points apply). */
export const TIMED_TYPES: ReadonlySet<LiveItemType> = new Set([
  "single_choice",
  "multi_choice",
  "true_false",
  "type_answer",
  "poll",
  "ordering",
  "numeric",
  "word_cloud"
]);

export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 6;
/** Ordering (Incremento 5): 3..6 items, written in the correct order. */
export const ORDER_MIN = 3;
export const ORDER_MAX = 6;
/** Word cloud: words per person. */
export const MAX_WORDS_MIN = 1;
export const MAX_WORDS_MAX = 3;
export const NUMERIC_UNIT_MAX = 12;
/** Server limit: at most 100 000 steps over the range (publish issue `step/too_fine`). */
export const NUMERIC_MAX_STEPS = 100_000;

/** Numeric settings of a new item (mirrors the server default). */
export const DEFAULT_NUMERIC: LiveItemNumeric = { min: 0, max: 100, step: 1, unit: "", value: null, tolerance: 0, partial: true };

/** Initial payload for POST /items. Keys are omitted (the server assigns A..F / T,F). */
export function defaultItemWrite(type: LiveItemType, labels: { true: string; false: string }): LiveItemWrite & { item_type: LiveItemType } {
  switch (type) {
    case "single_choice":
    case "multi_choice":
      return {
        item_type: type,
        prompt: "",
        options: [
          { text: "", correct: true },
          { text: "", correct: false },
          { text: "", correct: false },
          { text: "", correct: false }
        ],
        time_limit_s: 20,
        points_multiplier: 1
      };
    case "true_false":
      return {
        item_type: type,
        prompt: "",
        options: [
          { key: "T", text: labels.true, correct: true },
          { key: "F", text: labels.false, correct: false }
        ],
        time_limit_s: 20,
        points_multiplier: 1
      };
    case "type_answer":
      return { item_type: type, prompt: "", accepted_answers: [], time_limit_s: 30, points_multiplier: 1 };
    case "poll":
      return {
        item_type: type,
        prompt: "",
        options: [{ text: "" }, { text: "" }, { text: "" }],
        allow_multiple: false,
        time_limit_s: 30,
        points_multiplier: 0
      };
    case "ordering":
      return {
        item_type: type,
        prompt: "",
        options: [{ text: "" }, { text: "" }, { text: "" }, { text: "" }],
        order_method: "kendall",
        time_limit_s: 45,
        points_multiplier: 1
      };
    case "numeric":
      return {
        item_type: type,
        prompt: "",
        min: DEFAULT_NUMERIC.min ?? 0,
        max: DEFAULT_NUMERIC.max ?? 100,
        step: DEFAULT_NUMERIC.step,
        unit: "",
        tolerance: 0,
        partial: true,
        time_limit_s: 30,
        points_multiplier: 1
      };
    case "word_cloud":
      return { item_type: type, prompt: "", max_words: 1, time_limit_s: 45, points_multiplier: 0 };
    case "content":
      return { item_type: type, prompt: "", body: "", time_limit_s: null, points_multiplier: 0 };
    case "leaderboard":
    default:
      return { item_type: "leaderboard", time_limit_s: null, points_multiplier: 0 };
  }
}

/** Copy of an item as a new custom item (duplicate action). */
export function itemToWrite(item: LiveItem): LiveItemWrite & { item_type: LiveItemType } {
  return {
    ...gaFieldsToWrite(item),
    item_type: item.item_type,
    prompt: item.prompt,
    options: item.options.map((option) => ({ text: option.text, correct: option.correct, ...(item.item_type === "true_false" ? { key: option.key } : {}) })),
    accepted_answers: item.accepted_answers,
    allow_multiple: item.allow_multiple,
    all_or_nothing: item.all_or_nothing,
    body: item.body,
    time_limit_s: item.time_limit_s,
    points_multiplier: item.points_multiplier,
    explanation: item.explanation,
    presenter_notes: item.presenter_notes
  };
}

/** Settings of the GA types in the write shape (only the matching type's fields). */
export function gaFieldsToWrite(item: LiveItem): LiveItemWrite {
  if (item.item_type === "ordering") {
    return { order_method: item.order_method ?? "kendall" };
  }
  if (item.item_type === "numeric" && item.numeric) {
    const numeric = item.numeric;
    return {
      ...(numeric.min !== null ? { min: numeric.min } : {}),
      ...(numeric.max !== null ? { max: numeric.max } : {}),
      step: numeric.step,
      unit: numeric.unit,
      value: numeric.value,
      tolerance: numeric.tolerance,
      partial: numeric.partial
    };
  }
  if (item.item_type === "word_cloud") {
    return { max_words: item.max_words ?? 1 };
  }
  return {};
}

/** Options payload for PATCH: keep server keys, drop placeholders for new rows. */
export function optionsToWrite(options: LiveItemOption[]): NonNullable<LiveItemWrite["options"]> {
  return options.map((option) =>
    option.key && !option.key.startsWith("new-")
      ? { key: option.key, text: option.text, correct: option.correct }
      : { text: option.text, correct: option.correct }
  );
}

export function isBankItem(item: Pick<LiveItem, "source_kind">): boolean {
  return item.source_kind === "bank";
}

/** Apply a pending patch over the server item for display (pure). */
export function applyItemPatch(item: LiveItem, patch: LiveItemWrite | undefined): LiveItem {
  if (!patch) {
    return item;
  }
  const next: LiveItem = { ...item };
  if (patch.prompt !== undefined) next.prompt = patch.prompt;
  if (patch.options !== undefined) {
    next.options = patch.options.map((option, index) => ({
      key: option.key ?? item.options[index]?.key ?? `new-${index}`,
      text: option.text,
      correct: Boolean(option.correct)
    }));
  }
  if (patch.accepted_answers !== undefined) next.accepted_answers = patch.accepted_answers;
  if (patch.allow_multiple !== undefined) next.allow_multiple = patch.allow_multiple;
  if (patch.all_or_nothing !== undefined) next.all_or_nothing = patch.all_or_nothing;
  if (patch.body !== undefined) next.body = patch.body;
  if (patch.time_limit_s !== undefined) next.time_limit_s = patch.time_limit_s;
  if (patch.points_multiplier !== undefined) next.points_multiplier = patch.points_multiplier;
  if (patch.explanation !== undefined) next.explanation = patch.explanation;
  if (patch.presenter_notes !== undefined) next.presenter_notes = patch.presenter_notes;
  if (patch.order_method !== undefined) next.order_method = patch.order_method;
  if (patch.max_words !== undefined) next.max_words = patch.max_words;
  const numericKeys = ["min", "max", "step", "unit", "value", "tolerance", "partial"] as const;
  if (numericKeys.some((key) => patch[key] !== undefined)) {
    const numeric: LiveItemNumeric = { ...DEFAULT_NUMERIC, ...item.numeric };
    if (patch.min !== undefined) numeric.min = patch.min;
    if (patch.max !== undefined) numeric.max = patch.max;
    if (patch.step !== undefined) numeric.step = patch.step;
    if (patch.unit !== undefined) numeric.unit = patch.unit;
    if (patch.value !== undefined) numeric.value = patch.value;
    if (patch.tolerance !== undefined) numeric.tolerance = patch.tolerance;
    if (patch.partial !== undefined) numeric.partial = patch.partial;
    next.numeric = numeric;
  }
  return next;
}

export type LocalIssueCode =
  | "prompt_required"
  | "prompt_too_long"
  | "option_text_required"
  | "option_too_long"
  | "options_count"
  | "no_correct"
  | "true_false_exactly_one"
  | "accepted_required"
  | "accepted_too_long"
  | "accepted_too_many"
  | "body_too_long"
  // Incremento 5
  | "order_count"
  | "option_duplicate"
  | "numeric_range"
  | "numeric_value_required"
  | "numeric_value_out_of_range"
  | "numeric_step"
  | "numeric_step_too_fine"
  | "numeric_tolerance"
  | "unit_too_long";

export interface LocalIssue {
  code: LocalIssueCode;
  /** "prompt" | "options" | "options.<index>" | "accepted_answers" | "body" | "range" | "value" | "step" | "tolerance" | "unit" */
  field: string;
  /** "block" prevents saving the patch; "error" saves but blocks publishing. */
  severity: "block" | "error";
}

/**
 * Client-side mirror of the contract rules, used for inline messages. The server stays the
 * authority (publish returns 422 quiz_invalid with the real list).
 */
export function validateItem(item: LiveItem): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const type = item.item_type;
  if (type === "leaderboard") {
    return issues;
  }
  const prompt = charLimitState(item.prompt, CHAR_LIMITS.prompt);
  if (prompt.level === "block") {
    issues.push({ code: "prompt_too_long", field: "prompt", severity: "block" });
  } else if (type !== "content" && !item.prompt.trim()) {
    issues.push({ code: "prompt_required", field: "prompt", severity: "error" });
  }

  if (OPTION_TYPES.has(type)) {
    if (item.options.length < OPTIONS_MIN || item.options.length > OPTIONS_MAX) {
      issues.push({ code: "options_count", field: "options", severity: "error" });
    }
    item.options.forEach((option, index) => {
      const state = charLimitState(option.text, CHAR_LIMITS.option);
      if (state.level === "block") {
        issues.push({ code: "option_too_long", field: `options.${index}`, severity: "block" });
      } else if (!option.text.trim()) {
        issues.push({ code: "option_text_required", field: `options.${index}`, severity: "error" });
      }
    });
    const correct = item.options.filter((option) => option.correct).length;
    if (type === "true_false" && correct !== 1) {
      issues.push({ code: "true_false_exactly_one", field: "options", severity: "error" });
    } else if ((type === "single_choice" || type === "multi_choice") && correct < 1) {
      issues.push({ code: "no_correct", field: "options", severity: "error" });
    }
  }

  if (type === "ordering") {
    if (item.options.length < ORDER_MIN || item.options.length > ORDER_MAX) {
      issues.push({ code: "order_count", field: "options", severity: "error" });
    }
    const seen = new Set<string>();
    let duplicate = false;
    item.options.forEach((option, index) => {
      const state = charLimitState(option.text, CHAR_LIMITS.option);
      if (state.level === "block") {
        issues.push({ code: "option_too_long", field: `options.${index}`, severity: "block" });
      } else if (!option.text.trim()) {
        issues.push({ code: "option_text_required", field: `options.${index}`, severity: "error" });
      }
      const key = normalizeAnswer(option.text);
      if (key && seen.has(key)) {
        duplicate = true;
      }
      seen.add(key);
    });
    if (duplicate) {
      issues.push({ code: "option_duplicate", field: "options", severity: "error" });
    }
  }

  if (type === "numeric") {
    issues.push(...numericIssues(item.numeric ?? DEFAULT_NUMERIC));
  }

  if (type === "type_answer") {
    const answers = item.accepted_answers.filter((answer) => answer.trim());
    if (!answers.length) {
      issues.push({ code: "accepted_required", field: "accepted_answers", severity: "error" });
    }
    if (item.accepted_answers.length > 10) {
      issues.push({ code: "accepted_too_many", field: "accepted_answers", severity: "block" });
    }
    if (item.accepted_answers.some((answer) => charLimitState(answer, CHAR_LIMITS.acceptedAnswer).level === "block")) {
      issues.push({ code: "accepted_too_long", field: "accepted_answers", severity: "block" });
    }
  }

  if (type === "content" && charLimitState(item.body, CHAR_LIMITS.body).level === "block") {
    issues.push({ code: "body_too_long", field: "body", severity: "block" });
  }
  return issues;
}

/** Numeric rules of the contract (§2), as local issues. */
export function numericIssues(numeric: LiveItemNumeric): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const { min, max, step, value, tolerance } = numeric;
  const rangeOk = min !== null && max !== null && min < max;
  if (!rangeOk) {
    issues.push({ code: "numeric_range", field: "range", severity: "error" });
  } else if (value === null) {
    issues.push({ code: "numeric_value_required", field: "value", severity: "error" });
  } else if (value < (min as number) || value > (max as number)) {
    issues.push({ code: "numeric_value_out_of_range", field: "value", severity: "error" });
  }
  if (step !== null && step <= 0) {
    issues.push({ code: "numeric_step", field: "step", severity: "error" });
  } else if (step && rangeOk && ((max as number) - (min as number)) / step > NUMERIC_MAX_STEPS) {
    issues.push({ code: "numeric_step_too_fine", field: "step", severity: "error" });
  }
  if (tolerance < 0) {
    issues.push({ code: "numeric_tolerance", field: "tolerance", severity: "block" });
  }
  if (Array.from(numeric.unit ?? "").length > NUMERIC_UNIT_MAX) {
    issues.push({ code: "unit_too_long", field: "unit", severity: "block" });
  }
  return issues;
}

export function hasBlockingIssue(item: LiveItem): boolean {
  return validateItem(item).some((issue) => issue.severity === "block");
}

/** Moves one element; returns a new array (pure). Out-of-range moves return the input. */
export function moveInArray<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list.slice();
  }
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function scoredItemCount(quiz: Pick<LiveQuizDetail, "items">): number {
  return quiz.items.filter((item) => SCORED_TYPES.has(item.item_type) && item.points_multiplier > 0).length;
}

/** Normalizes a typed answer for duplicate detection (mirrors the server's normalize()). */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:,]+$/, "")
    .trim();
}
