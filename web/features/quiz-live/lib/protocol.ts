/**
 * WebSocket protocol `sq.live.v1` (docs/live-quiz/CONTRATO-INCREMENTO-1.md §6, plus the time controls
 * and SSE fallback of CONTRATO-INCREMENTO-3.md §3–§4 and the moderation fields of
 * CONTRATO-INCREMENTO-4.md §2/§4, the GA item types of CONTRATO-INCREMENTO-5.md §3–§7 and the
 * waiting room of CONTRATO-INCREMENTO-7.md §4).
 * Discriminated unions for every frame plus small type guards. Keep in sync with
 * backend/app/live/protocol.py.
 */
import type { LiveItem, LiveItemType, LivePhase, LiveScoring, LiveSessionStatus, LiveThemeKey } from "@/types/api/live";

export const LIVE_SUBPROTOCOL = "sq.live.v1";
export const LIVE_PROTOCOL_VERSION = 1;
export const LIVE_WS_PATH = "/api/live/ws";
/** SSE + POST fallback (RNF-309): same frames over `EventSource`, commands over `fetch`. */
export const LIVE_SSE_PATH = "/api/live/sse";
export const LIVE_CMD_PATH = "/api/live/cmd";

export type LiveTransport = "ws" | "sse";

export const LIVE_CLOSE_CODES = {
  policy: 1008,
  tooBig: 1009,
  auth: 4001,
  tokenExpired: 4002,
  kicked: 4003,
  banned: 4004,
  roomFull: 4008,
  sessionEnded: 4010,
  protocol: 4011,
  rateLimited: 4029,
  /** Server restart / SSE stream recycling: reconnect right away. */
  restart: 1012
} as const;

/** Close codes after which the client must NOT reconnect automatically. */
export const LIVE_TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  LIVE_CLOSE_CODES.policy,
  LIVE_CLOSE_CODES.auth,
  LIVE_CLOSE_CODES.tokenExpired,
  LIVE_CLOSE_CODES.kicked,
  LIVE_CLOSE_CODES.banned,
  LIVE_CLOSE_CODES.roomFull,
  LIVE_CLOSE_CODES.sessionEnded,
  LIVE_CLOSE_CODES.protocol
]);

export type LiveRole = "host" | "display" | "participant";

export interface PublicOption {
  id: string;
  text: string;
  /** 0-based display index: drives shape/colour/letter (A–F). */
  index: number;
}

export interface PublicQuestion {
  qi: number;
  item_type: LiveItemType;
  prompt: string;
  options: PublicOption[];
  allow_multiple: boolean;
  body: string | null;
  time_limit_s: number | null;
  points_multiplier: number;
  scored: boolean;
  /** multi_choice: number of correct options (for the "select N" hint). */
  select_count: number | null;
  /**
   * numeric (Incremento 5): slider range and unit, `null` on other types (older servers omit it).
   * The correct value never reaches this payload.
   */
  numeric?: NumericSpec | null;
  /** word_cloud (Incremento 5): words per person (1..3), `null` on other types. */
  max_words?: number | null;
  /**
   * Removed by moderation (RF-1114, Incremento 4): a neutral, unscored slide with an empty prompt.
   * Clients show "content removed" and never the original text. Older servers omit it.
   */
  removed?: boolean;
}

/** Whether the item was removed by moderation (neutral placeholder slide). */
export function isRemovedQuestion(question: Pick<PublicQuestion, "removed"> | null | undefined): boolean {
  return Boolean(question?.removed);
}

/** Public numeric settings. `step: null` = any value in the range. */
export interface NumericSpec {
  min: number;
  max: number;
  step: number | null;
  unit: string;
}

/** One word of a word cloud. `key` is the normalized form (React key and `host.hide_word`). */
export interface WordCloudWord {
  text: string;
  key: string;
  n: number;
}

/**
 * Word cloud aggregate (live, reveal and `word_cloud.update`): top 60 by count, without filtered or
 * hidden words, which only add to `filtered`.
 */
export interface WordCloudResults {
  words: WordCloudWord[];
  distinct: number;
  filtered: number;
}

/** Numeric distribution: 20 equal bins over [min, max]. Never carries the correct value live. */
export interface NumericResults {
  min: number;
  max: number;
  bins: number[];
  n: number;
  mean: number | null;
  median: number | null;
}

