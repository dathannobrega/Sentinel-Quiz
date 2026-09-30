/**
 * Pure helpers for the AI authoring screens (Incremento 2): job lifecycle, draft selection rules,
 * credit math and the before/after diff of an improvement proposal. No React here, so every rule
 * is unit-tested in isolation.
 */
import { isJobActive } from "@/lib/api/ai-authoring";
import { ApiError } from "@/lib/api/client";
import type {
  AiCapabilities,
  AiDraftItem,
  AiFromSourceIn,
  AiGenerateIn,
  AiItemType,
  AiJob,
  AiJobStage,
  AiLanguage,
  AiProposal,
  LiveItem
} from "@/types/api";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export { AI_POLL_INTERVAL_MS, isJobActive, jobRefetchInterval, markDraftsApplied } from "@/lib/api/ai-authoring";

/** Visible steps of the progress stepper (queued is shown as the first step "generating"). */
export const JOB_STEPS = ["generating", "validating", "critic", "done"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** Index of the current step in JOB_STEPS (queued → 0). Finished jobs point past the last step. */
export function jobStepIndex(job: Pick<AiJob, "status" | "progress">): number {
  if (!isJobActive(job.status)) return JOB_STEPS.length;
  const stage: AiJobStage = job.progress?.stage ?? "queued";
  if (stage === "queued") return 0;
  return Math.max(0, JOB_STEPS.indexOf(stage as JobStep));
}

export function clampPct(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Seconds elapsed since the job was created (until it finished). */
export function jobElapsedSeconds(job: Pick<AiJob, "created_at" | "finished_at">, now: number): number {
  const start = Date.parse(job.created_at);
  if (Number.isNaN(start)) return 0;
  const end = job.finished_at ? Date.parse(job.finished_at) : now;
  return Math.max(0, Math.round(((Number.isNaN(end) ? now : end) - start) / 1000));
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Availability and credits
// ---------------------------------------------------------------------------

export type AiUnavailableReason = "ai_disabled" | "not_allowed" | "quota_exhausted" | "unavailable";

/** Why AI generation cannot be used right now (null = available). The bank draw never needs AI. */
export function resolveAiUnavailable(data: AiCapabilities | undefined, error: unknown): AiUnavailableReason | null {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.code === "ai_disabled") return "ai_disabled";
    if (error.status === 401 || error.status === 403) return "not_allowed";
    return "unavailable";
  }
  if (!data) return null;
  if (!data.enabled) return data.reason ?? "ai_disabled";
  if (data.credits.remaining !== null && data.credits.remaining <= 0) return "quota_exhausted";
  return null;
}

export const CREDITS_PER_ITEM = 1;
export const CREDITS_PER_IMPROVE = 0.5;

export function generationCost(n: number): number {
  return Math.max(0, Math.round(n)) * CREDITS_PER_ITEM;
}

/** True when `cost` fits in the remaining credits (null remaining = unlimited). */
export function canAfford(capabilities: AiCapabilities | undefined, cost: number): boolean {
  const remaining = capabilities?.credits.remaining;
  return remaining === null || remaining === undefined ? true : cost <= remaining;
}

/** Formats credits with the locale's decimal separator (0,5 in pt-BR). */
export function formatCredits(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** The quiz's language mapped to the two generation languages. */
export function aiLanguageFor(quizLanguage: string | null | undefined): AiLanguage {
  return String(quizLanguage || "").toLowerCase().startsWith("en") ? "en" : "pt-BR";
}

export const AI_ITEM_TYPES: readonly AiItemType[] = ["single_choice", "multi_choice", "true_false", "type_answer"];

export function isAiItemType(type: string): type is AiItemType {
  return (AI_ITEM_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

/** A draft with an `error` issue (or flagged `blocked`) is only added with an explicit force. */
export function isDraftBlocked(draft: Pick<AiDraftItem, "blocked" | "issues">): boolean {
  return draft.blocked || draft.issues.some((issue) => issue.severity === "error");
}

/** Indexes pre-selected when the drafts arrive: every valid draft not applied yet. */
export function selectValidDrafts(drafts: AiDraftItem[], capacity = Infinity): number[] {
  return drafts
    .filter((draft) => !draft.applied && !isDraftBlocked(draft))
    .slice(0, Math.max(0, capacity))
    .map((draft) => draft.index);
}

export interface DraftSelection {
  /** Chosen draft indexes. */
  selected: ReadonlySet<number>;
  /** Blocked drafts the user explicitly accepted ("Adicionar mesmo assim"). */
  forced: ReadonlySet<number>;
}

export const EMPTY_SELECTION: DraftSelection = { selected: new Set(), forced: new Set() };

export function initialSelection(drafts: AiDraftItem[], capacity = Infinity): DraftSelection {
  return { selected: new Set(selectValidDrafts(drafts, capacity)), forced: new Set() };
}

/**
 * Toggles one draft. Applied drafts never change. A blocked draft can only be selected with
 * `force: true` (and deselecting it drops the force). `capacity` caps the selection.
 */
export function toggleDraft(
  selection: DraftSelection,
  draft: AiDraftItem,
  options: { force?: boolean; capacity?: number } = {}
): DraftSelection {
  if (draft.applied) return selection;
  const selected = new Set(selection.selected);
  const forced = new Set(selection.forced);
  if (selected.has(draft.index)) {
    selected.delete(draft.index);
    forced.delete(draft.index);
    return { selected, forced };
  }
  if (isDraftBlocked(draft) && !options.force) return selection;
  if (selected.size >= (options.capacity ?? Infinity)) return selection;
  selected.add(draft.index);
  if (isDraftBlocked(draft)) forced.add(draft.index);
  return { selected, forced };
}

/**
 * Body for POST /jobs/{id}/apply. Blocked drafts are excluded unless forced; `force` is sent
 * only when a forced draft is part of the request. Applied drafts are always excluded.
 */
export function buildApplyRequest(drafts: AiDraftItem[], selection: DraftSelection): { indexes: number[]; force: boolean } {
  const indexes: number[] = [];
  let force = false;
  for (const draft of drafts) {
    if (draft.applied || !selection.selected.has(draft.index)) continue;
    if (isDraftBlocked(draft)) {
      if (!selection.forced.has(draft.index)) continue;
      force = true;
    }
    indexes.push(draft.index);
  }
  return { indexes, force };
}

export function correctKeys(draft: Pick<AiDraftItem, "options">): string[] {
  return draft.options.filter((option) => option.correct).map((option) => option.key);
}

/** The critic's flags that require confirming the answer key when reviewing. */
export function needsKeyConfirmation(critic: AiDraftItem["critic"]): boolean {
  return Boolean(critic?.flags.some((flag) => flag === "key_mismatch" || flag === "ambiguous"));
}

// ---------------------------------------------------------------------------
// Improvement diff
// ---------------------------------------------------------------------------

export type ProposalField = "prompt" | "options" | "explanation";

export type ProposalChange =
  | { field: "prompt" | "explanation"; before: string; after: string }
  | {
      field: "options";
      before: Array<{ key: string; text: string; correct: boolean }>;
      after: Array<{ key: string; text: string; correct: boolean }>;
    };

/** Before/after pairs for the fields listed in `proposal.changed` (unknown fields are ignored). */
export function proposalChanges(item: Pick<LiveItem, "prompt" | "options" | "explanation">, proposal: AiProposal): ProposalChange[] {
  const changes: ProposalChange[] = [];
  const changed = new Set(proposal.changed);
  if (changed.has("prompt") && proposal.prompt !== undefined) {
    changes.push({ field: "prompt", before: item.prompt, after: proposal.prompt });
  }
  if (changed.has("options") && proposal.options) {
    changes.push({
      field: "options",
      before: item.options.map(({ key, text, correct }) => ({ key, text, correct })),
      after: proposal.options.map(({ key, text, correct }) => ({ key, text, correct }))
    });
  }
  if (changed.has("explanation") && proposal.explanation !== undefined) {
    changes.push({ field: "explanation", before: item.explanation ?? "", after: proposal.explanation });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Forms (dialog state → request bodies)
// ---------------------------------------------------------------------------

export const SOURCE_MIN_CHARS = 200;
export const AUDIENCE_MAX_CHARS = 200;
export const TITLE_HINT_MAX_CHARS = 120;
export const INSTRUCTIONS_MAX_CHARS = 300;
export const MAX_DOMAINS = 10;
export const BANK_SAMPLE_MAX = 50;

export type AiFormError =
  | "topicOrCertification"
  | "topicTooLong"
  | "audienceTooLong"
  | "domainsMax"
  | "sourceTooShort"
  | "sourceTooLong"
  | "titleTooLong"
  | "types"
  | "count";

export interface AiCommonForm {
  level: AiGenerateLevel;
  n: number;
  types: AiItemType[];
  language: AiLanguage;
}
type AiGenerateLevel = AiGenerateIn["level"];

export interface AiTopicForm extends AiCommonForm {
  topic: string;
  certification: string;
  domains: string[];
  audience: string;
}

export interface AiSourceForm extends AiCommonForm {
  text: string;
  titleHint: string;
}

export interface AiLimits {
  maxItems: number;
  topicMaxChars: number;
  sourceMaxChars: number;
}

export function aiLimitsFrom(capabilities: AiCapabilities | undefined): AiLimits {
  return {
    maxItems: capabilities?.limits.max_items ?? 20,
    topicMaxChars: capabilities?.limits.topic_max_chars ?? 500,
    sourceMaxChars: capabilities?.limits.source_max_chars ?? 20000
  };
}

function length(value: string): number {
  return Array.from(value).length;
}

function commonErrors(form: AiCommonForm, maxCount: number): AiFormError[] {
  const errors: AiFormError[] = [];
  if (!form.types.length) errors.push("types");
  if (!Number.isInteger(form.n) || form.n < 1 || form.n > maxCount) errors.push("count");
  return errors;
}

/** `maxCount` = min(limits.maxItems, room left in the quiz). */
export function topicFormErrors(form: AiTopicForm, limits: AiLimits, maxCount: number): AiFormError[] {
  const errors: AiFormError[] = [];
  if (!form.topic.trim() && !form.certification) errors.push("topicOrCertification");
  if (length(form.topic) > limits.topicMaxChars) errors.push("topicTooLong");
  if (length(form.audience) > AUDIENCE_MAX_CHARS) errors.push("audienceTooLong");
  if (form.domains.length > MAX_DOMAINS) errors.push("domainsMax");
  return [...errors, ...commonErrors(form, maxCount)];
}

export function sourceFormErrors(form: AiSourceForm, limits: AiLimits, maxCount: number): AiFormError[] {
  const errors: AiFormError[] = [];
  const size = length(form.text.trim());
  if (size < SOURCE_MIN_CHARS) errors.push("sourceTooShort");
  if (size > limits.sourceMaxChars) errors.push("sourceTooLong");
  if (length(form.titleHint) > TITLE_HINT_MAX_CHARS) errors.push("titleTooLong");
  return [...errors, ...commonErrors(form, maxCount)];
}

export function toGenerateIn(quizId: string, form: AiTopicForm): AiGenerateIn {
  const body: AiGenerateIn = { quiz_id: quizId, level: form.level, n: form.n, types: form.types, language: form.language };
  const topic = form.topic.trim();
  const audience = form.audience.trim();
  if (topic) body.topic = topic;
  if (form.certification) body.certification = form.certification;
  if (form.certification && form.domains.length) body.domains = form.domains.slice(0, MAX_DOMAINS);
  if (audience) body.audience_note = audience;
  return body;
}

export function toFromSourceIn(quizId: string, form: AiSourceForm): AiFromSourceIn {
  const body: AiFromSourceIn = {
    quiz_id: quizId,
    source_text: form.text.trim(),
    n: form.n,
    types: form.types,
    level: form.level,
    language: form.language
  };
  const titleHint = form.titleHint.trim();
  if (titleHint) body.title_hint = titleHint;
  return body;
}
