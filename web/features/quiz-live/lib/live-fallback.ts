/**
 * SSE + POST fallback transport for `sq.live.v1` (RNF-309, CONTRATO-INCREMENTO-3 §3).
 *
 * Some networks (corporate proxies, captive portals) break WebSockets. The client then reads the
 * very same server frames from `GET /api/live/sse` (`EventSource`) and sends each client frame with
 * `POST /api/live/cmd`, whose JSON response carries the replies addressed to the sender
 * (`answer.ack`, `error`, `time.sync.reply`). Broadcasts keep arriving through the stream.
 *
 * This module holds the pure pieces (fallback decision, URL/body building, response handling) so
 * they can be unit-tested; `live-socket.ts` owns the lifecycle.
 */
import type { LiveCredentials } from "@/features/quiz-live/lib/live-socket";
import { LIVE_PROTOCOL_VERSION, toServerMessage, type ClientMessage, type ServerMessage } from "@/features/quiz-live/lib/protocol";

/** A WebSocket that drops before `welcome` within this window counts as a "quick" failure. */
export const SSE_FALLBACK_WINDOW_MS = 5_000;
/** Consecutive quick pre-`welcome` drops that trigger the fallback. */
export const SSE_FALLBACK_QUICK_FAILURES = 2;

/** One WebSocket attempt that ended before `welcome`. */
export interface WsAttemptFailure {
  /** Whether `open` fired (the upgrade went through). */
  opened: boolean;
  /** ms from creating the socket to its end. */
  durationMs: number;
}

export interface FallbackContext {
  /** `navigator.onLine`: offline is not a WebSocket problem, SSE would fail the same way. */
  online: boolean;
  /** A WebSocket already reached `welcome` in this client: the network does carry sockets. */
  everWelcomed: boolean;
}

/**
 * Whether to abandon the WebSocket for SSE + POST, given the consecutive pre-`welcome` failures
 * (oldest first). The rule of the contract: the socket could not open, or it dropped twice in a row
 * before `welcome` within ≤ 5 s.
 *
 * A socket that never opens after an earlier `welcome` is treated as a server restart (not a hostile
 * network), so it only counts towards the "twice in a row" rule.
 */
export function shouldFallbackToSse(failures: readonly WsAttemptFailure[], context: FallbackContext): boolean {
  if (!context.online || failures.length === 0) {
    return false;
  }
  const last = failures[failures.length - 1];
  if (!last.opened && !context.everWelcomed) {
    return true;
  }
  if (failures.length < SSE_FALLBACK_QUICK_FAILURES) {
    return false;
  }
  return failures.slice(-SSE_FALLBACK_QUICK_FAILURES).every((failure) => failure.durationMs <= SSE_FALLBACK_WINDOW_MS);
}

// ----------------------------------------------------------------------------- EventSource surface

/** Minimal `EventSource` surface used by the socket (lets tests inject a fake). */
export interface EventSourceLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  addEventListener(type: "close", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string, init: { withCredentials: boolean }) => EventSourceLike;

export const EVENT_SOURCE_CLOSED = 2;

export function defaultEventSourceFactory(): EventSourceFactory | null {
  if (typeof EventSource === "undefined") {
    return null;
  }
  return (url, init) => new EventSource(url, init) as unknown as EventSourceLike;
}

// ----------------------------------------------------------------------------- URLs and bodies

/** `GET /api/live/sse` URL: token in the query (EventSource cannot send headers) or host session. */
export function buildSseUrl(baseUrl: string, credentials: LiveCredentials): string {
  const params = new URLSearchParams();
  if (credentials.kind === "host") {
    params.set("session_id", credentials.sessionId);
    params.set("role", "host");
  } else {
    params.set("token", credentials.token);
  }
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}

/** Whether the stream needs the session cookie (host only). */
export function sseWithCredentials(credentials: LiveCredentials): boolean {
  return credentials.kind === "host";
}

export interface CmdEnvelope {
  v: 1;
  type: ClientMessage["type"];
  mid?: string;
  data: ClientMessage["data"];
}

export interface CmdRequestBody {
  auth: { token: string } | { session_id: string; role: "host" };
  frame: CmdEnvelope;
}

export function buildCmdBody(credentials: LiveCredentials, message: ClientMessage, mid?: string): CmdRequestBody {
  const frame: CmdEnvelope = { v: LIVE_PROTOCOL_VERSION, type: message.type, data: message.data };
  if (mid) {
    frame.mid = mid;
  }
  const auth = credentials.kind === "host" ? { session_id: credentials.sessionId, role: "host" as const } : { token: credentials.token };
  return { auth, frame };
}

/** `fetch` init for one command: Bearer token (rate-limit key) or the host cookie. */
export function buildCmdInit(credentials: LiveCredentials, body: CmdRequestBody): RequestInit {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (credentials.kind !== "host") {
    headers.Authorization = `Bearer ${credentials.token}`;
  }
  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: credentials.kind === "host" ? "include" : "omit",
    cache: "no-store",
    keepalive: false
  };
}

// ----------------------------------------------------------------------------- responses

export type CmdOutcome =
  /** 200: frames addressed to the sender, fed to the same handler as stream frames. */
  | { kind: "frames"; frames: ServerMessage[] }
  /** 401/403 `live_auth`: behave like a socket closed with `closeCode`. */
  | { kind: "auth"; closeCode: number }
  /** 429: the command was not processed. */
  | { kind: "rate_limited" }
  /** Network failure or any other status: the command may not have been processed. */
  | { kind: "failed"; status: number };

/** Close code used when a 401/403 does not say which one (plain authentication failure). */
const DEFAULT_AUTH_CLOSE = 4001;

function readCloseCode(body: unknown): number | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) {
    return null;
  }
  const code = (details as { close_code?: unknown }).close_code;
  return typeof code === "number" && Number.isInteger(code) ? code : null;
}

/** Interprets a `POST /api/live/cmd` response (status + decoded JSON body, or null). */
export function interpretCmdResponse(status: number, body: unknown): CmdOutcome {
  if (status === 200) {
    const raw = typeof body === "object" && body !== null ? (body as { frames?: unknown }).frames : null;
    const frames = Array.isArray(raw) ? raw.map(toServerMessage).filter((frame): frame is ServerMessage => frame !== null) : [];
    return { kind: "frames", frames };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", closeCode: readCloseCode(body) ?? DEFAULT_AUTH_CLOSE };
  }
  if (status === 429) {
    return { kind: "rate_limited" };
  }
  return { kind: "failed", status };
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, "status" | "json">>;

/** Sends one command and interprets the answer (never throws). */
export async function postLiveCommand(
  fetchImpl: FetchLike,
  url: string,
  credentials: LiveCredentials,
  message: ClientMessage,
  mid?: string
): Promise<CmdOutcome> {
  let response: Pick<Response, "status" | "json">;
  try {
    response = await fetchImpl(url, buildCmdInit(credentials, buildCmdBody(credentials, message, mid)));
  } catch {
    return { kind: "failed", status: 0 };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return interpretCmdResponse(response.status, body);
}

/** Parses the `close` event payload of the stream (`{"code": n}`); null when malformed. */
export function parseSseClose(data: unknown): number | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const value = JSON.parse(data) as { code?: unknown };
    return typeof value.code === "number" && Number.isInteger(value.code) ? value.code : null;
  } catch {
    return null;
  }
}
