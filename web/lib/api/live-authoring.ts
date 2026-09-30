/**
 * Sentinel Arena authoring/bank/session/report REST calls (host side).
 * Source of truth: docs/live-quiz/CONTRATO-INCREMENTO-1.md §4 and §7. Base path: /api/live.
 *
 * Every call goes through apiClient (cookie credentials, X-Client-Key, timeouts, normalized
 * ApiError). Three contract errors are re-thrown as typed subclasses so screens can react to them
 * without parsing bodies: 409 version_conflict, 422 quiz_invalid (details.issues),
 * 422 license_requires_login (details.items) and 422 confirm_key_required (Incremento 2). 409 quiz_not_published is exposed via a guard.
 */
import { ApiError, apiClient, buildApiUrl, type DownloadedFile } from "@/lib/api/client";
import type {
  LiveBankFacets,
  LiveBankSearchResult,
  LiveCapabilities,
  LiveDisplayToken,
  LiveFromBankResult,
  LiveIssue,
  LiveItemWrite,
  LivePublishResult,
  LiveQuizCreate,
  LiveQuizDetail,
  LiveQuizSummary,
  LiveQuizUpdate,
  LiveReport,
  LiveSession,
  LiveSessionCreate
} from "@/types/api";

export const LIVE_API_BASE = "/live";

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** One item that blocks a room (422 license_requires_login → details.items). `position` is 0-based. */
export interface LiveLicenseBlockedItem {
  item_id: string | null;
  position: number | null;
  prompt: string | null;
  license_scope: string | null;
  reason: string | null;
}

/** Copies an ApiError's payload so typed subclasses keep status, code, details and request id. */
export function baseFrom(source: ApiError) {
  return {
    code: source.code,
    message: source.message,
    details: source.details,
    status: source.status,
    fieldErrors: source.fieldErrors,
    retryAfterSeconds: source.retryAfterSeconds,
    requestId: source.requestId
  };
}

/** 409 version_conflict: someone (another tab) saved first. Refetch before retrying. */
export class LiveVersionConflictError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "LiveVersionConflictError";
  }
}

/** 422 quiz_invalid on publish: `issues` point at items/fields. */
export class LiveQuizInvalidError extends ApiError {
  issues: LiveIssue[];
  constructor(source: ApiError, issues: LiveIssue[]) {
    super(baseFrom(source));
    this.name = "LiveQuizInvalidError";
    this.issues = issues;
  }
}

/**
 * 422 license_requires_login (POST /sessions with guests: `items` cannot be shown to guests) or
 * 422 license_blocked (no guests, but the items are still not usable live). Check `code`.
 */
export class LiveLicenseRequiresLoginError extends ApiError {
  items: LiveLicenseBlockedItem[];
  constructor(source: ApiError, items: LiveLicenseBlockedItem[]) {
    super(baseFrom(source));
    this.name = "LiveLicenseRequiresLoginError";
    this.items = items;
  }
}

/** 422 confirm_key_required: the item's answer key must be explicitly confirmed (Incremento 2). */
export class LiveConfirmKeyRequiredError extends ApiError {
  constructor(source: ApiError) {
    super(baseFrom(source));
    this.name = "LiveConfirmKeyRequiredError";
  }
}

export function isConfirmKeyRequired(error: unknown): error is LiveConfirmKeyRequiredError {
  return error instanceof LiveConfirmKeyRequiredError;
}

export function isVersionConflict(error: unknown): error is LiveVersionConflictError {
  return error instanceof LiveVersionConflictError;
}

export function isQuizInvalid(error: unknown): error is LiveQuizInvalidError {
  return error instanceof LiveQuizInvalidError;
}

export function isLicenseRequiresLogin(error: unknown): error is LiveLicenseRequiresLoginError {
  return error instanceof LiveLicenseRequiresLoginError;
}

export function isQuizNotPublished(error: unknown): boolean {
  return error instanceof ApiError && error.code === "quiz_not_published";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `details` from the raw error body (`{detail, message, code, details, request_id}`). */
export function readErrorDetails(error: ApiError): Record<string, unknown> | null {
  if (!error.details) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(error.details);
    if (!isRecord(parsed)) {
      return null;
    }
    if (isRecord(parsed.details)) {
      return parsed.details;
    }
    // Some FastAPI handlers nest the payload under `detail`.
    if (isRecord(parsed.detail) && isRecord(parsed.detail.details)) {
      return parsed.detail.details;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseIssues(value: unknown): LiveIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((issue) => ({
    item_id: asString(issue.item_id),
    position: asNumber(issue.position),
    field: asString(issue.field) ?? "",
    code: asString(issue.code) ?? "invalid",
    message: asString(issue.message) ?? ""
  }));
}

export function parseLicenseItems(value: unknown): LiveLicenseBlockedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    if (typeof entry === "string") {
      // Tolerate a bare list of item ids.
      return { item_id: entry, position: null, prompt: null, license_scope: null, reason: null };
    }
    const item = isRecord(entry) ? entry : {};
    return {
      item_id: asString(item.item_id) ?? asString(item.id),
      position: asNumber(item.position),
      prompt: asString(item.prompt),
      license_scope: asString(item.license_scope),
      reason: asString(item.reason) ?? asString(item.message)
    };
  });
}

