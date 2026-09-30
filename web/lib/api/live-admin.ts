/**
 * Sentinel Arena administration (`/api/admin/live`, docs/live-quiz/CONTRATO-INCREMENTO-4.md §5).
 *
 * Moderators (`reviewer`) read the overview, the queue and the terms and resolve cases; forced end,
 * blocking, term changes and the audit log need `admin` (403 `admin_required` / http_403).
 * 401/403 are never retried with the bearer fallback (same rule as the other admin calls).
 */
import { ApiError, apiClient } from "@/lib/api/client";
import type {
  LiveAdminOverview,
  LiveAuditEvent,
  LiveCaseAction,
  LiveCaseResolveResult,
  LiveCasesPage,
  LiveCaseStatusFilter,
  LiveModerationTerm,
  LiveModerationTermInput
} from "@/types/api";

export const LIVE_ADMIN_BASE = "/admin/live";

const ADMIN_REQUEST = { retryOnUnauthorized: false } as const;
const enc = encodeURIComponent;

type Signal = { signal?: AbortSignal };

/** Actions that change a room or a quiz: the backend requires a note of at least 5 characters. */
export const CASE_ACTIONS_REQUIRING_NOTE: ReadonlySet<LiveCaseAction> = new Set(["remove_item", "end_session", "block_quiz"]);
/** Actions only an `admin` may take (a reviewer gets 403 `admin_required`). */
export const CASE_ACTIONS_ADMIN_ONLY: ReadonlySet<LiveCaseAction> = new Set(["end_session", "block_quiz"]);
export const REASON_MIN_LENGTH = 5;
export const REASON_MAX_LENGTH = 500;

/** Whether a (trimmed) note satisfies the backend rule for `action`. */
export function isCaseNoteValid(action: LiveCaseAction, note: string): boolean {
  if (!CASE_ACTIONS_REQUIRING_NOTE.has(action)) {
    return note.trim().length <= REASON_MAX_LENGTH;
  }
  const length = note.trim().length;
  return length >= REASON_MIN_LENGTH && length <= REASON_MAX_LENGTH;
}

/** Case actions a role may take on a case (reviewer: everything but end/block). */
export function caseActionsFor(
  caseItem: { status: string; session_id: string | null; position: number | null; quiz_id: string | null; quiz_version_id: string | null },
  canAdmin: boolean
): LiveCaseAction[] {
  if (caseItem.status !== "open") {
    return [];
  }
  const actions: LiveCaseAction[] = ["dismiss"];
  if (caseItem.quiz_version_id) {
    actions.push("approve");
  }
  if (caseItem.quiz_version_id && caseItem.position !== null) {
    actions.push("remove_item");
  }
  if (canAdmin && caseItem.session_id) {
    actions.push("end_session");
  }
  if (canAdmin && caseItem.quiz_id) {
    actions.push("block_quiz");
  }
  return actions;
}

export type LiveAdminErrorCode =
  | "forbidden"
  | "unauthorized"
  | "reason_required"
  | "case_closed"
  | "session_not_active"
  | "term_exists"
  | "invalid_term"
  | "not_found"
  | "offline"
  | "generic";

/** Maps admin errors to copy keys (`admin.arena.errors.*`). */
export function toLiveAdminErrorCode(error: unknown): LiveAdminErrorCode {
  if (!(error instanceof ApiError)) {
    return "generic";
  }
  switch (error.code) {
    case "reason_required":
    case "case_closed":
    case "session_not_active":
    case "term_exists":
    case "invalid_term":
      return error.code;
    case "admin_required":
      return "forbidden";
    case "case_not_found":
    case "session_not_found":
    case "quiz_not_found":
      return "not_found";
    default:
      break;
  }
  if (error.status === 403) {
    return "forbidden";
  }
  if (error.status === 401) {
    return "unauthorized";
  }
  if (error.status === 404) {
    return "not_found";
  }
  if (error.status === 422 && error.fieldErrors.some((field) => field.field.includes("reason") || field.field.includes("note"))) {
    return "reason_required";
  }
  if (error.status === 0) {
    return "offline";
  }
  return "generic";
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 401);
}