/** Numeric reveal: `value`/`tolerance` are null on phones when the quiz hides the answer. */
export interface NumericReveal extends NumericResults {
  value: number | null;
  tolerance: number | null;
  unit: string;
}

/**
 * Ordering reveal. `correct_order_ids`/`slot_pct_correct` are empty on phones when the quiz hides
 * the answer. A slot percentage is null when nobody answered.
 */
export interface OrderingReveal {
  correct_order_ids: string[];
  slot_pct_correct: Array<number | null>;
  exact: number;
}

export interface LiveTimer {
  answers_open_at_ms: number;
  deadline_ms: number | null;
  /** Host paused the question (Incremento 3): the countdown is frozen at `paused_at_ms`. */
  paused?: boolean;
  paused_at_ms?: number;
  /** Time left at the pause (only when there is a deadline). */
  remaining_ms?: number;
}

/** Extended time per participant (RF-622). `0` = no timer at all. */
export type TimeMultiplier = 0 | 1 | 1.5 | 2;
export const TIME_MULTIPLIERS: readonly TimeMultiplier[] = [1, 1.5, 2, 0];

/** Coerces whatever the server sent into a known multiplier (unknown → 1). */
export function normalizeTimeMultiplier(value: unknown): TimeMultiplier {
  return value === 0 || value === 1.5 || value === 2 ? value : 1;
}

export type OptionCounts = Record<string, number>;

export interface MyReveal {
  answered: boolean;
  correct: boolean | null;
  fraction: number | null;
  points: number;
  total_score: number;
  rank: number | null;
  rank_delta: number;
  streak: number;
}

/**
 * A typed answer on the projector. Offensive ones arrive as `{text: "•••", masked: true}`
 * (Incremento 4 §2); an answer accepted by the author is never masked.
 */
export interface TopAnswer {
  text: string;
  n: number;
  accepted: boolean;
  masked?: boolean;
}

export interface Reveal {
  qi: number;
  item_type: LiveItemType;
  correct_option_ids: string[];
  accepted_answers: string[];
  counts: OptionCounts;
  answered: number;
  total: number;
  pct_correct: number | null;
  avg_ms: number | null;
  fastest?: { display_name: string; ms: number } | null;
  explanation: string | null;
  top_answers?: TopAnswer[];
  my?: MyReveal;
  /** Incremento 5 blocks, only on the matching type. */
  ordering?: OrderingReveal;
  numeric?: NumericReveal;
  word_cloud?: WordCloudResults;
}

export interface Standing {
  rank: number;
  participant_id: string;
  display_name: string;
  avatar_seed: string;
  score: number;
  correct: number;
  delta: number;
}

export interface LobbyPerson {
  participant_id: string;
  display_name: string;
  avatar_seed: string;
}

export interface LobbyState {
  count: number;
  recent: LobbyPerson[];
}

export interface PodiumStats {
  participants: number;
  avg_pct: number | null;
  hardest_qi: number | null;
}

export interface SnapshotSettings {
  scoring: LiveScoring;
  show_live_distribution: boolean;
  show_correct_on_device: boolean;
  show_explanation: boolean;
  music: boolean;
  reading_phase_s: number;
}

export interface MySnapshot {
  participant_id: string;
  display_name: string;
  avatar_seed: string;
  answered_current: boolean;
  /** Incremento 5 adds `order` (ordering ids), `number` and `words`. */
  last_answer?: { choice?: string[]; text?: string; order?: string[]; number?: number; words?: string[] } | null;
  score: number;
  rank: number | null;
  time_multiplier?: number;
}

export interface HostParticipant {
  participant_id: string;
  display_name: string;
  avatar_seed: string;
  score: number;
  connected: boolean;
  /** Incremento 3 (older servers omit them). */
  time_multiplier?: number;
  is_bot?: boolean;
  /** The host's phone preview in a rehearsal (RF-514, Incremento 4); never in reports. */
  is_preview?: boolean;
}

/** One person waiting for the host's approval (Incremento 7). Never shown on the projector. */
export interface WaitingPerson {
  request_id: string;
  display_name: string;
  avatar_seed: string;
  signed_in: boolean;
  created_at: string;
  /** False once the phone stopped polling (closed the tab). */
  connected: boolean;
}

/**
 * Host-only `waiting_room` block of the snapshot and of `waiting_room.update` (Incremento 7):
 * approval switch, room cap, both queue sizes and the 100 oldest people awaiting approval.
 */
