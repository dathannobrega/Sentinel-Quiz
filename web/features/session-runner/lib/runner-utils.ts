import { translateBackendMessage } from "@/lib/i18n/backend-messages";
import { formatDateTime } from "@/lib/utils/format";
import type { ExamAnswerFeedback, PedagogicalReferenceItem, StudyAnswerFeedback } from "@/types/api";

export type RunnerMode = "exam" | "study";
export type Translate = (key: string, values?: Record<string, string | number>) => string;
export type AnswerFeedback = ExamAnswerFeedback | StudyAnswerFeedback;

export function resolveResultHref(mode: RunnerMode, sessionId: string): string {
  return mode === "study" ? `/study/${encodeURIComponent(sessionId)}/result` : `/exam/${encodeURIComponent(sessionId)}/result`;
}

export function isStudyFeedback(feedback: AnswerFeedback): feedback is StudyAnswerFeedback {
  return "confidence_level" in feedback;
}

/**
 * Localized feedback message: `message_code` + `message_params` (on the insight, or on the
 * feedback itself) translated via backend.<code>; unknown/missing codes fall back to the
 * backend's pt-BR `message`.
 */
export function resolveFeedbackMessage(feedback: AnswerFeedback, t: Translate): string {
  const insight = feedback.insight;
  const fallbackRaw = typeof insight?.message === "string" && insight.message.trim() ? insight.message : feedback.message;
  const fallback = typeof fallbackRaw === "string" ? fallbackRaw.trim() : "";
  const code = insight?.message_code || feedback.message_code || null;
  const params = insight?.message_code ? insight.message_params : feedback.message_params;
  return translateBackendMessage(t, code, params, fallback).trim();
}

export function buildLiveFeedbackBits(feedback: AnswerFeedback, t: Translate): string[] {
  const bits: string[] = [];
  const insight = feedback.insight;
  const message = resolveFeedbackMessage(feedback, t);
  if (message) {
    bits.push(message);
  }
  if (typeof insight?.remaining_questions === "number") {
    bits.push(t("runner.liveFeedback.remaining", { count: insight.remaining_questions }));
  }
  if (typeof insight?.current_correct_streak === "number") {
    bits.push(t("runner.liveFeedback.currentStreak", { count: insight.current_correct_streak }));
  }
  if (isStudyFeedback(feedback)) {
    if (feedback.uncertain_correct) {
      bits.push(t("runner.liveFeedback.uncertainCorrect"));
    }
    if (feedback.next_review_at) {
      bits.push(t("runner.liveFeedback.nextReview", { date: formatDateTime(feedback.next_review_at) }));
    }
    bits.push(t("runner.liveFeedback.dueQueue", { count: feedback.review_due_count }));
  }
  return bits;
}

export function formatRemainingTime(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--:--";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatPedagogicalReference(reference: PedagogicalReferenceItem): string {
  const parts: string[] = [reference.label];
  if (reference.reference) {
    parts.push(reference.reference);
  }
  if (typeof reference.page_start === "number" && typeof reference.page_end === "number") {
    parts.push(
      reference.page_start === reference.page_end ? `p. ${reference.page_start}` : `pp. ${reference.page_start}-${reference.page_end}`
    );
  } else if (typeof reference.page_start === "number") {
    parts.push(`p. ${reference.page_start}`);
  }
  if (reference.locator) {
    parts.push(reference.locator);
  }
  return parts.join(" · ");
}

export function formatScope(scope: string | null | undefined, t: Translate): string {
  if (scope === "user") {
    return t("runner.labels.scopeUser");
  }
  return t("runner.labels.scopeDevice");
}

/**
 * Backend timestamps are naive UTC ISO strings (datetime.utcnow().isoformat()).
 * Treat strings without an explicit offset as UTC.
 */
export function parseServerTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
  const parsed = Date.parse(hasZone ? value : `${value}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

/** True when a keyboard event originates from a text-entry control. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
