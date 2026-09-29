import type { AdminQuestion, AdminQuestionInput, CitationItem } from "@/types/api";

import type {
  AdminFlagFilter,
  AdminIngestResult,
  CitationDraft,
  ExamDraft,
  OptionDraft,
  QuestionDraft,
  Translate
} from "@/features/admin/types";

export const QUESTION_FORMAT_OPTIONS = [
  { value: "", labelKey: "admin.form.formatAuto" },
  { value: "single_choice", labelKey: "admin.form.formatSingleChoice" },
  { value: "multiple_response", labelKey: "admin.form.formatMultipleResponse" },
  { value: "best_answer", labelKey: "admin.form.formatBestAnswer" },
  { value: "matching", labelKey: "admin.form.formatMatching" },
  { value: "ordering", labelKey: "admin.form.formatOrdering" }
] as const;

export const DIFFICULTY_OPTIONS = [
  { value: "Easy", labelKey: "admin.form.difficultyEasy" },
  { value: "Medium", labelKey: "admin.form.difficultyMedium" },
  { value: "Hard", labelKey: "admin.form.difficultyHard" }
] as const;

let rowSequence = 0;

function createRowId(prefix: string): string {
  rowSequence += 1;
  return `${prefix}-${rowSequence}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createOptionDraft(key = "", text = "", isCorrect = false): OptionDraft {
  return { rowId: createRowId("opt"), key, text, isCorrect };
}

export function createCitationDraft(citation: CitationItem = {}): CitationDraft {
  return {
    rowId: createRowId("cite"),
    source: String(citation.source || ""),
    reference: String(citation.reference || ""),
    original: { ...citation }
  };
}

export function createEmptyQuestionDraft(preferredExamId = ""): QuestionDraft {
  return {
    lookupId: "",
    id: "",
    examId: preferredExamId,
    prompt: "",
    multiSelect: false,
    domain: "",
    difficulty: "",
    certification: "",
    subject: "",
    subtopic: "",
    subdomain: "",
    objectiveCode: "",
    blueprintCode: "",
    keywords: [],
    trapPatterns: [],
    questionFormat: "",
    tagsText: "",
    justification: "",
    correctRationale: "",
    incorrectRationales: [],
    avgTimeSeconds: "",
    globalAccuracyPercent: "",
    changeSummary: "",
    options: [createOptionDraft("A"), createOptionDraft("B"), createOptionDraft("C"), createOptionDraft("D")],
    citations: [createCitationDraft()]
  };
}

export function createEmptyExamDraft(): ExamDraft {
  return { id: "", title: "", source: "", questionCount: "" };
}

export function summarizePrompt(value: string): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= 150) {
    return normalized;
  }
  return `${normalized.slice(0, 147)}...`;
}

export function nextOptionKey(options: OptionDraft[]): string {
  const used = new Set(options.map((item) => item.key.trim().toUpperCase()).filter(Boolean));
  for (let index = 0; index < 26; index += 1) {
    const key = String.fromCharCode(65 + index);
    if (!used.has(key)) {
      return key;
    }
  }
  return "";
}

export function normalizeTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const lowered = item.toLowerCase();
      if (seen.has(lowered)) {
        return;
      }
      seen.add(lowered);
      tags.push(item);
    });
  return tags;
}

export function joinTextList(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || !values.length) {
    return "";
  }
  return values.join(", ");
}

export function splitTextareaLines(text: string): string[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Returns the i18n key describing a quality field status. */
export function qualityStatusKey(value: string | undefined): string | null {
  if (!value) {
    return "admin.quality.noData";
  }
  if (value === "ok" || value === "provided") {
    return "admin.quality.ok";
  }
  if (value === "unverified") {
    return "admin.quality.unverified";
  }
  if (value === "missing") {
    return "admin.quality.pending";
  }
  if (value === "placeholder") {
    return "admin.quality.placeholder";
  }
  return null;
}

export function qualityTone(value: string | undefined): "default" | "good" | "warning" {
  if (value === "ok" || value === "provided") {
    return "good";
  }
  if (value === "unverified" || value === "placeholder") {
    return "warning";
  }
  return "default";
}

/** Browser flag filter -> GET /admin/questions boolean param (undefined = no filter). */
export function flagFilterValue(value: AdminFlagFilter): boolean | undefined {
  if (value === "yes") {
    return true;
  }
  if (value === "no") {
    return false;
  }
  return undefined;
}

/** i18n key for Question.deactivated_reason. */
export function deactivatedReasonKey(reason: string | null | undefined): string {
  if (reason === "removed_from_source") {
    return "admin.lifecycle.reasonRemovedFromSource";
  }
  if (reason === "deleted") {
    return "admin.lifecycle.reasonDeleted";
  }
  return "admin.lifecycle.reasonUnknown";
}

/** Lines of the POST /admin/ingest summary (only non-zero lifecycle counters). */
export function ingestSummaryLines(
  response: Partial<AdminIngestResult> | null | undefined,
  t: Translate
): string[] {
  const value = (key: keyof AdminIngestResult) => {
    const raw = response?.[key];
    return typeof raw === "number" ? raw : 0;
  };
  const lines = [
    t("admin.ingest.files", {
      imported: value("imported"),
      skipped: value("skipped"),
      errors: response?.errors?.length ?? 0
    }),
    t("admin.ingest.questions", { count: value("questions_imported") })
  ];
  const counters: Array<[keyof AdminIngestResult, string]> = [
    ["deactivated", "admin.ingest.deactivated"],
    ["reactivated", "admin.ingest.reactivated"],
    ["skipped_deleted", "admin.ingest.skippedDeleted"],
    ["skipped_editorial", "admin.ingest.skippedEditorial"],
    ["study_modules", "admin.ingest.studyModules"],
    ["domain_weights_updated", "admin.ingest.domainWeights"]
  ];
  for (const [key, labelKey] of counters) {
    const count = value(key);
    if (count > 0) {
      lines.push(t(labelKey, { count }));
    }
  }
  return lines;
}

export function hasCitationValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

function buildCitationPayload(rows: CitationDraft[]): CitationItem[] {
  const out: CitationItem[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    const citation: CitationItem = {
      ...row.original,
      source: row.source.trim(),
      reference: row.reference.trim()
    };

    if (!hasCitationValue(citation.source) && !hasCitationValue(citation.reference)) {
      if (!hasCitationValue(citation.material_path) && !hasCitationValue(citation.locator)) {
        const extraKeys = Object.keys(citation).filter((key) => key !== "source" && key !== "reference");
        if (!extraKeys.some((key) => hasCitationValue(citation[key]))) {
          return;
        }
      }
    }

    const key = JSON.stringify(citation);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(citation);
  });

  return out;
}

export function buildQuestionPayload(draft: QuestionDraft): AdminQuestionInput {
  const options = draft.options
    .map((item) => ({
      key: item.key.trim().toUpperCase(),
      text: item.text.trim(),
      is_correct: item.isCorrect
    }))
    .filter((item) => item.key && item.text);

  const correctKeys = options.filter((item) => item.is_correct).map((item) => item.key);
  const multiSelect = draft.multiSelect || correctKeys.length > 1;

  return {
    id: draft.id.trim(),
    exam_id: draft.examId.trim(),
    prompt: draft.prompt.trim(),
    multi_select: multiSelect,
    domain: draft.domain.trim() || null,
    difficulty: draft.difficulty.trim() || null,
    certification: draft.certification.trim() || null,
    subject: draft.subject.trim() || null,
    subtopic: draft.subtopic.trim() || null,
    subdomain: draft.subdomain.trim() || null,
    objective_code: draft.objectiveCode.trim() || null,
    blueprint_code: draft.blueprintCode.trim() || null,
    keywords: draft.keywords.length ? draft.keywords : null,
    trap_patterns: draft.trapPatterns.length ? draft.trapPatterns : null,
    question_format: draft.questionFormat.trim() || null,
    tags: normalizeTags(draft.tagsText),
    citations: buildCitationPayload(draft.citations),
    options,
    correct_keys: correctKeys,
    justification: draft.justification.trim() || null,
    correct_rationale: draft.correctRationale.trim() || null,
    incorrect_rationales: draft.incorrectRationales.length ? draft.incorrectRationales : null,
    avg_time_seconds: draft.avgTimeSeconds.trim() ? Number(draft.avgTimeSeconds) : null,
    global_accuracy_percent: draft.globalAccuracyPercent.trim() ? Number(draft.globalAccuracyPercent) : null,
    change_summary: draft.changeSummary.trim() || null
  };
}

/** Returns the i18n key of the first validation problem, or null when the payload is valid. */
export function validateQuestionPayload(payload: AdminQuestionInput): string | null {
  if (!payload.id) {
    return "admin.validation.idRequired";
  }
  if (!payload.exam_id) {
    return "admin.validation.examRequired";
  }
  if (!payload.prompt) {
    return "admin.validation.promptRequired";
  }
  if (payload.options.length < 2) {
    return "admin.validation.minOptions";
  }
  if (payload.correct_keys.length === 0) {
    return "admin.validation.correctRequired";
  }
  const uniqueKeys = new Set(payload.options.map((item) => item.key));
  if (uniqueKeys.size !== payload.options.length) {
    return "admin.validation.uniqueKeys";
  }
  return null;
}

export function toQuestionDraft(question: AdminQuestion): QuestionDraft {
  return {
    lookupId: question.id,
    id: question.id,
    examId: question.exam_id,
    prompt: question.prompt,
    multiSelect: question.multi_select,
    domain: String(question.domain || ""),
    difficulty: String(question.difficulty || ""),
    certification: String(question.certification || ""),
    subject: String(question.subject || ""),
    subtopic: String(question.subtopic || ""),
    subdomain: String(question.subdomain || ""),
    objectiveCode: String(question.objective_code || ""),
    blueprintCode: String(question.blueprint_code || ""),
    keywords: Array.isArray(question.keywords) ? [...question.keywords] : [],
    trapPatterns: Array.isArray(question.trap_patterns) ? [...question.trap_patterns] : [],
    questionFormat: String(question.question_format || ""),
    tagsText: Array.isArray(question.tags) ? question.tags.join(", ") : "",
    justification: String(question.justification || ""),
    correctRationale: String(question.correct_rationale || ""),
    incorrectRationales: Array.isArray(question.incorrect_rationales) ? [...question.incorrect_rationales] : [],
    avgTimeSeconds:
      typeof question.avg_time_seconds === "number" && Number.isFinite(question.avg_time_seconds)
        ? String(question.avg_time_seconds)
        : "",
    globalAccuracyPercent:
      typeof question.global_accuracy_percent === "number" && Number.isFinite(question.global_accuracy_percent)
        ? String(question.global_accuracy_percent)
        : "",
    changeSummary: String(question.change_summary || ""),
    options: question.options.length
      ? question.options.map((option) => createOptionDraft(option.key, option.text, option.is_correct))
      : [createOptionDraft("A"), createOptionDraft("B")],
    citations: question.citations?.length
      ? question.citations.map((citation) => createCitationDraft(citation))
      : [createCitationDraft()]
  };
}

export function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort((left, right) => right[1] - left[1]);
  if (!entries.length) {
    return "-";
  }
  return entries.map(([label, count]) => `${label}: ${count}`).join(" | ");
}