export interface WaitingRoomState {
  require_approval: boolean;
  max_participants: number;
  platform_max: number;
  approval_count: number;
  capacity_count: number;
  approval: WaitingPerson[];
}

export interface Snapshot {
  session_id: string;
  title: string;
  theme_key: LiveThemeKey;
  join_code: string;
  join_url: string;
  status: LiveSessionStatus;
  phase: LivePhase;
  qi: number | null;
  total: number;
  settings: SnapshotSettings;
  room_locked: boolean;
  participant_count: number;
  /** Incremento 4: room limit (host warning at 80%, RF-1205) and rehearsal flag. */
  max_participants?: number;
  rehearsal?: boolean;
  question?: PublicQuestion;
  timer?: LiveTimer;
  answered?: number;
  counts?: OptionCounts;
  /** Incremento 5, while the question is open or locked (host; display for the cloud or live distribution). */
  word_cloud?: WordCloudResults;
  numeric?: NumericResults;
  reveal?: Reveal;
  leaderboard?: { top: Standing[]; total: number };
  podium?: { top: Standing[]; stats: PodiumStats };
  lobby?: LobbyState;
  /**
   * `hidden_words` (Incremento 5): normalized keys the host hid on the current word cloud
   * (`[]` on other items; older servers omit it).
   */
  presenter?: { item: LiveItem; next_prompt: string | null; hidden_words?: string[] };
  participants?: HostParticipant[];
  /** Incremento 7, host only. */
  waiting_room?: WaitingRoomState;
  my?: MySnapshot;
}

// ----------------------------------------------------------------------------- server → client

interface ServerBase<T extends string, D> {
  v: 1;
  type: T;
  seq?: number;
  /** Server time, epoch ms. */
  sts: number;
  data: D;
}

export type AnswerAckStatus = "accepted" | "duplicate" | "already_answered" | "late" | "closed" | "invalid" | "paused";
export type LiveErrorCode =
  | "stale"
  | "forbidden"
  | "invalid"
  | "too_early"
  | "rate_limited"
  | "not_found"
  | "already_paused"
  | "not_paused"
  | "paused"
  | "no_timer";

/** `question.paused` / `question.timer`: the whole timer of the open question. */
export interface QuestionTimerData {
  qi: number;
  answers_open_at_ms: number;
  deadline_ms: number | null;
  paused: boolean;
  paused_at_ms?: number;
  remaining_ms?: number;
}

export type ServerMessage =
  | ServerBase<
      "welcome",
      {
        role: LiveRole;
        session_id: string;
        me?: { participant_id: string; display_name: string; avatar_seed: string; time_multiplier?: number };
        hb_ms: number;
        proto: number;
        /** Only sent by the SSE stream (`"sse"`). */
        transport?: LiveTransport;
      }
    >
  | ServerBase<"room.snapshot", Snapshot>
  | ServerBase<"time.sync.reply", { t0: number; t1: number; t2: number }>
  | ServerBase<"lobby.update", LobbyState>
  | ServerBase<
      "question.intro",
      { qi: number; total: number; question: PublicQuestion; answers_open_at_ms: number; deadline_ms: number | null }
    >
  | ServerBase<"answer.ack", { answer_id: string; qi: number; status: AnswerAckStatus }>
  | ServerBase<
      "results.tick",
      { qi: number; answered: number; total: number; counts?: OptionCounts; word_cloud?: WordCloudResults; numeric?: NumericResults }
    >
  | ServerBase<"participant.progress", { qi: number; answered: number; total: number }>
  | ServerBase<"question.locked", { qi: number; reason: "timer" | "all_answered" | "host" }>
  | ServerBase<"question.paused", QuestionTimerData & { paused: true }>
  | ServerBase<"question.timer", QuestionTimerData & { reason: "resume" | "extend"; paused: false }>
  | ServerBase<"participant.time", { time_multiplier: number; qi?: number; deadline_ms?: number | null }>
  | ServerBase<"participant.updated", { participant_id: string; time_multiplier: number }>
  | ServerBase<"question.reveal", Reveal>
  | ServerBase<"leaderboard.show", { top: Standing[]; total: number; my?: { rank: number | null; score: number; behind_by: number | null } }>
  | ServerBase<"podium.show", { top: Standing[]; stats: PodiumStats; my?: { rank: number | null; score: number } }>
  | ServerBase<"session.ended", { report_available: boolean }>
  | ServerBase<"room.locked", { locked: boolean }>
  | ServerBase<"participant.kicked", { banned: boolean }>
  /** Moderation removed item `qi` (`current`: it was on screen). A fresh `room.snapshot` follows. */
  | ServerBase<"item.removed", { qi: number; current: boolean }>
  /**
   * The host hid/showed a word (Incremento 5 §7): replaces the cloud of item `qi` (live or revealed).
   * Only the host copy carries `hidden_words` (normalized keys, sorted).
   */
  | ServerBase<"word_cloud.update", { qi: number; word_cloud: WordCloudResults; hidden_words?: string[] }>
  /** Host only (Incremento 7): the waiting room changed (coalesced with `lobby.update`). */
  | ServerBase<"waiting_room.update", WaitingRoomState>
  | ServerBase<"srv.ping", { ts: number }>
  | ServerBase<"error", { code: LiveErrorCode; ref_mid?: string; detail?: string }>;

