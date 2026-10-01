/**
 * Sentinel Arena self-paced challenges (docs/live-quiz/CONTRATO-INCREMENTO-6.md).
 *
 * Owner calls go through apiClient (cookie, X-Client-Key, typed live errors via toLiveError):
 * create, the progress panel and the window change. Participant calls reuse the live participant
 * fetch (`liveRequest`: no X-Client-Key, Bearer participant token) on the public link `/q/{slug}`.
 *
 * Every attempt call answers with the full `AttemptState`; the client always replaces its copy.
 * Answers carry a client `answer_id` (uuid): resending the same id after a network error is safe
 * (the server answers `duplicate` with the current state).
 */
import { ApiError, apiClient } from "@/lib/api/client";
import { toLiveError } from "@/lib/api/live-authoring";
import { liveRequest } from "@/features/quiz-live/lib/live-fetch";
import type {
  LiveAttemptState,
  LiveChallengeAnswerRequest,
  LiveChallengeAnswerResult,
  LiveChallengeCreate,
  LiveChallengeInfo,
  LiveChallengeLeaderboard,
  LiveChallengeProgress,
  LiveChallengeUpdate,
  LiveJoinRequest,
  LiveJoinResult,
  LiveSession
} from "@/types/api";

const enc = encodeURIComponent;

async function mapErrors<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw toLiveError(error);
  }
}

// ----------------------------------------------------------------------------- slug

/** Crockford Base32 without I, L, O, U (the server alphabet). */
export const CHALLENGE_SLUG_LENGTH = 8;

/**
 * Normalizes what people type or paste (a full `/q/…` link too) the way the server does:
 * uppercase, alphanumerics only, O → 0 and I/L → 1. Used as the storage key of the participation.
 */
export function normalizeChallengeSlug(input: string): string {
  const raw = String(input || "");
  const fromUrl = raw.match(/\/q\/([A-Za-z0-9-]+)/);
  const source = fromUrl ? fromUrl[1] : raw;
  return source
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .slice(0, 16);
}

export function isValidChallengeSlug(slug: string): boolean {
  return slug.length === CHALLENGE_SLUG_LENGTH;
}

// ----------------------------------------------------------------------------- owner

const challengePath = (sessionId: string) => `/live/sessions/${enc(sessionId)}/challenge`;

/** POST /api/live/challenges → the session (`mode: "self_paced"`, `challenge`). Same gates as a live room. */
export function createChallenge(payload: LiveChallengeCreate) {
  return mapErrors(apiClient.post<LiveSession>("/live/challenges", payload));
}

/** Owner panel (RF-809): funnel, attempts, recent finishes and the top 10. */
export function getChallengeProgress(sessionId: string, options: { signal?: AbortSignal } = {}) {
  return mapErrors(apiClient.get<LiveChallengeProgress>(challengePath(sessionId), { signal: options.signal }));
}

/** Moves the deadline or closes now; answers with the panel. 409 `challenge_closed` once closed. */
export function updateChallenge(sessionId: string, body: LiveChallengeUpdate) {
  return mapErrors(apiClient.patch<LiveChallengeProgress>(challengePath(sessionId), body));
}

/** Create/patch errors with dedicated copy in the owner screens (the typed live errors are handled apart). */
export const CHALLENGE_OWNER_ERROR_CODES = [
  "invalid_window",
  "invalid_total_time",
  "invalid_attempts",
  "invalid_feedback",
  "invalid_time_mode",
  "no_interactive",
  "quiz_not_published",
  "challenge_closed",
  "challenge_not_found",
  "slug_exhausted"
] as const;
export type ChallengeOwnerErrorCode = (typeof CHALLENGE_OWNER_ERROR_CODES)[number] | "offline" | "generic";

export function toChallengeOwnerErrorCode(error: unknown): ChallengeOwnerErrorCode {
  if (error instanceof ApiError) {
    if ((CHALLENGE_OWNER_ERROR_CODES as readonly string[]).includes(error.code)) {
      return error.code as ChallengeOwnerErrorCode;
    }
    if (error.status === 0) {
      return "offline";
    }
  }
  return "generic";
}

// ----------------------------------------------------------------------------- participant

const qPath = (slug: string) => `/q/${enc(slug)}`;
const attemptPath = (slug: string, attemptId: string) => `${qPath(slug)}/attempts/${enc(attemptId)}`;

/**
 * Public metadata. Without a token the server counts one "opened" (funnel); pass the stored token
 * on reloads so a returning participant is not counted again.
 */
export function getChallengeInfo(slug: string, options: { token?: string | null; signal?: AbortSignal } = {}): Promise<LiveChallengeInfo> {
  return liveRequest(qPath(slug), { token: options.token ?? undefined, signal: options.signal });
}

