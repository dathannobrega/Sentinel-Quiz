/**
 * Timer math derived from the server deadline (never from setInterval): anyone who joins late sees
 * the bar at the right place (PLANO §9.1 "Sincronia primeiro").
 */
import type { LiveTimer } from "@/features/quiz-live/lib/protocol";

export type CountdownStage = "idle" | "reading" | "open" | "untimed" | "expired";

export interface CountdownValue {
  stage: CountdownStage;
  /** ms until answers open (reading phase), else 0. */
  readingMs: number;
  /** ms left to answer (open), else 0. */
  remainingMs: number;
  /** Whole seconds shown to people (ceil), for the current stage. */
  seconds: number;
  /** Total answer window in ms (null when untimed). */
  totalMs: number | null;
  /** 1 → 0 as the answer window runs out (1 during reading, 0 when expired). */
  fraction: number;
  /** Last 5 s of the answer window. */
  warning: boolean;
}

export const COUNTDOWN_WARNING_MS = 5_000;

export const IDLE_COUNTDOWN: CountdownValue = {
  stage: "idle",
  readingMs: 0,
  remainingMs: 0,
  seconds: 0,
  totalMs: null,
  fraction: 0,
  warning: false
};

export function computeCountdown(timer: LiveTimer | null | undefined, serverNow: number): CountdownValue {
  if (!timer) {
    return IDLE_COUNTDOWN;
  }
  const openAt = timer.answers_open_at_ms;
  const deadline = timer.deadline_ms;
  const totalMs = deadline === null ? null : Math.max(0, deadline - openAt);

  if (serverNow < openAt) {
    const readingMs = openAt - serverNow;
    return { stage: "reading", readingMs, remainingMs: 0, seconds: Math.ceil(readingMs / 1000), totalMs, fraction: 1, warning: false };
  }
  if (deadline === null) {
    return { stage: "untimed", readingMs: 0, remainingMs: 0, seconds: 0, totalMs: null, fraction: 1, warning: false };
  }
  const remainingMs = Math.max(0, deadline - serverNow);
  if (remainingMs === 0) {
    return { stage: "expired", readingMs: 0, remainingMs: 0, seconds: 0, totalMs, fraction: 0, warning: false };
  }
  const fraction = totalMs && totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
  return {
    stage: "open",
    readingMs: 0,
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    totalMs,
    fraction,
    warning: remainingMs <= COUNTDOWN_WARNING_MS
  };
}

/** Elapsed ms since answers opened (client hint `client_elapsed_ms`; the server measures its own). */
export function elapsedSinceOpen(timer: LiveTimer | null | undefined, serverNow: number): number | undefined {
  if (!timer) {
    return undefined;
  }
  return Math.max(0, Math.round(serverNow - timer.answers_open_at_ms));
}
