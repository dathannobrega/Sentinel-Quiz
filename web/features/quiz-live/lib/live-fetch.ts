/**
 * REST calls used by the live screens (CONTRATO §4 "Sessões (host)" and §5 "participante").
 *
 * Deliberately NOT `lib/api/client.ts`: the participant client never sends `X-Client-Key`
 * (RNF-508) and authenticates with its own Bearer token. Errors are normalized with the project's
 * `normalizeErrorResponse`, so `error.code` is the backend code (`room_locked`, `name_taken`...).
 *
 * Participant credentials live in `sessionStorage` keyed by room code — never in the URL and never
 * in localStorage (PLANO §13.5). Only the non-secret identity (session id + name) is kept in
 * localStorage, for 30 days, so the return-code flows work after the tab is closed.
 *
 * Incremento 4 adds the participant rights (`/me`: my data, erase, access with the return code,
 * report content) and the host's phone preview and pre-event check.
 */
import { buildApiUrl } from "@/lib/api/client";
import { ApiError, apiMessage, normalizeErrorResponse } from "@/lib/api/errors";
import type {
  LiveContentReport,
  LiveDisplayToken,
  LiveJoinRequest,
  LiveJoinResult,
  LiveMyData,
  LiveMyResults,
  LivePreflight,
  LiveRoomInfo,
  LiveSession
} from "@/types/api/live";

const LIVE_TIMEOUT_MS = 15_000;

interface LiveRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  /** Participant/display Bearer token. */
  token?: string;
  signal?: AbortSignal;
  /** Send the host session cookie (host endpoints and the "logged-in join"). */
  withCredentials?: boolean;
}

async function liveRequest<T>(path: string, options: LiveRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, LIVE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const headers = new Headers({ Accept: "application/json" });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(buildApiUrl(`/live${path}`), {
      method: options.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
      credentials: options.withCredentials === false ? "omit" : "include",
      cache: "no-store"
    });
  } catch (error) {
    if (options.signal?.aborted && !timedOut) {
      throw error;
    }
    if (timedOut) {
      throw new ApiError({ code: "timeout", message: apiMessage("timeout"), status: 408 });
    }
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    throw new ApiError({
      code: offline ? "offline" : "network_error",
      message: offline ? apiMessage("offline") : apiMessage("network"),
      status: 0
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch {
      text = "";
    }
    throw normalizeErrorResponse({
      status: response.status,
      body: text,
      contentType: response.headers.get("content-type"),
      retryAfter: response.headers.get("retry-after"),
      requestId: response.headers.get("x-request-id")
    });
  }
  if (response.status === 204) {
    return null as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({ code: "invalid_json", message: apiMessage("server"), status: response.status });
  }
}

// ----------------------------------------------------------------------------- participant (public)

export function getRoom(code: string, signal?: AbortSignal): Promise<LiveRoomInfo> {
  return liveRequest(`/rooms/${encodeURIComponent(code)}`, { signal });
}

export function joinRoom(code: string, body: LiveJoinRequest): Promise<LiveJoinResult> {
  return liveRequest(`/rooms/${encodeURIComponent(code)}/join`, { method: "POST", body });
}

export function rejoinRoom(code: string, body: { display_name: string; return_code: string }): Promise<LiveJoinResult> {
  return liveRequest(`/rooms/${encodeURIComponent(code)}/rejoin`, { method: "POST", body });
}

export function suggestName(lang: string, signal?: AbortSignal): Promise<{ name: string }> {
  return liveRequest(`/names/suggest?lang=${encodeURIComponent(lang)}`, { signal, withCredentials: false });
}

export function getMyResults(token: string, signal?: AbortSignal): Promise<LiveMyResults> {
  return liveRequest("/me/results", { token, signal, withCredentials: false });
}

// ----------------------------------------------------------------------------- participant rights (Incremento 4 §3)

/** RF-650: everything the room keeps about me. 401 `token_*` when the token is gone/expired. */
export function getMyData(token: string, signal?: AbortSignal): Promise<LiveMyData> {
  return liveRequest("/me", { token, signal, withCredentials: false });
}

/** RF-650: anonymize me now. The server closes my socket (`participant.kicked`). */
export function eraseMyData(token: string): Promise<{ erased: true }> {
  return liveRequest("/me", { method: "DELETE", token, withCredentials: false });
}

/**
 * A fresh token from name + return code (expired token, finished session). Same shape as the
 * join. 403 `invalid_return_code`, 429 `too_many_attempts`.
 */
export function accessWithReturnCode(body: { session_id: string; display_name: string; return_code: string }): Promise<LiveJoinResult> {
  return liveRequest("/me/access", { method: "POST", body, withCredentials: false });
}

/** RF-1104: report the session or one item. 202 `{report_id}`; 429 `too_many_reports`. */
export function reportContent(token: string, body: LiveContentReport): Promise<{ report_id: string }> {
  return liveRequest("/me/report", { method: "POST", token, body, withCredentials: false });
}

/** Whether the participant token was rejected (expired, replaced or erased): ask for the return code. */
export function isTokenRejected(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.code.startsWith("token_"));
}

