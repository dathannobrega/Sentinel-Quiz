/**
 * Sentinel Arena AI authoring REST calls (Incremento 2). Source of truth:
 * docs/live-quiz/CONTRATO-INCREMENTO-2.md §3. Base path: /api/ai (+ POST /api/live/bank/sample).
 *
 * Every call goes through apiClient and re-throws the contract errors as typed subclasses of
 * ApiError, so screens react to them without parsing bodies:
 * - 429 ai_quota_exceeded (details.remaining) → AiQuotaExceededError
 * - 429 ai_too_many_jobs → AiTooManyJobsError
 * - 422 ai_draft_blocked → AiDraftBlockedError
 * - 409 ai_already_applied → AiAlreadyAppliedError
 * - 409 ai_job_not_ready → AiJobNotReadyError
 * - 404 ai_disabled → AiDisabledError; 404 ai_job_not_found → AiJobNotFoundError
 * - 409 version_conflict → LiveVersionConflictError (same class as Incremento 1, so the editor's
 *   serialized mutator refetches the quiz exactly as it does for autosave)
 * - 422 confirm_key_required → LiveConfirmKeyRequiredError (item review, see live-authoring)
 */
import { ApiError, apiClient } from "@/lib/api/client";
import { LIVE_API_BASE, baseFrom, readErrorDetails, toLiveError } from "@/lib/api/live-authoring";
import type {
  AiApplyIn,
  AiCapabilities,
  AiFromSourceIn,
  AiGenerateIn,
  AiImproveIn,
  AiJob,
  AiJobStatus,
  AiSuggestFormatIn,
  AiSuggestFormatOut,
  LiveBankSampleIn,
  LiveBankSampleOut,
  LiveQuizDetail
} from "@/types/api";

export {
  LiveConfirmKeyRequiredError,
  LiveVersionConflictError,
  isConfirmKeyRequired,
  isVersionConflict
} from "@/lib/api/live-authoring";

export const AI_API_BASE = "/ai";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** 429 ai_quota_exceeded: the daily credit quota does not cover the job. */
export class AiQuotaExceededError extends ApiError {
  /** Credits still available today (`details.remaining`); null when the backend did not say. */
  remaining: number | null;
  constructor(source: ApiError, remaining: number | null) {
    super(baseFrom(source));
    this.name = "AiQuotaExceededError";
    this.remaining = remaining;
  }
}

/** 429 ai_too_many_jobs: the user already has the maximum number of jobs running. */
export class AiTooManyJobsError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiTooManyJobsError";
  }
}

/** 422 ai_draft_blocked: a chosen draft has an `error` issue and `force` was not sent. */
export class AiDraftBlockedError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiDraftBlockedError";
  }
}

/** 409 ai_already_applied: the draft (or proposal) was already added to the quiz. */
export class AiAlreadyAppliedError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiAlreadyAppliedError";
  }
}

/** 409 ai_job_not_ready: apply called before the job finished. */
export class AiJobNotReadyError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiJobNotReadyError";
  }
}

/** 404 ai_disabled: AI_AUTHORING_ENABLED is off in this environment. */
export class AiDisabledError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiDisabledError";
  }
}

/** 404 ai_job_not_found: unknown job or not owned by the user. */
export class AiJobNotFoundError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "AiJobNotFoundError";
  }
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const AI_ERRORS = [
  AiQuotaExceededError,
  AiTooManyJobsError,
  AiDraftBlockedError,
  AiAlreadyAppliedError,
  AiJobNotReadyError,
  AiDisabledError,
  AiJobNotFoundError
];

/** Maps a raw ApiError to the typed AI (and live) errors; anything else passes through untouched. */
export function toAiError(error: unknown): unknown {
  if (!(error instanceof ApiError)) {
    return error;
  }
  if (AI_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    return error;
  }
  const { status, code } = error;
  if (status === 429 && code === "ai_quota_exceeded") {
    return new AiQuotaExceededError(error, asNumber(readErrorDetails(error)?.remaining));
  }
  if (status === 429 && code === "ai_too_many_jobs") {
    return new AiTooManyJobsError(error);
  }
  if (status === 422 && code === "ai_draft_blocked") {
    return new AiDraftBlockedError(error);
  }
  if (status === 409 && code === "ai_already_applied") {
    return new AiAlreadyAppliedError(error);
  }
  if (status === 409 && code === "ai_job_not_ready") {
    return new AiJobNotReadyError(error);
  }
  if (status === 404 && code === "ai_disabled") {
    return new AiDisabledError(error);
  }
  if (status === 404 && code === "ai_job_not_found") {
    return new AiJobNotFoundError(error);
  }
  return toLiveError(error);
}

