/**
 * Clock and countdown helpers for self-paced challenges (CONTRATO-INCREMENTO-6 §3 "Cronômetro").
 *
 * There is no WebSocket and no `time.sync` here: every REST answer carries `server_now`, which seeds
 * the same `ClockSync` the live screens use (offset = server time − local monotonic time at
 * arrival). Deadlines (`item_deadline_at`, `deadline_at`, `opens_at`, `closes_at`) are server epoch
 * timestamps, so they become `LiveTimer`s for the shared countdown math and components.
 */
import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import type { LiveTimer } from "@/features/quiz-live/lib/protocol";
import { parseServerTimestamp } from "@/lib/utils/dates";
import type { LiveAttemptState } from "@/types/api";

/** The server keeps 1.5 s of slack on the per-item deadline; ask for the new state just after it. */
export const ITEM_GRACE_MS = 1_500;
export const EXPIRY_REFRESH_DELAY_MS = ITEM_GRACE_MS + 250;

/** Aligns the clock on a response's `server_now` (rough: latency is ignored, as with `sts`). */
export function syncClock(clock: ClockSync, serverNow: string | null | undefined, receivedAt: number = clock.localNow()): void {
  const value = parseServerTimestamp(serverNow);
  if (value !== null) {
    clock.seedFromServerTime(value, receivedAt);
  }
}

export function createChallengeClock(serverNow?: string | null, now?: () => number): ClockSync {
  const clock = new ClockSync(now ? { now } : {});
  syncClock(clock, serverNow);
  return clock;
}

/** Per-item timer: from `item_started_at` to `item_deadline_at` (null when the item is untimed). */
export function itemTimer(
  state: Pick<LiveAttemptState, "item_started_at" | "item_deadline_at" | "status" | "next_pending"> | null
): LiveTimer | null {
  // A pending item (policy "each", before "Próxima") has no clock yet.
  if (!state || state.status !== "in_progress" || state.next_pending) {
    return null;
  }
  const deadline = parseServerTimestamp(state.item_deadline_at);
  if (deadline === null) {
    return null;
  }
  const started = parseServerTimestamp(state.item_started_at ?? null) ?? deadline;
  return { answers_open_at_ms: Math.min(started, deadline), deadline_ms: deadline };
}

/** Whole-attempt timer (time mode "total"): from `started_at` to `deadline_at`. */
export function totalTimer(state: Pick<LiveAttemptState, "started_at" | "deadline_at" | "status"> | null): LiveTimer | null {
  if (!state || state.status !== "in_progress") {
    return null;
  }
  const deadline = parseServerTimestamp(state.deadline_at);
  if (deadline === null) {
    return null;
  }
  const started = parseServerTimestamp(state.started_at) ?? deadline;
  return { answers_open_at_ms: Math.min(started, deadline), deadline_ms: deadline };
}

/** ms from `serverNowMs` until `target` (never negative; null without a target). */
export function remainingMs(target: string | null | undefined, serverNowMs: number): number | null {
  const value = parseServerTimestamp(target);
  if (value === null) {
    return null;
  }
  return Math.max(0, value - serverNowMs);
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Splits a duration (rounded up to the second, so "0" only shows when time is really up). */
export function splitDuration(ms: number): DurationParts {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60
  };
}

/** "4:07" / "1:02:09": a ticking clock for countdowns under a day. */
export function formatClock(ms: number): string {
  const { days, hours, minutes, seconds } = splitDuration(ms);
  const allHours = days * 24 + hours;
  const pad = (value: number) => String(value).padStart(2, "0");
  return allHours > 0 ? `${allHours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Compact duration for summaries: "5 min 12 s", "1 h 4 min", "2 d 3 h" (units are plain symbols). */
export function formatDurationShort(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return "–";
  }
  const { days, hours, minutes, seconds } = splitDuration(ms);
  if (days > 0) {
    return hours ? `${days} d ${hours} h` : `${days} d`;
  }
  if (hours > 0) {
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  if (minutes > 0) {
    return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
  }
  return `${seconds} s`;
}