export type AccessErrorCode = "invalid_return_code" | "too_many_attempts" | "banned" | "offline" | "generic";

export function toAccessErrorCode(error: unknown): AccessErrorCode {
  if (error instanceof ApiError) {
    if (error.code === "invalid_return_code" || error.code === "too_many_attempts" || error.code === "banned") {
      return error.code;
    }
    if (error.status === 429) {
      return "too_many_attempts";
    }
    if (error.status === 403) {
      return "invalid_return_code";
    }
    if (error.status === 0) {
      return "offline";
    }
  }
  return "generic";
}

export type ReportErrorCode = "too_many_reports" | "token" | "invalid_item" | "offline" | "generic";

export function toReportErrorCode(error: unknown): ReportErrorCode {
  if (error instanceof ApiError) {
    if (error.code === "too_many_reports" || error.status === 429) {
      return "too_many_reports";
    }
    if (isTokenRejected(error)) {
      return "token";
    }
    if (error.code === "invalid_item") {
      return "invalid_item";
    }
    if (error.status === 0) {
      return "offline";
    }
  }
  return "generic";
}

// ----------------------------------------------------------------------------- host (cookie)

export function getSession(sessionId: string, signal?: AbortSignal): Promise<LiveSession> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export function createDisplayToken(sessionId: string): Promise<LiveDisplayToken> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}/display-token`, { method: "POST" });
}

/**
 * RF-514: the host's phone preview in a rehearsal. Same shape as the join (participant "Prévia",
 * reused per session, never in reports). 409 `preview_requires_rehearsal` / `session_finished`.
 */
export function createPreview(sessionId: string): Promise<LiveJoinResult> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}/preview`, { method: "POST" });
}