// ---------------------------------------------------------------------------
// Overview + sessions
// ---------------------------------------------------------------------------

export function getLiveAdminOverview(options: Signal = {}) {
  return apiClient.get<LiveAdminOverview>(`${LIVE_ADMIN_BASE}/overview`, { ...ADMIN_REQUEST, ...options });
}

/** RF-1103 (admin): end any session, audited with the reason (≥ 5 chars). 409 session_not_active. */
export function forceEndLiveSession(sessionId: string, reason: string) {
  return apiClient.post<{ ended: true }>(`${LIVE_ADMIN_BASE}/sessions/${enc(sessionId)}/end`, { reason: reason.trim() }, ADMIN_REQUEST);
}

// ---------------------------------------------------------------------------
// Moderation queue
// ---------------------------------------------------------------------------

export interface LiveCasesParams {
  status: LiveCaseStatusFilter;
  limit?: number;
  offset?: number;
}

export function buildCasesQuery(params: LiveCasesParams): string {
  const query = new URLSearchParams({ status: params.status });
  query.set("limit", String(params.limit ?? 50));
  query.set("offset", String(params.offset ?? 0));
  return query.toString();
}

export async function listLiveCases(params: LiveCasesParams, options: Signal = {}): Promise<LiveCasesPage> {
  const data = await apiClient.get<LiveCasesPage>(`${LIVE_ADMIN_BASE}/cases?${buildCasesQuery(params)}`, { ...ADMIN_REQUEST, ...options });
  return { items: data?.items ?? [], total: data?.total ?? 0 };
}

export function resolveLiveCase(caseId: string, action: LiveCaseAction, note?: string) {
  const trimmed = note?.trim();
  return apiClient.post<LiveCaseResolveResult>(
    `${LIVE_ADMIN_BASE}/cases/${enc(caseId)}/resolve`,
    { action, ...(trimmed ? { note: trimmed } : {}) },
    ADMIN_REQUEST
  );
}

// ---------------------------------------------------------------------------
// Filter terms (write: admin)
// ---------------------------------------------------------------------------

export async function listLiveTerms(options: Signal = {}): Promise<LiveModerationTerm[]> {
  const data = await apiClient.get<{ items: LiveModerationTerm[] }>(`${LIVE_ADMIN_BASE}/terms`, { ...ADMIN_REQUEST, ...options });
  return data?.items ?? [];
}

export function addLiveTerm(input: LiveModerationTermInput) {
  const note = input.note?.trim();
  return apiClient.post<LiveModerationTerm>(
    `${LIVE_ADMIN_BASE}/terms`,
    { term: input.term.trim(), match: input.match, kind: input.kind, scope: input.scope, ...(note ? { note } : {}) },
    ADMIN_REQUEST
  );
}

export async function deleteLiveTerm(termId: string): Promise<void> {
  await apiClient.delete<null>(`${LIVE_ADMIN_BASE}/terms/${enc(termId)}`, ADMIN_REQUEST);
}

// ---------------------------------------------------------------------------
// Audit (admin)
// ---------------------------------------------------------------------------

export async function listLiveAudit(params: { sessionId?: string; limit?: number } = {}, options: Signal = {}): Promise<LiveAuditEvent[]> {
  const query = new URLSearchParams();
  const sessionId = params.sessionId?.trim();
  if (sessionId) {
    query.set("session_id", sessionId);
  }
  query.set("limit", String(params.limit ?? 100));
  const data = await apiClient.get<{ items: LiveAuditEvent[] }>(`${LIVE_ADMIN_BASE}/audit?${query.toString()}`, { ...ADMIN_REQUEST, ...options });
  return data?.items ?? [];
}
