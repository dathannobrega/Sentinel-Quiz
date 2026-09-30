/**
 * Framework-agnostic WebSocket client for `sq.live.v1` (CONTRATO §6, PLANO §10.4).
 *
 * Responsibilities
 * - connect with the subprotocol and send `hello` as the very first frame;
 * - reconnect with backoff: first retry immediate, then exponential 0.5 s → 10 s with full jitter;
 *   retry right away on `visibilitychange` (visible) and `online`; never after a terminal close code;
 * - heartbeat watchdog: no frame for 2 × `hb_ms` → the connection is considered dead;
 * - echo `srv.ping` with `pong` and run 5 `time.sync` round trips after every `welcome`;
 * - answers outbox: every `answer.submit` keeps its `answer_id` and is re-sent (after reconnects and
 *   on a timer) until the matching `answer.ack` arrives — the server deduplicates by id;
 * - rate-limit-safe send queue (token bucket well below the server's 20 msg/s, burst 40).
 *
 * The class never touches React; `use-live-session.ts` wires it to the store.
 */
import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import {
  createLiveId,
  encodeClientMessage,
  isTerminalCloseCode,
  LIVE_CLOSE_CODES,
  LIVE_SUBPROTOCOL,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage
} from "@/features/quiz-live/lib/protocol";

export type LiveCredentials =
  | { kind: "participant"; token: string }
  | { kind: "display"; token: string }
  | { kind: "host"; sessionId: string };

export type LiveSocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export type LiveCloseReason =
  | "manual"
  | "network"
  | "heartbeat"
  | "handshake"
  | "policy"
  | "too_big"
  | "auth"
  | "token_expired"
  | "kicked"
  | "banned"
  | "room_full"
  | "session_ended"
  | "protocol"
  | "rate_limited";

export interface LiveSocketStatusEvent {
  status: LiveSocketStatus;
  /** Consecutive failed attempts (0 once `welcome` arrives). */
  attempt: number;
  reason?: LiveCloseReason;
  closeCode?: number;
  /** Delay before the next attempt (reconnecting only). */
  retryInMs?: number;
}

type AnswerData = Extract<ClientMessage, { type: "answer.submit" }>["data"];
export type AnswerPayload = Omit<AnswerData, "answer_id">;

/** Minimal WebSocket surface used here (lets tests inject a fake). */
export interface WebSocketLike {
  readonly readyState: number;
  readonly protocol?: string;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason?: string; wasClean?: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

/** Event target used for `visibilitychange`/`online` (defaults to window + document). */
export interface LiveEnvironment {
  onWake(listener: () => void): () => void;
  isVisible(): boolean;
}

export interface LiveSocketOptions {
  url: string | (() => string);
  credentials: LiveCredentials;
  createWebSocket?: WebSocketFactory;
  clock?: ClockSync;
  environment?: LiveEnvironment | null;
  random?: () => number;
  /** Heartbeat interval before `welcome` tells us the real one. */
  defaultHeartbeatMs?: number;
  /** Max wait for `welcome` after the socket opens. */
  handshakeTimeoutMs?: number;
  /** Re-send an un-acked answer after this long while connected. */
  answerResendMs?: number;
  /** Token bucket: sustained messages per second and burst size. */
  sendRatePerSecond?: number;
  sendBurst?: number;
  /** Queue cap while offline (oldest non-answer messages are dropped first). */
  maxQueue?: number;
}

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 10_000;
const RATE_LIMITED_MIN_DELAY_MS = 2_000;
const WS_OPEN = 1;

/**
 * Delay before reconnect attempt `attempt` (1-based count of consecutive failures):
 * attempt 1 → 0 ms (immediate), attempt n ≥ 2 → uniform(0, min(10 s, 0.5 s × 2^(n−2))) (full jitter).
 */
export function computeBackoffDelay(attempt: number, random: () => number = Math.random): number {
  if (attempt <= 1) {
    return 0;
  }
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 2));
  return Math.floor(random() * ceiling);
}