/** Same body and answer as the live join. 409 challenge_not_open, 410 challenge_closed, 401 login_required. */
export function joinChallenge(slug: string, body: LiveJoinRequest): Promise<LiveJoinResult> {
  return liveRequest(`${qPath(slug)}/join`, { method: "POST", body });
}

/** Name + return code → a fresh token (also after the close, to see the results). */
export function accessChallenge(slug: string, body: { display_name: string; return_code: string }): Promise<LiveJoinResult> {
  return liveRequest(`${qPath(slug)}/access`, { method: "POST", body, withCredentials: false });
}

/** Starts an attempt or resumes the open one (RF-808). 409 attempts_exhausted / challenge_not_open, 410 challenge_closed. */
export function startAttempt(slug: string, token: string): Promise<LiveAttemptState> {
  return liveRequest(`${qPath(slug)}/attempts`, { method: "POST", token, withCredentials: false });
}

/** The open attempt, else the latest finished one (with `summary`). 404 attempt_not_found before the first. */
export function getCurrentAttempt(slug: string, token: string, signal?: AbortSignal): Promise<LiveAttemptState> {
  return liveRequest(`${qPath(slug)}/attempts/current`, { token, signal, withCredentials: false });
}

export function submitChallengeAnswer(
  slug: string,
  token: string,
  attemptId: string,
  body: LiveChallengeAnswerRequest
): Promise<LiveChallengeAnswerResult> {
  return liveRequest(`${attemptPath(slug, attemptId)}/answers`, { method: "POST", token, body, withCredentials: false });
}

/** Leaves the content slide at `index` (idempotent). */
export function advanceAttempt(slug: string, token: string, attemptId: string, index: number): Promise<LiveAttemptState> {
  return liveRequest(`${attemptPath(slug, attemptId)}/advance`, { method: "POST", token, body: { index }, withCredentials: false });
}

/** Hands in early: the remaining items stay unanswered. */
export function finishAttempt(slug: string, token: string, attemptId: string): Promise<LiveAttemptState> {
  return liveRequest(`${attemptPath(slug, attemptId)}/finish`, { method: "POST", token, withCredentials: false });
}

/** Top 10 + me. 404 leaderboard_disabled when the challenge has no leaderboard. */
export function getChallengeLeaderboard(slug: string, token: string, signal?: AbortSignal): Promise<LiveChallengeLeaderboard> {
  return liveRequest(`${qPath(slug)}/leaderboard`, { token, signal, withCredentials: false });
}

/**
 * Whether a failed call may be resent as is: network loss, timeout, rate limit or a server error.
 * Answers are idempotent by `answer_id`, so the same id is resent.
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/** Join errors on the challenge link (CONTRATO-INCREMENTO-6 §3). */
export const CHALLENGE_JOIN_ERROR_CODES = [
  "challenge_not_found",
  "challenge_not_open",
  "challenge_closed",
  "login_required",
  "name_taken",
  "name_rejected",
  "consent_required",
  "room_full"
] as const;
export type ChallengeJoinErrorCode = (typeof CHALLENGE_JOIN_ERROR_CODES)[number] | "rate_limited" | "offline" | "generic";

export function toChallengeJoinErrorCode(error: unknown): ChallengeJoinErrorCode {
  if (error instanceof ApiError) {
    if ((CHALLENGE_JOIN_ERROR_CODES as readonly string[]).includes(error.code)) {
      return error.code as ChallengeJoinErrorCode;
    }
    if (error.status === 404) {
      return "challenge_not_found";
    }
    if (error.status === 410) {
      return "challenge_closed";
    }
    if (error.status === 429) {
      return "rate_limited";
    }
    if (error.status === 0) {
      return "offline";
    }
  }
  return "generic";
}

/** Attempt errors (start, current, finish...). `token`: the participant token was rejected. */
export type ChallengeAttemptErrorCode =
  | "attempts_exhausted"
  | "challenge_not_open"
  | "challenge_closed"
  | "attempt_not_found"
  | "challenge_empty"
  | "banned"
  | "token"
  | "offline"
  | "generic";

export function toChallengeAttemptErrorCode(error: unknown): ChallengeAttemptErrorCode {
  if (error instanceof ApiError) {
    if (["attempts_exhausted", "challenge_not_open", "challenge_closed", "attempt_not_found", "challenge_empty", "banned"].includes(error.code)) {
      return error.code as ChallengeAttemptErrorCode;
    }
    if (error.status === 401 || error.code.startsWith("token_")) {
      return "token";
    }
    if (error.status === 410) {
      return "challenge_closed";
    }
    if (error.status === 0 || error.status === 408) {
      return "offline";
    }
  }
  return "generic";
}