export type ServerMessageType = ServerMessage["type"];
export type ServerMessageOf<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

// ----------------------------------------------------------------------------- client → server

export type ClientMessage =
  | { type: "hello"; data: { token: string } | { session_id: string; role: "host" } }
  | { type: "time.sync"; data: { t0: number } }
  | { type: "pong"; data: { ts: number } }
  | {
      type: "answer.submit";
      data: {
        answer_id: string;
        qi: number;
        /** Choice types; ordering sends every id in the chosen order. */
        choice?: string[];
        text?: string;
        /** word_cloud: 1..max_words words of ≤ 25 characters. */
        words?: string[];
        /** numeric: the value parsed on the device in the person's locale (JSON number). */
        number?: number;
        client_elapsed_ms?: number;
      };
    }
  | { type: "host.start"; data: Record<string, never> }
  | { type: "host.next"; data: { expected_qi: number | null } }
  | { type: "host.lock"; data: { expected_qi: number } }
  | { type: "host.reveal"; data: { expected_qi: number } }
  | { type: "host.leaderboard"; data: Record<string, never> }
  | { type: "host.end"; data: Record<string, never> }
  | { type: "host.kick"; data: { participant_id: string; ban?: boolean } }
  | { type: "host.room_lock"; data: { locked: boolean } }
  | { type: "host.accept_answer"; data: { qi: number; text: string } }
  | { type: "host.pause"; data: { expected_qi: number } }
  | { type: "host.resume"; data: { expected_qi: number } }
  | { type: "host.extend"; data: { expected_qi: number; seconds: number } }
  | { type: "host.set_time"; data: { participant_id: string; multiplier: TimeMultiplier } }
  /** Word cloud moderation: `word` is the `key` (or the text, ≤ 25); `hidden: false` shows it again. */
  | { type: "host.hide_word"; data: { qi: number; word: string; hidden?: boolean } }
  /** Waiting room (Incremento 7): admit some (≤ 500 ids) or everyone awaiting approval. */
  | { type: "host.admit"; data: { request_ids: string[] } | { all: true } }
  | { type: "host.reject"; data: { request_id: string } }
  /** New room cap, up to `platform_max`; raising it admits the capacity queue in order. */
  | { type: "host.set_capacity"; data: { max_participants: number } }
  /** Turning approval off admits everyone awaiting it (seats permitting). */
  | { type: "host.set_approval"; data: { required: boolean } };

export type ClientMessageType = ClientMessage["type"];

export interface ClientEnvelope {
  v: 1;
  type: ClientMessageType;
  mid?: string;
  data: ClientMessage["data"];
}

const SERVER_TYPES: ReadonlySet<string> = new Set<ServerMessageType>([
  "welcome",
  "room.snapshot",
  "time.sync.reply",
  "lobby.update",
  "question.intro",
  "answer.ack",
  "results.tick",
  "participant.progress",
  "question.locked",
  "question.paused",
  "question.timer",
  "participant.time",
  "participant.updated",
  "question.reveal",
  "leaderboard.show",
  "podium.show",
  "session.ended",
  "room.locked",
  "participant.kicked",
  "item.removed",
  "word_cloud.update",
  "waiting_room.update",
  "srv.ping",
  "error"
]);

/** Parses a raw frame; returns null for malformed or unknown frames (forward compatible). */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return toServerMessage(value);
}