const CLOSE_REASONS: Record<number, LiveCloseReason> = {
  [LIVE_CLOSE_CODES.policy]: "policy",
  [LIVE_CLOSE_CODES.tooBig]: "too_big",
  [LIVE_CLOSE_CODES.auth]: "auth",
  [LIVE_CLOSE_CODES.tokenExpired]: "token_expired",
  [LIVE_CLOSE_CODES.kicked]: "kicked",
  [LIVE_CLOSE_CODES.banned]: "banned",
  [LIVE_CLOSE_CODES.roomFull]: "room_full",
  [LIVE_CLOSE_CODES.sessionEnded]: "session_ended",
  [LIVE_CLOSE_CODES.protocol]: "protocol",
  [LIVE_CLOSE_CODES.rateLimited]: "rate_limited"
};

export function closeReasonForCode(code: number): LiveCloseReason {
  return CLOSE_REASONS[code] ?? "network";
}

/** Converts an http(s) API URL into the ws(s) equivalent. */
export function toWebSocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http(s?):\/\//i, (_match, secure: string) => (secure ? "wss://" : "ws://"));
}

function browserEnvironment(): LiveEnvironment | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  return {
    onWake(listener) {
      const onVisibility = () => {
        if (document.visibilityState === "visible") {
          listener();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", listener);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("online", listener);
      };
    },
    isVisible: () => document.visibilityState !== "hidden"
  };
}

function defaultFactory(url: string, protocols: string[]): WebSocketLike {
  return new WebSocket(url, protocols) as unknown as WebSocketLike;
}

interface QueuedFrame {
  message: ClientMessage;
  mid?: string;
}

interface OutboxEntry {
  data: AnswerData;
  sentAt: number | null;
}

type MessageListener = (message: ServerMessage) => void;
type StatusListener = (event: LiveSocketStatusEvent) => void;

export class LiveSocket {
  readonly clock: ClockSync;
  private readonly options: Required<
    Pick<
      LiveSocketOptions,
      "defaultHeartbeatMs" | "handshakeTimeoutMs" | "answerResendMs" | "sendRatePerSecond" | "sendBurst" | "maxQueue"
    >
  >;
  private readonly createWebSocket: WebSocketFactory;
  private readonly random: () => number;
  private readonly environment: LiveEnvironment | null;
  private readonly url: string | (() => string);
  private credentials: LiveCredentials;

  private ws: WebSocketLike | null = null;
  private status: LiveSocketStatus = "idle";
  private attempt = 0;
  private welcomed = false;
  private stopped = true;
  private terminal: { reason: LiveCloseReason; code?: number } | null = null;
  private heartbeatMs: number;
  private lastFrameAt = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private resendTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private detachEnvironment: (() => void) | null = null;

  private tokens: number;
  private lastRefill = 0;
  private queue: QueuedFrame[] = [];
  private readonly outbox = new Map<string, OutboxEntry>();

  private readonly messageListeners = new Set<MessageListener>();
  private readonly statusListeners = new Set<StatusListener>();

  constructor(options: LiveSocketOptions) {
    this.url = options.url;
    this.credentials = options.credentials;
    this.createWebSocket = options.createWebSocket ?? defaultFactory;
    this.clock = options.clock ?? new ClockSync();
    this.random = options.random ?? Math.random;
    this.environment = options.environment === undefined ? browserEnvironment() : options.environment;
    this.options = {
      defaultHeartbeatMs: options.defaultHeartbeatMs ?? 15_000,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 8_000,
      answerResendMs: options.answerResendMs ?? 3_000,
      sendRatePerSecond: options.sendRatePerSecond ?? 10,
      sendBurst: options.sendBurst ?? 10,
      maxQueue: options.maxQueue ?? 100
    };
    this.heartbeatMs = this.options.defaultHeartbeatMs;
    this.tokens = this.options.sendBurst;
  }

