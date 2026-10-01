/**
 * Participant attempt state machine for self-paced challenges (CONTRATO-INCREMENTO-6 §3).
 *
 * The server owns the attempt: every call answers with the full `AttemptState` and the client
 * simply replaces its copy (never merges). What lives here is only what the server does not keep:
 * - the answer in flight, with its `answer_id`, so a network failure resends the SAME id
 *   (idempotent: the server answers `duplicate` instead of recording twice);
 * - the per-item correction to show before moving on (policy "each");
 * - a short notice for non-accepted statuses (`late` → "Tempo esgotado").
 */
import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import type { PublicQuestion } from "@/features/quiz-live/lib/protocol";
import type { LiveAttemptState, LiveChallengeAnswerResult, LiveChallengeAnswerStatus, LiveChallengeItemFeedback } from "@/types/api";

export interface PendingAnswer {
  attemptId: string;
  qi: number;
  answerId: string;
  answer: LiveAnswerDraft;
  /** `failed`: the network gave up; the person can resend (same `answerId`). */
  status: "sending" | "failed";
}

export interface ShownFeedback {
  feedback: LiveChallengeItemFeedback;
  /** The question as it was on screen (the state already points at the next item). */
  question: PublicQuestion;
  answer: LiveAnswerDraft;
}

export type PlayNotice = "late" | "invalid" | "closed" | "stale";

export interface ChallengePlayState {
  attempt: LiveAttemptState | null;
  pending: PendingAnswer | null;
  feedback: ShownFeedback | null;
  notice: { kind: PlayNotice; id: number } | null;
}

export type ChallengePlayAction =
  | { type: "state"; state: LiveAttemptState }
  | { type: "answer.send"; pending: Omit<PendingAnswer, "status"> }
  | { type: "answer.result"; answerId: string; result: LiveChallengeAnswerResult; question: PublicQuestion | null }
  | { type: "answer.failed"; answerId: string }
  | { type: "feedback.dismiss" }
  | { type: "notice.clear" };

export const INITIAL_PLAY_STATE: ChallengePlayState = { attempt: null, pending: null, feedback: null, notice: null };

/** Statuses that deserve a word to the participant; the rest only replace the state silently. */
export function noticeFor(status: LiveChallengeAnswerStatus): PlayNotice | null {
  switch (status) {
    case "late":
      return "late";
    case "invalid":
      return "invalid";
    case "closed":
      return "closed";
    case "stale":
    case "already_answered":
      // Another tab moved on: the fresh state already shows where the attempt is.
      return "stale";
    default:
      return null;
  }
}

export function challengePlayReducer(state: ChallengePlayState, action: ChallengePlayAction): ChallengePlayState {
  switch (action.type) {
    case "state": {
      // A pending answer for an item that is no longer current cannot be resent meaningfully.
      const pending =
        state.pending && action.state.attempt_id === state.pending.attemptId && action.state.item?.qi === state.pending.qi ? state.pending : null;
      return { ...state, attempt: action.state, pending };
    }
    case "answer.send":
      return { ...state, pending: { ...action.pending, status: "sending" }, notice: null };
    case "answer.result": {
      if (state.pending && state.pending.answerId !== action.answerId) {
        return state;
      }
      const { result } = action;
      const kind = noticeFor(result.status);
      const showFeedback = (result.status === "accepted" || result.status === "duplicate") && result.feedback && action.question;
      return {
        attempt: result.state,
        pending: null,
        feedback: showFeedback
          ? { feedback: result.feedback as LiveChallengeItemFeedback, question: action.question as PublicQuestion, answer: state.pending?.answer ?? {} }
          : null,
        notice: kind ? { kind, id: (state.notice?.id ?? 0) + 1 } : null
      };
    }
    case "answer.failed":
      if (!state.pending || state.pending.answerId !== action.answerId) {
        return state;
      }
      return { ...state, pending: { ...state.pending, status: "failed" } };
    case "feedback.dismiss":
      return { ...state, feedback: null };
    case "notice.clear":
      return { ...state, notice: null };
    default:
      return state;
  }
}

/**
 * The `answer_id` for a submission: a failed send of the same item keeps its id (the server
 * deduplicates it); anything else gets a fresh one.
 */
export function answerIdFor(pending: PendingAnswer | null, attemptId: string, qi: number, create: () => string): string {
  if (pending && pending.attemptId === attemptId && pending.qi === qi) {
    return pending.answerId;
  }
  return create();
}

/** Builds the request body from a pad's draft (only the fields the item uses). */
export function answerBody(answerId: string, qi: number, answer: LiveAnswerDraft) {
  return {
    answer_id: answerId,
    qi,
    ...(answer.choice ? { choice: answer.choice } : {}),
    ...(typeof answer.text === "string" ? { text: answer.text } : {}),
    ...(answer.words ? { words: answer.words } : {}),
    ...(typeof answer.number === "number" ? { number: answer.number } : {})
  };
}

export const RETRY_DELAYS_MS = [700, 2_000, 4_000] as const;

/**
 * Calls `send` until it succeeds, waiting `delays[i]` between tries while `shouldRetry(error)`.
 * The caller passes the SAME request each time (idempotent answer id).
 */
export async function withRetry<T>(
  send: () => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
  options: { delays?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= delays.length || !shouldRetry(error)) {
        throw error;
      }
      await sleep(delays[attempt] as number);
      attempt += 1;
    }
  }
}

/** Progress shown to people: "item 3 of 6" (1-based, clamped). */
export function progressOf(state: Pick<LiveAttemptState, "index" | "total" | "status"> | null): { current: number; total: number; fraction: number } {
  if (!state || state.total <= 0) {
    return { current: 0, total: 0, fraction: 0 };
  }
  const done = state.status === "finished" ? state.total : Math.min(state.index, state.total);
  return { current: Math.min(done + 1, state.total), total: state.total, fraction: done / state.total };
}
