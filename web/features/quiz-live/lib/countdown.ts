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
  /** The host paused the question: every value above is frozen at the pause instant. */
  paused: boolean;
}

export const COUNTDOWN_WARNING_MS = 5_000;

export const IDLE_COUNTDOWN: CountdownValue = {
  stage: "idle",
  readingMs: 0,
  remainingMs: 0,
  seconds: 0,
  totalMs: null,
  fraction: 0,
  warning: false,
  paused: false
};

/** Instant the countdown is evaluated at: "now", or the pause instant while paused (frozen). */
export function effectiveNow(timer: LiveTimer, serverNow: number): number {
  if (timer.paused && typeof timer.paused_at_ms === "number") {
    return Math.min(serverNow, timer.paused_at_ms);
  }
  return serverNow;
}

export function computeCountdown(timer: LiveTimer | null | undefined, serverNow: number): CountdownValue {
  if (!timer) {
    return IDLE_COUNTDOWN;
  }
  const openAt = timer.answers_open_at_ms;
  const deadline = timer.deadline_ms;
  const totalMs = deadline === null ? null : Math.max(0, deadline - openAt);
  const paused = Boolean(timer.paused);
  const now = effectiveNow(timer, serverNow);

  if (now < openAt) {
    const readingMs = openAt - now;
    return { stage: "reading", readingMs, remainingMs: 0, seconds: Math.ceil(readingMs / 1000), totalMs, fraction: 1, warning: false, paused };
  }
  if (deadline === null) {
    return { stage: "untimed", readingMs: 0, remainingMs: 0, seconds: 0, totalMs: null, fraction: 1, warning: false, paused };
  }
  const remainingMs = Math.max(0, deadline - now);
  if (remainingMs === 0) {
    return { stage: "expired", readingMs: 0, remainingMs: 0, seconds: 0, totalMs, fraction: 0, warning: false, paused };
  }
  const fraction = totalMs && totalMs > 0 ? Math.min(1, remainingMs / totalMs) : 0;
  return {
    stage: "open",
    readingMs: 0,
    remainingMs,
    seconds: Math.ceil(remainingMs / 1000),
    totalMs,
    fraction,
    // A frozen timer never pulses: the warning would read as "hurry" while nobody can answer.
    warning: !paused && remainingMs <= COUNTDOWN_WARNING_MS,
    paused
  };
}

/**
 * A participant's own timer (RF-622, CONTRATO-INCREMENTO-3 §4):
 * `deadline = answers_open_at + (deadline − answers_open_at) × max(multiplier, 1)`; `multiplier = 0`
 * removes the deadline (untimed). The pause fields are kept, so a paused personal timer freezes too.
 */
export function personalTimer(timer: LiveTimer | null | undefined, multiplier: number | null | undefined): LiveTimer | null {
  if (!timer) {
    return null;
  }
  const factor = typeof multiplier === "number" && Number.isFinite(multiplier) ? multiplier : 1;
  if (factor === 1 || timer.deadline_ms === null) {
    return timer;
  }
  if (factor === 0) {
    return { ...timer, deadline_ms: null, remaining_ms: undefined };
  }
  const openAt = timer.answers_open_at_ms;
  const deadline = openAt + (timer.deadline_ms - openAt) * Math.max(factor, 1);
  const remaining =
    timer.paused && typeof timer.paused_at_ms === "number" ? Math.max(0, deadline - Math.max(timer.paused_at_ms, openAt)) : timer.remaining_ms;
  return { ...timer, deadline_ms: Math.round(deadline), remaining_ms: remaining === undefined ? undefined : Math.round(remaining) };
}

/** Elapsed ms since answers opened (client hint `client_elapsed_ms`; the server measures its own). */
export function elapsedSinceOpen(timer: LiveTimer | null | undefined, serverNow: number): number | undefined {
  if (!timer) {
    return undefined;
  }
  return Math.max(0, Math.round(serverNow - timer.answers_open_at_ms));
}