export const isAiQuotaExceeded = (error: unknown): error is AiQuotaExceededError => error instanceof AiQuotaExceededError;
export const isAiTooManyJobs = (error: unknown): error is AiTooManyJobsError => error instanceof AiTooManyJobsError;
export const isAiDraftBlocked = (error: unknown): error is AiDraftBlockedError => error instanceof AiDraftBlockedError;
export const isAiAlreadyApplied = (error: unknown): error is AiAlreadyAppliedError => error instanceof AiAlreadyAppliedError;
export const isAiJobNotReady = (error: unknown): error is AiJobNotReadyError => error instanceof AiJobNotReadyError;
export const isAiDisabled = (error: unknown): error is AiDisabledError => error instanceof AiDisabledError;
export const isAiJobNotFound = (error: unknown): error is AiJobNotFoundError => error instanceof AiJobNotFoundError;

async function mapErrors<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw toAiError(error);
  }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;
type Signal = { signal?: AbortSignal };

export function getAiCapabilities(options: Signal = {}) {
  return mapErrors(apiClient.get<AiCapabilities>(`${AI_API_BASE}/capabilities`, options));
}

/** F-IA1: generate drafts from a topic and/or certification blueprint (202 AiJob). */
export function createGenerateJob(payload: AiGenerateIn) {
  return mapErrors(apiClient.post<AiJob>(`${AI_API_BASE}/quiz-drafts/generate`, payload));
}

/** F-IA3: generate drafts from pasted text, 200–20 000 characters (202 AiJob). */
export function createFromSourceJob(payload: AiFromSourceIn) {
  return mapErrors(apiClient.post<AiJob>(`${AI_API_BASE}/quiz-drafts/from-source`, payload));
}

/** F-IA4: rewrite / new distractors / explanation for one item (202 AiJob). */
export function createImproveJob(itemId: string, payload: AiImproveIn) {
  return mapErrors(apiClient.post<AiJob>(`${AI_API_BASE}/items/${enc(itemId)}/improve`, payload));
}

export function getAiJob(jobId: string, options: Signal = {}) {
  return mapErrors(apiClient.get<AiJob>(`${AI_API_BASE}/jobs/${enc(jobId)}`, options));
}

/** Recent jobs of the current user for a quiz (without `result`). */
export async function listAiJobs(quizId: string, options: Signal & { limit?: number } = {}): Promise<AiJob[]> {
  const query = new URLSearchParams({ quiz_id: quizId, limit: String(options.limit ?? 20) });
  const data = await mapErrors(apiClient.get<{ items: AiJob[] }>(`${AI_API_BASE}/jobs?${query.toString()}`, { signal: options.signal }));
  return data?.items ?? [];
}

/**
 * Adds the chosen drafts (`indexes` into result.items) to the quiz, or applies an improvement
 * proposal (`indexes: [0]`). Returns the full QuizDetail. Call it through the editor's
 * QuizMutator so `expected_version` never races autosave.
 */
export function applyAiJob(jobId: string, payload: AiApplyIn) {
  return mapErrors(apiClient.post<LiveQuizDetail>(`${AI_API_BASE}/jobs/${enc(jobId)}/apply`, payload));
}

/** F-IA5: deterministic time-limit suggestion (no credits). */
export function suggestItemFormat(payload: AiSuggestFormatIn) {
  return mapErrors(apiClient.post<AiSuggestFormatOut>(`${AI_API_BASE}/items/suggest-format`, payload));
}

/** F-IA2: deterministic draw from the question bank (no AI, no credits). */
export function sampleBank(payload: LiveBankSampleIn) {
  return mapErrors(apiClient.post<LiveBankSampleOut>(`${LIVE_API_BASE}/bank/sample`, payload));
}

// ---------------------------------------------------------------------------
// Job helpers (shared by the hooks and the screens)
// ---------------------------------------------------------------------------

export const AI_POLL_INTERVAL_MS = 1500;

export function isJobActive(status: AiJobStatus | null | undefined): boolean {
  return status === "queued" || status === "running";
}

/** react-query `refetchInterval`: poll every 1.5 s while the job is queued/running, stop otherwise. */
export function jobRefetchInterval(job: Pick<AiJob, "status"> | undefined): number | false {
  // No data yet (first fetch still pending): keep the same pace.
  if (!job) return AI_POLL_INTERVAL_MS;
  return isJobActive(job.status) ? AI_POLL_INTERVAL_MS : false;
}

/** Marks drafts as applied in a job result (cache update after a successful apply). */
export function markDraftsApplied(job: AiJob, indexes: number[]): AiJob {
  if (job.result?.type !== "drafts") return job;
  const set = new Set(indexes);
  return {
    ...job,
    result: { ...job.result, items: job.result.items.map((draft) => (set.has(draft.index) ? { ...draft, applied: true } : draft)) }
  };
}
