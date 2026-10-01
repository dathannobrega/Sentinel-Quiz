"use client";

/**
 * The waiting phone (CONTRATO-INCREMENTO-7.md §3): polls `GET /queue/{id}` with the wait token
 * until the person is admitted, rejected or the ticket ends.
 *
 * Pace rules
 * - The next poll happens only after the server's `retry_after_ms` (3–15 s), plus up to 20%
 *   jitter so a queue of 2,000 phones does not poll in lockstep.
 * - Only while the tab is visible: a hidden tab skips its turn, and coming back polls at once.
 *   (A tab hidden for more than 45 s loses its turn when seats are handed out: that is the
 *   server's rule, so seats go to people who are still there.)
 * - Network errors and 429 back off exponentially (capped under the 45 s stale window).
 * - `invalid_wait_token` ends the wait (the ticket was replaced or never existed).
 *
 * The ticket lives in `sessionStorage` (this tab only) and is refreshed on every "waiting"
 * answer, so a reload resumes the wait; it is dropped once the wait ends either way.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearWaitingTicket,
  getQueueStatus,
  leaveQueue,
  saveWaitingTicket,
  toQueueErrorCode,
  updateTicket,
  type WaitingTicket
} from "@/features/quiz-live/lib/live-fetch";
import type { LiveJoinResult, LiveQueueEnd } from "@/types/api/live";

/** Server pace bounds (backend `POLL_MIN_MS`/`POLL_MAX_MS`); anything outside is clamped. */
export const POLL_MIN_MS = 3_000;
export const POLL_MAX_MS = 15_000;
/** Up to +20% on top of the server's pace. */
export const POLL_JITTER = 0.2;
/** Backoff ceiling after network errors: stays under the server's 45 s stale window. */
export const POLL_BACKOFF_MAX_MS = 30_000;

/**
 * Delay before the next poll: the server's `retry_after_ms` (clamped to 3–15 s), doubled per
 * consecutive failure up to 30 s, then stretched by `random` × 20% (never shorter than asked).
 */
export function nextPollDelay(retryAfterMs: number, failures = 0, random: () => number = Math.random): number {
  const asked = Number.isFinite(retryAfterMs) ? retryAfterMs : POLL_MIN_MS;
  const base = Math.min(POLL_MAX_MS, Math.max(POLL_MIN_MS, asked));
  const backedOff = failures > 0 ? Math.min(POLL_BACKOFF_MAX_MS, base * 2 ** Math.min(failures, 4)) : base;
  const jitter = Math.min(1, Math.max(0, random())) * POLL_JITTER;
  return Math.round(backedOff * (1 + jitter));
}

/** How the wait ended: the server's answer, or a ticket the server no longer recognizes. */
export type WaitingEnd = LiveQueueEnd | "invalid";

export interface WaitingRoomState {
  ticket: WaitingTicket;
  /** Null while waiting. */
  end: WaitingEnd | null;
  /** Consecutive failed polls (the screen shows "reconnecting" from the first one). */
  failures: number;
  leaving: boolean;
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/**
 * Polls the waiting room for `ticket` (keyed by `code` in sessionStorage). `immediate`: poll right
 * away (a resumed ticket after a reload); otherwise the first poll waits the 202's pace.
 * `onAdmitted` receives the join result exactly like a normal join.
 */
export function useWaitingRoom({
  code,
  ticket: initialTicket,
  immediate = false,
  onAdmitted,
  random = Math.random
}: {
  code: string;
  ticket: WaitingTicket;
  immediate?: boolean;
  onAdmitted: (join: LiveJoinResult) => void;
  random?: () => number;
}): WaitingRoomState & { leave: () => Promise<void> } {
  const [state, setState] = useState<WaitingRoomState>({ ticket: initialTicket, end: null, failures: 0, leaving: false });
  const ticketRef = useRef(initialTicket);
  const failuresRef = useRef(0);
  const doneRef = useRef(false);
  const inFlightRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAdmittedRef = useRef(onAdmitted);
  const randomRef = useRef(random);
  // `poll` and `schedule` call each other: the latest `poll` is reached through this ref.
  const pollRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    onAdmittedRef.current = onAdmitted;
    randomRef.current = random;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const finish = useCallback(
    (end: WaitingEnd) => {
      doneRef.current = true;
      clearTimer();
      clearWaitingTicket(code);
      setState((current) => ({ ...current, end, leaving: false }));
    },
    [clearTimer, code]
  );

  const schedule = useCallback(() => {
    clearTimer();
    if (doneRef.current) {
      return;
    }
    const delay = nextPollDelay(ticketRef.current.retryAfterMs, failuresRef.current, randomRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // A hidden tab skips its turn; `visibilitychange` polls as soon as it is back.
      if (isVisible()) {
        pollRef.current();
      }
    }, delay);
  }, [clearTimer]);

  const poll = useCallback(async () => {
    if (doneRef.current || inFlightRef.current) {
      return;
    }
    clearTimer();
    const controller = new AbortController();
    inFlightRef.current = controller;
    const ticket = ticketRef.current;
    try {
      const status = await getQueueStatus(ticket.requestId, ticket.waitToken, controller.signal);
      if (controller.signal.aborted || doneRef.current) {
        return;
      }
      failuresRef.current = 0;
      if (status.status === "waiting") {
        const next = updateTicket(ticket, status);
        ticketRef.current = next;
        saveWaitingTicket(code, next);
        setState((current) => ({ ...current, ticket: next, failures: 0 }));
      } else if (status.status === "admitted") {
        doneRef.current = true;
        clearWaitingTicket(code);
        onAdmittedRef.current(status.join);
        return;
      } else {
        finish(status.status);
        return;
      }
    } catch (error) {
      if (controller.signal.aborted || doneRef.current) {
        return;
      }
      if (toQueueErrorCode(error) === "invalid_wait_token") {
        finish("invalid");
        return;
      }
      failuresRef.current += 1;
      const failures = failuresRef.current;
      setState((current) => ({ ...current, failures }));
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
    }
    schedule();
  }, [clearTimer, code, finish, schedule]);

  useEffect(() => {
    pollRef.current = () => void poll();
  }, [poll]);

  useEffect(() => {
    doneRef.current = false;
    if (immediate && isVisible()) {
      void poll();
    } else {
      schedule();
    }
    const onVisibility = () => {
      if (isVisible() && !doneRef.current) {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
      inFlightRef.current?.abort();
      inFlightRef.current = null;
    };
    // One polling loop per ticket; `immediate` only matters for its first poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicket.requestId]);

  const leave = useCallback(async () => {
    if (doneRef.current) {
      return;
    }
    doneRef.current = true;
    clearTimer();
    inFlightRef.current?.abort();
    inFlightRef.current = null;
    setState((current) => ({ ...current, leaving: true }));
    const ticket = ticketRef.current;
    try {
      await leaveQueue(ticket.requestId, ticket.waitToken);
    } catch {
      // Best effort: offline, the server drops the place once this phone stops polling.
    }
    // The caller goes back to the join form; no "withdrawn" card in between.
    clearWaitingTicket(code);
  }, [clearTimer, code]);

  return { ...state, leave };
}
