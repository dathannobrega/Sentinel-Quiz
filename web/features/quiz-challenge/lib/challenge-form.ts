/**
 * "Criar desafio" form: defaults, validation and the request body (CONTRATO-INCREMENTO-6 §2).
 * Mirrors the server rules so most mistakes are caught before the round trip; the server stays
 * the source of truth (its `invalid_*` codes are mapped to the same messages).
 */
import type { LiveChallengeCreate, LiveChallengeFeedback, LiveChallengeTimeMode } from "@/types/api";

export const ATTEMPTS_MIN = 1;
export const ATTEMPTS_MAX = 5;
export const TOTAL_MINUTES_MIN = 1;
export const TOTAL_MINUTES_MAX = 240;
export const WINDOW_MAX_DAYS = 90;
/** The server refuses a deadline less than a minute away. */
export const MIN_LEAD_MS = 60_000;
const DAY_MS = 86_400_000;

export const FEEDBACK_POLICIES: readonly LiveChallengeFeedback[] = ["each", "end", "after_close", "never"];
export const TIME_MODES: readonly LiveChallengeTimeMode[] = ["per_item", "total", "none"];
/** Deadline shortcuts, in days after the opening. */
export const DEADLINE_SHORTCUTS = [1, 3, 7] as const;

export interface ChallengeForm {
  opensMode: "now" | "later";
  /** `datetime-local` value (local time, "YYYY-MM-DDTHH:mm"). */
  opensAt: string;
  closesAt: string;
  attempts: number;
  timeMode: LiveChallengeTimeMode;
  totalMinutes: string;
  /** null = not chosen: follows the leaderboard like the server (after_close with it, end without). */
  feedback: LiveChallengeFeedback | null;
  leaderboard: boolean;
  shuffleItems: boolean;
  requireLogin: boolean;
}

/** RF-813: with a leaderboard the key stays hidden until the deadline by default. */
export function defaultFeedback(leaderboard: boolean): LiveChallengeFeedback {
  return leaderboard ? "after_close" : "end";
}

export function effectiveFeedback(form: Pick<ChallengeForm, "feedback" | "leaderboard">): LiveChallengeFeedback {
  return form.feedback ?? defaultFeedback(form.leaderboard);
}

/** Local `datetime-local` value for a Date (minutes precision). */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parses a `datetime-local` value as local time; null when empty or invalid. */
export function parseLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function initialChallengeForm(now: number = Date.now()): ChallengeForm {
  return {
    opensMode: "now",
    opensAt: toLocalInputValue(new Date(now + 60 * 60_000)),
    closesAt: toLocalInputValue(new Date(now + 7 * DAY_MS)),
    attempts: 1,
    timeMode: "per_item",
    totalMinutes: "20",
    feedback: null,
    leaderboard: false,
    shuffleItems: true,
    requireLogin: false
  };
}

/** A deadline shortcut: `days` after the opening (or after now when it opens right away). */
export function shortcutDeadline(form: Pick<ChallengeForm, "opensMode" | "opensAt">, days: number, now: number = Date.now()): string {
  const base = form.opensMode === "later" ? (parseLocalInput(form.opensAt) ?? now) : now;
  return toLocalInputValue(new Date(base + days * DAY_MS));
}

export type ChallengeFormErrors = Partial<Record<"opensAt" | "closesAt" | "totalMinutes" | "attempts", ChallengeFormError>>;
export type ChallengeFormError =
  | "opensRequired"
  | "opensPast"
  | "closesRequired"
  | "closesPast"
  | "closesBeforeOpens"
  | "windowTooLong"
  | "totalRange"
  | "attemptsRange";

export function parseTotalMinutes(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= TOTAL_MINUTES_MIN && parsed <= TOTAL_MINUTES_MAX ? parsed : null;
}

export function validateChallengeForm(form: ChallengeForm, now: number = Date.now()): ChallengeFormErrors {
  const errors: ChallengeFormErrors = {};
  let opens = now;
  if (form.opensMode === "later") {
    const parsed = parseLocalInput(form.opensAt);
    if (parsed === null) {
      errors.opensAt = "opensRequired";
    } else if (parsed < now - MIN_LEAD_MS) {
      errors.opensAt = "opensPast";
    } else {
      opens = parsed;
    }
  }
  const closes = parseLocalInput(form.closesAt);
  if (closes === null) {
    errors.closesAt = "closesRequired";
  } else if (closes <= now + MIN_LEAD_MS) {
    errors.closesAt = "closesPast";
  } else if (closes <= opens) {
    errors.closesAt = "closesBeforeOpens";
  } else if (closes - opens > WINDOW_MAX_DAYS * DAY_MS) {
    errors.closesAt = "windowTooLong";
  }
  if (form.timeMode === "total" && parseTotalMinutes(form.totalMinutes) === null) {
    errors.totalMinutes = "totalRange";
  }
  if (!Number.isInteger(form.attempts) || form.attempts < ATTEMPTS_MIN || form.attempts > ATTEMPTS_MAX) {
    errors.attempts = "attemptsRange";
  }
  return errors;
}

export function hasErrors(errors: ChallengeFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Request body for POST /api/live/challenges (call after validateChallengeForm passed). */
export function buildChallengePayload(quizId: string, form: ChallengeForm): LiveChallengeCreate {
  const opens = form.opensMode === "later" ? parseLocalInput(form.opensAt) : null;
  const closes = parseLocalInput(form.closesAt);
  const total = form.timeMode === "total" ? parseTotalMinutes(form.totalMinutes) : null;
  return {
    quiz_id: quizId,
    opens_at: opens === null ? null : new Date(opens).toISOString(),
    closes_at: new Date(closes ?? Date.now()).toISOString(),
    attempts: form.attempts,
    time_mode: form.timeMode,
    total_time_s: total === null ? null : total * 60,
    // Untouched: the server applies the same default (after_close with a leaderboard, end without).
    feedback: form.feedback,
    leaderboard: form.leaderboard,
    shuffle_items: form.shuffleItems,
    allow_guests: !form.requireLogin
  };
}