/** Maps a raw ApiError to the typed live errors; anything else passes through untouched. */
export function toLiveError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error instanceof LiveVersionConflictError) {
    return error;
  }
  if (
    error instanceof LiveQuizInvalidError ||
    error instanceof LiveLicenseRequiresLoginError ||
    error instanceof LiveConfirmKeyRequiredError
  ) {
    return error;
  }
  if (error.status === 422 && error.code === "confirm_key_required") {
    return new LiveConfirmKeyRequiredError(error);
  }
  if (error.status === 409 && error.code === "version_conflict") {
    return new LiveVersionConflictError(error);
  }
  if (error.status === 422 && error.code === "quiz_invalid") {
    return new LiveQuizInvalidError(error, parseIssues(readErrorDetails(error)?.issues));
  }
  // `license_blocked` (guests off, items still not usable live) carries the same `details.items`.
  if (error.status === 422 && (error.code === "license_requires_login" || error.code === "license_blocked")) {
    return new LiveLicenseRequiresLoginError(error, parseLicenseItems(readErrorDetails(error)?.items));
  }
  return error;
}

async function mapErrors<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw toLiveError(error);
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const enc = encodeURIComponent;
const quizPath = (quizId: string) => `${LIVE_API_BASE}/quizzes/${enc(quizId)}`;
const itemPath = (quizId: string, itemId: string) => `${quizPath(quizId)}/items/${enc(itemId)}`;
const sessionPath = (sessionId: string) => `${LIVE_API_BASE}/sessions/${enc(sessionId)}`;

type Signal = { signal?: AbortSignal };

// ---------------------------------------------------------------------------
// Capabilities + quizzes
// ---------------------------------------------------------------------------

export function getLiveCapabilities(options: Signal = {}) {
  return mapErrors(apiClient.get<LiveCapabilities>(`${LIVE_API_BASE}/capabilities`, { signal: options.signal }));
}

export async function listLiveQuizzes(options: Signal = {}): Promise<LiveQuizSummary[]> {
  const data = await mapErrors(apiClient.get<{ items: LiveQuizSummary[] }>(`${LIVE_API_BASE}/quizzes`, options));
  return data?.items ?? [];
}

export function createLiveQuiz(payload: LiveQuizCreate) {
  return mapErrors(apiClient.post<LiveQuizDetail>(`${LIVE_API_BASE}/quizzes`, payload));
}

export function getLiveQuiz(quizId: string, options: Signal = {}) {
  return mapErrors(apiClient.get<LiveQuizDetail>(quizPath(quizId), options));
}

export function updateLiveQuiz(quizId: string, payload: LiveQuizUpdate) {
  return mapErrors(apiClient.patch<LiveQuizDetail>(quizPath(quizId), payload));
}

/** DELETE archives (soft delete); 204. */
export async function archiveLiveQuiz(quizId: string): Promise<void> {
  await mapErrors(apiClient.delete<null>(quizPath(quizId)));
}

export function duplicateLiveQuiz(quizId: string) {
  return mapErrors(apiClient.post<LiveQuizDetail>(`${quizPath(quizId)}/duplicate`));
}

// ---------------------------------------------------------------------------
// Items (every mutation returns the full QuizDetail)
// ---------------------------------------------------------------------------

export function createLiveItem(
  quizId: string,
  expectedVersion: number,
  item: LiveItemWrite & { item_type: LiveItemWrite["item_type"] },
  position?: number
) {
  const body: Record<string, unknown> = { ...item, expected_version: expectedVersion };
  if (position !== undefined) {
    body.position = position;
  }
  return mapErrors(apiClient.post<LiveQuizDetail>(`${quizPath(quizId)}/items`, body));
}

export function updateLiveItem(quizId: string, itemId: string, expectedVersion: number, patch: LiveItemWrite) {
  return mapErrors(
    apiClient.patch<LiveQuizDetail>(itemPath(quizId, itemId), { ...patch, expected_version: expectedVersion })
  );
}

export function deleteLiveItem(quizId: string, itemId: string, expectedVersion: number) {
  return mapErrors(
    apiClient.delete<LiveQuizDetail>(`${itemPath(quizId, itemId)}?expected_version=${enc(String(expectedVersion))}`)
  );
}