  // ------------------------------------------------------------------------- public API

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getStatus(): LiveSocketStatus {
    return this.status;
  }

  /** Number of answers still waiting for `answer.ack`. */
  get pendingAnswers(): number {
    return this.outbox.size;
  }

  hasPendingAnswer(answerId: string): boolean {
    return this.outbox.has(answerId);
  }

  connect(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.terminal = null;
    this.attempt = 0;
    this.detachEnvironment = this.environment?.onWake(() => this.wake()) ?? null;
    this.open();
  }

  /** Replaces the credentials (e.g. token refreshed by a rejoin) and reconnects. */
  updateCredentials(credentials: LiveCredentials): void {
    this.credentials = credentials;
    if (!this.stopped) {
      this.terminal = null;
      this.dropSocket();
      this.attempt = 0;
      this.open();
    }
  }

  /** Closes for good (no reconnect). */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.detachEnvironment?.();
    this.detachEnvironment = null;
    this.dropSocket(1000, "client_closed");
    this.queue = [];
    this.setStatus({ status: "closed", attempt: this.attempt, reason: "manual" });
  }

  /**
   * Sends (or queues while offline) a client message. Returns the `mid` used, so `error.ref_mid`
   * can be correlated. Host commands should only be enabled while the status is `open`.
   */
  send(message: ClientMessage, options: { queueWhileOffline?: boolean } = {}): string {
    const mid = createLiveId();
    if (message.type === "answer.submit") {
      this.trackAnswer(message.data);
      return mid;
    }
    if (this.isReady()) {
      this.enqueue({ message, mid });
    } else if (options.queueWhileOffline !== false) {
      this.enqueue({ message, mid });
    }
    return mid;
  }

  /** Submits an answer through the outbox. Returns the generated `answer_id`. */
  submitAnswer(payload: AnswerPayload): string {
    const answerId = createLiveId();
    this.trackAnswer({ ...payload, answer_id: answerId });
    return answerId;
  }

  /** Forgets outbox entries that can no longer be accepted (e.g. the question moved on). */
  dropAnswers(predicate: (data: AnswerData) => boolean): void {
    for (const [answerId, entry] of this.outbox) {
      if (predicate(entry.data)) {
        this.outbox.delete(answerId);
      }
    }
  }

  /** Test/debug helper: forces the backoff path as if the network dropped. */
  simulateNetworkDrop(): void {
    this.handleDisconnect(undefined, "network");
  }

  // ------------------------------------------------------------------------- connection lifecycle

  private resolveUrl(): string {
    return typeof this.url === "function" ? this.url() : this.url;
  }

  private open(): void {
    this.clearTimer("reconnectTimer");
    if (this.stopped) {
      return;
    }
    this.welcomed = false;
    this.setStatus({ status: this.attempt === 0 ? "connecting" : "reconnecting", attempt: this.attempt });
    let socket: WebSocketLike;
    try {
      socket = this.createWebSocket(this.resolveUrl(), [LIVE_SUBPROTOCOL]);
    } catch {
      this.scheduleReconnect("network");
      return;
    }
    this.ws = socket;
    // One budget for TCP/TLS connect + upgrade + hello → welcome (a hanging connect never stalls us).
    this.clearTimer("handshakeTimer");
    this.handshakeTimer = setTimeout(() => this.handleDisconnect(undefined, "handshake"), this.options.handshakeTimeoutMs);
    socket.onopen = () => {
      if (this.ws !== socket) {
        return;
      }
      this.sendRaw({ message: this.helloMessage() });
    };
    socket.onmessage = (event) => {
      if (this.ws !== socket) {
        return;
      }
      this.handleFrame(event.data);
    };
    socket.onerror = () => {
      // `close` always follows `error`; nothing to do here.
    };
    socket.onclose = (event) => {
      if (this.ws !== socket) {
        return;
      }
      this.handleDisconnect(event.code, closeReasonForCode(event.code));
    };
  }

  private helloMessage(): ClientMessage {
    const credentials = this.credentials;
    if (credentials.kind === "host") {
      return { type: "hello", data: { session_id: credentials.sessionId, role: "host" } };
    }
    return { type: "hello", data: { token: credentials.token } };
  }

  private handleDisconnect(code: number | undefined, reason: LiveCloseReason): void {
    this.dropSocket(reason === "heartbeat" || reason === "handshake" ? 1000 : undefined);
    this.clearTimer("handshakeTimer");
    this.clearTimer("watchdogTimer");
    this.clearTimer("resendTimer");
    this.clearTimer("drainTimer");
    if (this.stopped) {
      return;
    }
    if (typeof code === "number" && isTerminalCloseCode(code)) {
      this.terminal = { reason, code };
    }
    if (this.terminal) {
      this.stopped = true;
      this.detachEnvironment?.();
      this.detachEnvironment = null;
      this.setStatus({ status: "closed", attempt: this.attempt, reason: this.terminal.reason, closeCode: this.terminal.code ?? code });
      return;
    }
    this.scheduleReconnect(reason, code);
  }

  private scheduleReconnect(reason: LiveCloseReason, code?: number): void {
    this.attempt += 1;
    let delay = computeBackoffDelay(this.attempt, this.random);
    if (reason === "rate_limited") {
      delay = Math.max(delay, RATE_LIMITED_MIN_DELAY_MS);
    }
    this.setStatus({ status: "reconnecting", attempt: this.attempt, reason, closeCode: code, retryInMs: delay });
    this.clearTimer("reconnectTimer");
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  /** Tab visible again / network back: skip the remaining backoff. */
  private wake(): void {
    if (this.stopped) {
      return;
    }
    if (this.status === "open") {
      // Background tabs throttle timers: a frozen socket may still look open. Probe it.
      if (this.clock.localNow() - this.lastFrameAt > this.heartbeatMs) {
        this.handleDisconnect(undefined, "heartbeat");
      }
      return;
    }
    if (this.reconnectTimer) {
      this.clearTimer("reconnectTimer");
      this.open();
    }
  }

  private dropSocket(code?: number, reason?: string): void {
    const socket = this.ws;
    this.ws = null;
    this.welcomed = false;
    if (!socket) {
      return;
    }
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      if (socket.readyState <= WS_OPEN) {
        socket.close(code ?? 1000, reason);
      }
    } catch {
      // Already closed.
    }
  }

  // ------------------------------------------------------------------------- inbound frames

  private handleFrame(raw: unknown): void {
    this.lastFrameAt = this.clock.localNow();
    this.armWatchdog();
    const message = parseServerMessage(raw);
    if (!message) {
      return;
    }
    if (!this.clock.isSynced) {
      this.clock.seedFromServerTime(message.sts);
    }
    switch (message.type) {
      case "welcome":
        this.onWelcome(message.data.hb_ms);
        break;
      case "srv.ping":
        this.sendRaw({ message: { type: "pong", data: { ts: message.data.ts } } }, true);
        break;
      case "time.sync.reply":
        this.clock.addReply(message.data);
        this.requestTimeSample();
        break;
      case "answer.ack":
        this.outbox.delete(message.data.answer_id);
        break;
      case "room.snapshot": {
        const snapshot = message.data;
        const answered = snapshot.my?.answered_current === true;
        this.dropAnswers((data) => data.qi !== snapshot.qi || answered);
        break;
      }
      case "question.intro": {
        const qi = message.data.qi;
        this.dropAnswers((data) => data.qi !== qi);
        break;
      }
      case "participant.kicked":
        this.terminal = { reason: message.data.banned ? "banned" : "kicked", code: message.data.banned ? LIVE_CLOSE_CODES.banned : LIVE_CLOSE_CODES.kicked };
        break;
      default:
        break;
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private onWelcome(hbMs: number): void {
    this.clearTimer("handshakeTimer");
    this.welcomed = true;
    this.attempt = 0;
    if (Number.isFinite(hbMs) && hbMs > 0) {
      this.heartbeatMs = hbMs;
    }
    this.armWatchdog();
    this.setStatus({ status: "open", attempt: 0 });
    this.clock.beginRound();
    this.requestTimeSample();
    // Re-send every un-acked answer (server dedups by answer_id), then whatever queued offline.
    for (const entry of this.outbox.values()) {
      entry.sentAt = null;
    }
    this.flushOutbox();
    this.drain();
  }

  private requestTimeSample(): void {
    if (!this.isReady() || !this.clock.needsSamples()) {
      return;
    }
    this.sendRaw({ message: { type: "time.sync", data: { t0: this.clock.createRequest() } } }, true);
  }

  private armWatchdog(): void {
    this.clearTimer("watchdogTimer");
    if (this.stopped) {
      return;
    }
    this.watchdogTimer = setTimeout(() => this.handleDisconnect(undefined, "heartbeat"), this.heartbeatMs * 2);
  }

  // ------------------------------------------------------------------------- outbound frames

  private isReady(): boolean {
    return this.ws !== null && this.welcomed && this.ws.readyState === WS_OPEN;
  }

  private trackAnswer(data: AnswerData): void {
    this.outbox.set(data.answer_id, { data, sentAt: null });
    this.flushOutbox();
  }

  private flushOutbox(): void {
    if (!this.isReady()) {
      return;
    }
    const now = this.clock.localNow();
    for (const entry of this.outbox.values()) {
      if (entry.sentAt === null || now - entry.sentAt >= this.options.answerResendMs) {
        if (!this.takeToken()) {
          break;
        }
        entry.sentAt = now;
        this.sendRaw({ message: { type: "answer.submit", data: entry.data } }, true);
      }
    }
    this.clearTimer("resendTimer");
    if (this.outbox.size > 0) {
      this.resendTimer = setTimeout(() => this.flushOutbox(), Math.min(this.options.answerResendMs, 1000));
    }
  }

  private enqueue(frame: QueuedFrame): void {
    this.queue.push(frame);
    while (this.queue.length > this.options.maxQueue) {
      this.queue.shift();
    }
    this.drain();
  }

  private drain(): void {
    this.clearTimer("drainTimer");
    while (this.queue.length > 0 && this.isReady()) {
      if (!this.takeToken()) {
        const wait = Math.ceil(1000 / this.options.sendRatePerSecond);
        this.drainTimer = setTimeout(() => this.drain(), wait);
        return;
      }
      const frame = this.queue.shift();
      if (frame) {
        this.sendRaw(frame, true);
      }
    }
  }

  private takeToken(): boolean {
    const now = this.clock.localNow();
    const elapsed = Math.max(0, now - this.lastRefill);
    this.lastRefill = now;
    this.tokens = Math.min(this.options.sendBurst, this.tokens + (elapsed / 1000) * this.options.sendRatePerSecond);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Writes a frame; `requireOpen` frames are only written after `welcome`. */
  private sendRaw(frame: QueuedFrame, requireOpen = false): boolean {
    const socket = this.ws;
    if (!socket || socket.readyState !== WS_OPEN || (requireOpen && !this.welcomed)) {
      return false;
    }
    try {
      socket.send(encodeClientMessage(frame.message, frame.mid));
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------------- utils

  private setStatus(event: LiveSocketStatusEvent): void {
    this.status = event.status;
    for (const listener of this.statusListeners) {
      listener(event);
    }
  }

  private clearTimer(name: "reconnectTimer" | "handshakeTimer" | "watchdogTimer" | "resendTimer" | "drainTimer"): void {
    const timer = this[name];
    if (timer) {
      clearTimeout(timer);
      this[name] = null;
    }
  }

  private clearTimers(): void {
    this.clearTimer("reconnectTimer");
    this.clearTimer("handshakeTimer");
    this.clearTimer("watchdogTimer");
    this.clearTimer("resendTimer");
    this.clearTimer("drainTimer");
  }
}
