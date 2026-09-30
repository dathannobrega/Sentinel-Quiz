/**
 * REST calls used by the live screens (CONTRATO §4 "Sessões (host)" and §5 "participante").
 *
 * Deliberately NOT `lib/api/client.ts`: the participant client never sends `X-Client-Key`
 * (RNF-508) and authenticates with its own Bearer token. Errors are normalized with the project's
 * `normalizeErrorResponse`, so `error.code` is the backend code (`room_locked`, `name_taken`...).
 *
 * Participant credentials live in `sessionStorage` keyed by room code — never in the URL and never
 * in localStorage (PLANO §13.5).
 */
import { buildApiUrl } from "@/lib/api/client";
import { ApiError, apiMessage, normalizeErrorResponse } from "@/lib/api/errors";
import type {
  LiveDisplayToken,
  LiveJoinRequest,
  LiveJoinResult,
  LiveMyResults,
  LiveRoomInfo,
  LiveSession
} from "@/types/api/live";

const LIVE_TIMEOUT_MS = 15_000;

interface LiveRequestOptions {
  method?: "GET" | "POST";
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

// ----------------------------------------------------------------------------- host (cookie)

export function getSession(sessionId: string, signal?: AbortSignal): Promise<LiveSession> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}`, { signal });
}

export function createDisplayToken(sessionId: string): Promise<LiveDisplayToken> {
  return liveRequest(`/sessions/${encodeURIComponent(sessionId)}/display-token`, { method: "POST" });
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