export function reorderLiveItems(quizId: string, expectedVersion: number, itemIds: string[]) {
  return mapErrors(
    apiClient.post<LiveQuizDetail>(`${quizPath(quizId)}/items/reorder`, {
      expected_version: expectedVersion,
      item_ids: itemIds
    })
  );
}

export function addLiveItemsFromBank(quizId: string, expectedVersion: number, questionIds: string[]) {
  return mapErrors(
    apiClient.post<LiveFromBankResult>(`${quizPath(quizId)}/items/from-bank`, {
      expected_version: expectedVersion,
      question_ids: questionIds
    })
  );
}

/**
 * Marks an item as reviewed. AI items flagged by the critic (`ai.requires_key_confirmation`) need
 * `confirmKey: true` (the host ticked "I checked the answer key"); without it the backend answers
 * 422 confirm_key_required (LiveConfirmKeyRequiredError).
 */
export function reviewLiveItem(quizId: string, itemId: string, expectedVersion: number, options: { confirmKey?: boolean } = {}) {
  const body: Record<string, unknown> = { expected_version: expectedVersion };
  if (options.confirmKey) {
    body.confirm_key = true;
  }
  return mapErrors(apiClient.post<LiveQuizDetail>(`${itemPath(quizId, itemId)}/review`, body));
}

export function publishLiveQuiz(quizId: string, expectedVersion: number) {
  return mapErrors(
    apiClient.post<LivePublishResult>(`${quizPath(quizId)}/publish`, { expected_version: expectedVersion })
  );
}

// ---------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------

export interface LiveBankSearchParams {
  q?: string;
  certification?: string;
  domain?: string;
  difficulty?: string;
  onlyGuestEligible?: boolean;
  limit?: number;
  offset?: number;
}

export function buildBankSearchQuery(params: LiveBankSearchParams): string {
  const query = new URLSearchParams();
  const q = params.q?.trim();
  if (q) query.set("q", q);
  if (params.certification) query.set("certification", params.certification);
  if (params.domain) query.set("domain", params.domain);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.onlyGuestEligible) query.set("only_guest_eligible", "true");
  query.set("limit", String(params.limit ?? 20));
  query.set("offset", String(params.offset ?? 0));
  return query.toString();
}

export function getBankFacets(options: Signal = {}) {
  return mapErrors(apiClient.get<LiveBankFacets>(`${LIVE_API_BASE}/bank/facets`, options));
}

export function searchBank(params: LiveBankSearchParams, options: Signal = {}) {
  return mapErrors(
    apiClient.get<LiveBankSearchResult>(`${LIVE_API_BASE}/bank/search?${buildBankSearchQuery(params)}`, options)
  );
}

// ---------------------------------------------------------------------------
// Sessions + report
// ---------------------------------------------------------------------------

export function createLiveSession(payload: LiveSessionCreate) {
  return mapErrors(apiClient.post<LiveSession>(`${LIVE_API_BASE}/sessions`, payload));
}

export async function listLiveSessions(quizId: string, options: Signal = {}): Promise<LiveSession[]> {
  const data = await mapErrors(
    apiClient.get<{ items: LiveSession[] }>(`${LIVE_API_BASE}/sessions?quiz_id=${enc(quizId)}`, options)
  );
  return data?.items ?? [];
}

export function getLiveSession(sessionId: string, options: Signal = {}) {
  return mapErrors(apiClient.get<LiveSession>(sessionPath(sessionId), options));
}

export function endLiveSession(sessionId: string) {
  return mapErrors(apiClient.post<LiveSession>(`${sessionPath(sessionId)}/end`));
}

export function createDisplayToken(sessionId: string) {
  return mapErrors(apiClient.post<LiveDisplayToken>(`${sessionPath(sessionId)}/display-token`));
}

export function getLiveReport(sessionId: string, options: Signal = {}) {
  return mapErrors(apiClient.get<LiveReport>(`${sessionPath(sessionId)}/report`, options));
}

/** Absolute URL of the CSV export (for links); prefer downloadSessionCsv (sends auth headers). */
export function sessionExportCsvUrl(sessionId: string): string {
  return buildApiUrl(`/api${sessionPath(sessionId)}/export.csv`);
}

/** Absolute URL of the printable QR code (image/svg+xml). */
export function sessionQrSvgUrl(sessionId: string): string {
  return buildApiUrl(`/api${sessionPath(sessionId)}/qr.svg`);
}

export function downloadSessionCsv(sessionId: string): Promise<DownloadedFile> {
  return mapErrors(apiClient.download(`${sessionPath(sessionId)}/export.csv`, { timeoutMs: 60_000 }));
}