/** RF-1115: pre-event check of the room (database, bus, capacity, content, limits...). */
export function getPreflight(sessionId: string, signal?: AbortSignal): Promise<LivePreflight> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}/preflight`, { signal });
}

/** Join errors from CONTRATO §5 with dedicated copy; anything else falls back to the generic text. */
export const JOIN_ERROR_CODES = [
  "room_not_found",
  "room_locked",
  "room_full",
  "session_finished",
  "login_required",
  "name_taken",
  "name_rejected",
  "consent_required",
  "invalid_return_code"
] as const;
export type JoinErrorCode = (typeof JOIN_ERROR_CODES)[number];

export function toJoinErrorCode(error: unknown): JoinErrorCode | "rate_limited" | "offline" | "generic" {
  if (error instanceof ApiError) {
    if ((JOIN_ERROR_CODES as readonly string[]).includes(error.code)) {
      return error.code as JoinErrorCode;
    }
    if (error.status === 404) {
      return "room_not_found";
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

// ----------------------------------------------------------------------------- credential storage

export interface ParticipantCredentials {
  token: string;
  expiresAt: string;
  sessionId: string;
  participantId: string;
  displayName: string;
  avatarSeed: string;
}

const TOKEN_PREFIX = "lq:tok:";
const RETURN_CODE_PREFIX = "lq:rc:";
const DISPLAY_PREFIX = "lq:display:";
const IDENTITY_PREFIX = "lq:who:";
const DEVICE_KEY = "lq:dev";

function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(storage: Storage | null, key: string): T | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null, key: string, value: string | null): void {
  if (!storage) {
    return;
  }
  try {
    if (value === null) {
      storage.removeItem(key);
    } else {
      storage.setItem(key, value);
    }
  } catch {
    // Storage full or blocked (private mode): the flow still works for this page view.
  }
}

export function credentialsFromJoin(result: LiveJoinResult): ParticipantCredentials {
  return {
    token: result.token,
    expiresAt: result.expires_at,
    sessionId: result.session_id,
    participantId: result.participant_id,
    displayName: result.display_name,
    avatarSeed: result.avatar_seed
  };
}

export function saveParticipantCredentials(code: string, credentials: ParticipantCredentials): void {
  write(session(), `${TOKEN_PREFIX}${code}`, JSON.stringify(credentials));
  saveParticipantIdentity(code, { sessionId: credentials.sessionId, displayName: credentials.displayName });
}

export function loadParticipantCredentials(code: string, now: number = Date.now()): ParticipantCredentials | null {
  const stored = readJson<ParticipantCredentials>(session(), `${TOKEN_PREFIX}${code}`);
  if (!stored || typeof stored.token !== "string" || !stored.token) {
    return null;
  }
  const expires = Date.parse(stored.expiresAt);
  if (Number.isFinite(expires) && expires <= now) {
    clearParticipantCredentials(code);
    return null;
  }
  return stored;
}

export function clearParticipantCredentials(code: string): void {
  write(session(), `${TOKEN_PREFIX}${code}`, null);
}

/**
 * Who joined which session from this tab, kept apart from the token: tokens expire (and are then
 * dropped), but "my data"/"my results" and the claim still need the session id to ask for a fresh
 * token with the return code (join codes are reused, so the code alone is not enough).
 */
export interface ParticipantIdentity {
  sessionId: string;
  displayName: string;
}

/** Kept past the 7-day claim window; after that the identity is useless and is dropped. */
const IDENTITY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function local(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// The identity (session id + name) is not a credential: the return code is still required. It
// lives in localStorage so "my data" and the claim keep working after the tab is closed.
export function saveParticipantIdentity(code: string, identity: ParticipantIdentity, now: number = Date.now()): void {
  write(local(), `${IDENTITY_PREFIX}${code}`, JSON.stringify({ ...identity, savedAt: now }));
}

export function loadParticipantIdentity(code: string, now: number = Date.now()): ParticipantIdentity | null {
  const key = `${IDENTITY_PREFIX}${code}`;
  const stored = readJson<ParticipantIdentity & { savedAt?: number }>(local(), key);
  if (!stored || typeof stored.sessionId !== "string" || !stored.sessionId) {
    return null;
  }
  if (typeof stored.savedAt === "number" && now - stored.savedAt > IDENTITY_TTL_MS) {
    write(local(), key, null);
    return null;
  }
  return { sessionId: stored.sessionId, displayName: stored.displayName };
}

/** Forget everything this tab knows about the participation (after "delete my data"). */
export function forgetParticipant(code: string): void {
  const storage = session();
  write(storage, `${TOKEN_PREFIX}${code}`, null);
  write(storage, `${RETURN_CODE_PREFIX}${code}`, null);
  write(local(), `${IDENTITY_PREFIX}${code}`, null);
}

/** The return code is shown once after joining and kept for this tab so people can look it up again. */
export function saveReturnCode(code: string, returnCode: string): void {
  write(session(), `${RETURN_CODE_PREFIX}${code}`, returnCode);
}

export function loadReturnCode(code: string): string | null {
  const storage = session();
  try {
    return storage?.getItem(`${RETURN_CODE_PREFIX}${code}`) || null;
  } catch {
    return null;
  }
}

export function saveDisplayToken(sessionId: string, token: string): void {
  write(session(), `${DISPLAY_PREFIX}${sessionId}`, token);
}

export function loadDisplayToken(sessionId: string): string | null {
  try {
    return session()?.getItem(`${DISPLAY_PREFIX}${sessionId}`) || null;
  } catch {
    return null;
  }
}

/**
 * Best-effort device hash for anti-abuse/rejoin (`dev_h`, PLANO §13.5): sha256(device key ‖ session).
 * The raw key never leaves the browser and is distinct from `X-Client-Key`.
 */
export async function computeDeviceHash(sessionId: string): Promise<string | undefined> {
  try {
    if (typeof window === "undefined" || !window.crypto?.subtle) {
      return undefined;
    }
    let key = window.localStorage.getItem(DEVICE_KEY);
    if (!key) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      window.localStorage.setItem(DEVICE_KEY, key);
    }
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${key}${sessionId}`));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}
