"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import { createLiveId } from "@/features/quiz-live/lib/protocol";
import {
  advanceAttempt,
  finishAttempt,
  getCurrentAttempt,
  isRetryableError,
  startAttempt,
  submitChallengeAnswer,
  toChallengeAttemptErrorCode,
  type ChallengeAttemptErrorCode
} from "@/lib/api/live-challenge";
import { answerBody, answerIdFor, challengePlayReducer, INITIAL_PLAY_STATE, withRetry } from "@/features/quiz-challenge/lib/challenge-play";
import { createChallengeClock, syncClock } from "@/features/quiz-challenge/lib/challenge-time";
import type { LiveAttemptState } from "@/types/api";

export interface ChallengePlayOptions {
  slug: string;
  token: string;
  /** The participant token was rejected (expired, replaced, erased): ask for the return code. */
  onTokenLost: () => void;
  /** Test seam: the answer retry delays. */
  retryDelays?: readonly number[];
}

/**
 * Drives one participant's attempts over REST: start/resume, answer (with idempotent retries),
 * leave a content slide, hand in and refresh when a deadline passes. Every response replaces the
 * attempt state and re-aligns the clock on `server_now`.
 */
export function useChallengePlay({ slug, token, onTokenLost, retryDelays }: ChallengePlayOptions) {
  const [state, dispatch] = useReducer(challengePlayReducer, INITIAL_PLAY_STATE);
  const [clock] = useState(() => createChallengeClock());
  const [busy, setBusy] = useState<"start" | "advance" | "finish" | "refresh" | null>(null);
  const [error, setError] = useState<ChallengeAttemptErrorCode | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const lostRef = useRef(onTokenLost);
  useEffect(() => {
    lostRef.current = onTokenLost;
  }, [onTokenLost]);

  const apply = useCallback(
    (next: LiveAttemptState) => {
      syncClock(clock, next.server_now);
      dispatch({ type: "state", state: next });
    },
    [clock]
  );

  const fail = useCallback((caught: unknown) => {
    const code = toChallengeAttemptErrorCode(caught);
    if (code === "token") {
      lostRef.current();
      return code;
    }
    setError(code);
    return code;
  }, []);

  const run = useCallback(
    async (kind: "start" | "advance" | "finish" | "refresh", call: () => Promise<LiveAttemptState>): Promise<LiveAttemptState | null> => {
      setBusy(kind);
      setError(null);
      try {
        const next = await call();
        apply(next);
        return next;
      } catch (caught) {
        fail(caught);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [apply, fail]
  );

  /** Resume: the open attempt or the latest finished one. `attempt_not_found` = never started. */
  const load = useCallback(async (): Promise<LiveAttemptState | null | "none"> => {
    setBusy("refresh");
    setError(null);
    try {
      const next = await getCurrentAttempt(slug, token);
      apply(next);
      return next;
    } catch (caught) {
      const code = toChallengeAttemptErrorCode(caught);
      if (code === "attempt_not_found") {
        return "none";
      }
      fail(caught);
      return null;
    } finally {
      setBusy(null);
    }
  }, [apply, fail, slug, token]);

  const start = useCallback(() => run("start", () => startAttempt(slug, token)), [run, slug, token]);
  const refresh = useCallback(() => run("refresh", () => getCurrentAttempt(slug, token)), [run, slug, token]);

  const advance = useCallback(() => {
    const attempt = stateRef.current.attempt;
    if (!attempt) {
      return Promise.resolve(null);
    }
    return run("advance", () => withRetry(() => advanceAttempt(slug, token, attempt.attempt_id, attempt.index), isRetryableError, { delays: retryDelays }));
  }, [retryDelays, run, slug, token]);

  const finish = useCallback(() => {
    const attempt = stateRef.current.attempt;
    if (!attempt) {
      return Promise.resolve(null);
    }
    return run("finish", () => withRetry(() => finishAttempt(slug, token, attempt.attempt_id), isRetryableError, { delays: retryDelays }));
  }, [retryDelays, run, slug, token]);

  /** Sends (or resends after a failure) the answer to the current item. */
  const submit = useCallback(
    async (answer: LiveAnswerDraft) => {
      const current = stateRef.current;
      const attempt = current.attempt;
      const question = attempt?.item ?? null;
      if (!attempt || !question || current.pending?.status === "sending") {
        return;
      }
      const answerId = answerIdFor(current.pending, attempt.attempt_id, question.qi, createLiveId);
      const body = answerBody(answerId, question.qi, answer);
      dispatch({ type: "answer.send", pending: { attemptId: attempt.attempt_id, qi: question.qi, answerId, answer } });
      setError(null);
      try {
        const result = await withRetry(() => submitChallengeAnswer(slug, token, attempt.attempt_id, body), isRetryableError, { delays: retryDelays });
        syncClock(clock, result.state.server_now);
        dispatch({ type: "answer.result", answerId, result, question });
      } catch (caught) {
        dispatch({ type: "answer.failed", answerId });
        fail(caught);
      }
    },
    [clock, fail, retryDelays, slug, token]
  );

  /** Resends the failed answer with the same id. */
  const retrySubmit = useCallback(() => {
    const pending = stateRef.current.pending;
    if (pending && pending.status === "failed") {
      void submit(pending.answer);
    }
  }, [submit]);

  const dismissFeedback = useCallback(() => dispatch({ type: "feedback.dismiss" }), []);

  /**
   * "Próxima" after a per-item correction: with `next_pending` the next item is revealed (and its
   * clock started) only by GET attempts/current. The correction stays on screen until it arrives.
   */
  const next = useCallback(async () => {
    const attempt = stateRef.current.attempt;
    if (attempt?.status === "in_progress" && (attempt.next_pending || !attempt.item)) {
      const revealed = await run("refresh", () => getCurrentAttempt(slug, token));
      if (!revealed) {
        return;
      }
    }
    dispatch({ type: "feedback.dismiss" });
  }, [run, slug, token]);
  const clearNotice = useCallback(() => dispatch({ type: "notice.clear" }), []);

  return {
    ...state,
    clock,
    busy,
    error,
    clearError: () => setError(null),
    load,
    start,
    refresh,
    advance,
    finish,
    submit,
    retrySubmit,
    dismissFeedback,
    next,
    clearNotice
  };
}

export type ChallengePlay = ReturnType<typeof useChallengePlay>;