/** Validates an already-decoded frame (e.g. an item of `POST /api/live/cmd` → `frames`). */
export function toServerMessage(value: unknown): ServerMessage | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const frame = value as { v?: unknown; type?: unknown; data?: unknown; sts?: unknown };
  if (frame.v !== LIVE_PROTOCOL_VERSION || typeof frame.type !== "string" || !SERVER_TYPES.has(frame.type)) {
    return null;
  }
  if (typeof frame.data !== "object" || frame.data === null || typeof frame.sts !== "number") {
    return null;
  }
  return value as ServerMessage;
}

export function isServerMessage<T extends ServerMessageType>(
  message: ServerMessage,
  type: T
): message is ServerMessageOf<T> {
  return message.type === type;
}

export function encodeClientMessage(message: ClientMessage, mid?: string): string {
  const envelope: ClientEnvelope = { v: LIVE_PROTOCOL_VERSION, type: message.type, data: message.data };
  if (mid) {
    envelope.mid = mid;
  }
  return JSON.stringify(envelope);
}

/** Letters for option indexes (display only; ids are opaque). */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

// ----------------------------------------------------------------------------- helpers (frontend only)

/** Geometric shape paired with every option index (never colour alone): ▲ ◆ ● ■ ⬟ ✚. */
export const OPTION_SHAPES = ["triangle", "diamond", "circle", "square", "pentagon", "cross"] as const;
export type OptionShapeName = (typeof OPTION_SHAPES)[number];
export const OPTION_SHAPE_GLYPHS = ["▲", "◆", "●", "■", "⬟", "✚"] as const;

export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

export function optionShape(index: number): OptionShapeName {
  return OPTION_SHAPES[((index % OPTION_SHAPES.length) + OPTION_SHAPES.length) % OPTION_SHAPES.length];
}

/** Room PIN: 6 digits, no leading zero (PLANO §13.1). */
export const JOIN_CODE_LENGTH = 6;
export const JOIN_CODE_PATTERN = /^[1-9]\d{5}$/;

/** Keeps only digits (paste of "482 913", "482-913" or a full join URL) and caps at 6. */
export function normalizeJoinCode(input: string): string {
  const raw = String(input || "");
  const fromUrl = raw.match(/\/j\/(\d[\d\s-]*)/i);
  const source = fromUrl ? fromUrl[1] : raw;
  return source.replace(/\D/g, "").slice(0, JOIN_CODE_LENGTH);
}

export function isValidJoinCode(code: string): boolean {
  return JOIN_CODE_PATTERN.test(code);
}

/** "482913" → "482 913" (display only). */
export function formatJoinCode(code: string): string {
  const digits = String(code || "").replace(/\D/g, "");
  return digits.length === JOIN_CODE_LENGTH ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

/** Item types the participant answers (content/leaderboard are passive screens). */
export function isAnswerableType(type: LiveItemType): boolean {
  return type !== "content" && type !== "leaderboard";
}

/**
 * Choice-based types: answered with `choice` (option ids). `type_answer` sends `text`; the GA types
 * have their own pads (ordering also sends `choice`, numeric `number`, word cloud `words`).
 */
export function isChoiceType(type: LiveItemType): boolean {
  return type === "single_choice" || type === "multi_choice" || type === "true_false" || type === "poll";
}

/** Word cloud limits (Incremento 5 §4). */
export const WORD_MAX_LENGTH = 25;
export const WORDS_PER_PERSON_MAX = 3;
/** Numeric histogram resolution (server `NUMERIC_BINS`). */
export const NUMERIC_BINS = 20;

/** Types answered on a dedicated pad (not option tiles). */
export function isGaType(type: LiveItemType): type is "ordering" | "numeric" | "word_cloud" {
  return type === "ordering" || type === "numeric" || type === "word_cloud";
}

/** Whether the participant can pick more than one option. */
export function allowsMultipleChoices(question: Pick<PublicQuestion, "item_type" | "allow_multiple">): boolean {
  return question.item_type === "multi_choice" || (question.item_type === "poll" && question.allow_multiple);
}

export function isTerminalCloseCode(code: number): boolean {
  return LIVE_TERMINAL_CLOSE_CODES.has(code);
}

/** RFC 4122 v4 id for `answer_id` / `mid`; falls back to getRandomValues when randomUUID is missing. */
export function createLiveId(): string {
  const cryptoApi = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
