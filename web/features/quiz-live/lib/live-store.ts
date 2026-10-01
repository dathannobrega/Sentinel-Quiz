/**
 * Live room state: a pure reducer over `sq.live.v1` frames + a tiny external store consumed with
 * `useSyncExternalStore` and selectors, so a vote tick re-renders only what reads the counts
 * (PLANO §10.3 "Regra de estado no front").
 *
 * Rules
 * - `room.snapshot` is authoritative: it REPLACES the room fields (after every reconnect).
 * - Incremental events update the fields they own; events for another `qi` are ignored.
 * - Frames carrying a `seq` at or below the last applied one are ignored (duplicates/out of order);
 *   a snapshot always wins.
 * - `timer` is always the ROOM timer (pause state included). A participant's own deadline (extended
 *   time, RF-622) is derived with `selectMyTimer`, never stored, so pause/resume/extend frames that
 *   only carry the room timer keep it right.
 * - GA types (Incremento 5): `wordCloud`/`numeric` hold the live aggregates of the open question
 *   (results.tick, snapshot); the revealed ones live inside `reveal`. `word_cloud.update` (host hid a
 *   word) replaces the cloud of the current question in both places. `hiddenWords` (host only) is the
 *   server's list of hidden keys, from the snapshot's presenter block and the host `word_cloud.update`.
 * - `item.removed` (moderation, Incremento 4) swaps the item on screen for the neutral placeholder
 *   at once (no answers, no timer); the fresh `room.snapshot` the server sends right after is still
 *   authoritative. `removedItem` records the event so the host can show a toast.
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

import { personalTimer } from "@/features/quiz-live/lib/countdown";
import type { LiveCloseReason, LiveSocketStatus } from "@/features/quiz-live/lib/live-socket";
import {
  normalizeTimeMultiplier,
  type AnswerAckStatus,
  type HostParticipant,
  type LiveErrorCode,
  type LiveRole,
  type LiveTimer,
  type LiveTransport,
  type LobbyPerson,
  type LobbyState,
  type MySnapshot,
  type NumericResults,
  type OptionCounts,
  type PodiumStats,
  type PublicQuestion,
  type Reveal,
  type ServerMessage,
  type Snapshot,
  type SnapshotSettings,
  type Standing,
  type TimeMultiplier,
  type WordCloudResults
} from "@/features/quiz-live/lib/protocol";
import type { LiveItem, LivePhase, LiveSessionStatus, LiveThemeKey } from "@/types/api/live";

export interface LiveConnectionState {
  status: LiveSocketStatus;
  attempt: number;
  reason: LiveCloseReason | null;
  closeCode: number | null;
  retryInMs: number | null;
  /** "sse" once the client fell back to SSE + POST (RNF-309). */
  transport: LiveTransport;
}

export interface LiveAnswerDraft {
  /** Choice types; ordering: every id in the chosen order. */
  choice?: string[];
  text?: string;
  /** word_cloud (Incremento 5). */
  words?: string[];
  /** numeric (Incremento 5): already parsed in the person's locale. */
  number?: number;
}

export type SubmissionStatus = "sending" | "accepted" | "rejected";

export interface LiveSubmission {
  qi: number;
  answerId: string | null;
  answer: LiveAnswerDraft;
  status: SubmissionStatus;
  ack: AnswerAckStatus | null;
}

export interface LiveLeaderboard {
  top: Standing[];
  total: number;
  my?: { rank: number | null; score: number; behind_by: number | null };
}

export interface LivePodium {
  top: Standing[];
  stats: PodiumStats;
  my?: { rank: number | null; score: number };
}

export interface LiveErrorEvent {
  code: LiveErrorCode;
  refMid: string | null;
  detail: string | null;
  sts: number;
}

/** Last moderation removal seen on this connection (host toast). `sts` makes repeats distinct. */
export interface LiveRemovedItem {
  qi: number;
  current: boolean;
  sts: number;
}

export interface LiveMe {
  participant_id: string;
  display_name: string;
  avatar_seed: string;
}

export interface LiveState {
  hydrated: boolean;
  role: LiveRole | null;
  me: LiveMe | null;
  heartbeatMs: number | null;
  seq: number;
  connection: LiveConnectionState;

  sessionId: string | null;
  title: string;
  themeKey: LiveThemeKey;
  joinCode: string;
  joinUrl: string;
  status: LiveSessionStatus;
  phase: LivePhase;
  qi: number | null;
  total: number;
  settings: SnapshotSettings | null;
  roomLocked: boolean;
  participantCount: number;
  /** Room limit from the snapshot (RF-1205); null on older servers. */
  maxParticipants: number | null;
  /** Rehearsal session (RF-513/RF-514). */
  rehearsal: boolean;

  question: PublicQuestion | null;
  /** Room timer of the current item, including the host pause. */
  timer: LiveTimer | null;
  answered: number | null;
  answerTotal: number | null;
  counts: OptionCounts | null;
  /** Live word cloud of the current question (host and projector; Incremento 5). */
  wordCloud: WordCloudResults | null;
  /** Live numeric histogram of the current question (host; projector with live distribution). */
  numeric: NumericResults | null;
  lockReason: "timer" | "all_answered" | "host" | null;
  reveal: Reveal | null;
  leaderboard: LiveLeaderboard | null;
  podium: LivePodium | null;
  lobby: LobbyState | null;

  /** Host only. `presenterQi` = the qi the presenter item belongs to (it only arrives in snapshots). */
  presenter: { item: LiveItem; next_prompt: string | null } | null;
  presenterQi: number | null;
  /** Host only: normalized keys hidden on the current word cloud (null = not known yet). */
  hiddenWords: string[] | null;
  participants: HostParticipant[] | null;

  /** Participant only. */
  my: MySnapshot | null;
  /** Participant only: extended time granted by the host (RF-622). 0 = no timer. */
  myTimeMultiplier: TimeMultiplier;
  submission: LiveSubmission | null;
  /** Rank before the latest reveal/leaderboard (drives ▲▼ on the phone). */
  previousRank: number | null;

  ended: { report_available: boolean } | null;
  kicked: { banned: boolean } | null;
  lastError: LiveErrorEvent | null;
  removedItem: LiveRemovedItem | null;
}

export type LiveAction =
  | { type: "server"; message: ServerMessage }
  | {
      type: "connection";
      status: LiveSocketStatus;
      attempt: number;
      reason?: LiveCloseReason | null;
      closeCode?: number | null;
      retryInMs?: number | null;
      transport?: LiveTransport;
    }
  | { type: "local.submit"; qi: number; answerId: string | null; answer: LiveAnswerDraft }
  | { type: "local.kick"; participantId: string }
  | { type: "local.clearError" }
  | { type: "reset" };

const MAX_LOBBY_RECENT = 60;

export function createInitialLiveState(role: LiveRole | null = null): LiveState {
  return {
    hydrated: false,
    role,
    me: null,
    heartbeatMs: null,
    seq: 0,
    connection: { status: "idle", attempt: 0, reason: null, closeCode: null, retryInMs: null, transport: "ws" },
    sessionId: null,
    title: "",
    themeKey: "sentinel",
    joinCode: "",
    joinUrl: "",
    status: "lobby",
    phase: "lobby",
    qi: null,
    total: 0,
    settings: null,
    roomLocked: false,
    participantCount: 0,
    maxParticipants: null,
    rehearsal: false,
    question: null,
    timer: null,
    answered: null,
    answerTotal: null,
    counts: null,
    wordCloud: null,
    numeric: null,
    lockReason: null,
    reveal: null,
    leaderboard: null,
    podium: null,
    lobby: null,
    presenter: null,
    presenterQi: null,
    hiddenWords: null,
    participants: null,
    my: null,
    myTimeMultiplier: 1,
    submission: null,
    previousRank: null,
    ended: null,
    kicked: null,
    lastError: null,
    removedItem: null
  };
}

/** The neutral slide that replaces a removed item (mirrors the server placeholder). */
export function removedPlaceholder(question: PublicQuestion): PublicQuestion {
  return {
    ...question,
    item_type: "content",
    prompt: "",
    options: [],
    allow_multiple: false,
    body: null,
    time_limit_s: null,
    points_multiplier: 0,
    scored: false,
    select_count: null,
    numeric: null,
    max_words: null,
    removed: true
  };
}

function mergeLobbyRecent(previous: LobbyPerson[], incoming: LobbyPerson[]): LobbyPerson[] {
  const seen = new Set<string>();
  const merged: LobbyPerson[] = [];
  // Newest first; the server sends the most recent joiners.
  for (const person of [...incoming, ...previous]) {
    if (!seen.has(person.participant_id)) {
      seen.add(person.participant_id);
      merged.push(person);
    }
  }
  return merged.slice(0, MAX_LOBBY_RECENT);
}

/** `my.last_answer` → the local draft shape (ordering `order` travels as `choice`). */
export function answerFromLast(last: NonNullable<MySnapshot["last_answer"]>): LiveAnswerDraft {
  const answer: LiveAnswerDraft = {};
  if (last.order) {
    answer.choice = last.order;
  } else if (last.choice) {
    answer.choice = last.choice;
  }
  if (typeof last.text === "string") {
    answer.text = last.text;
  }
  if (typeof last.number === "number") {
    answer.number = last.number;
  }
  if (last.words) {
    answer.words = last.words;
  }
  return answer;
}

function submissionFromSnapshot(snapshot: Snapshot, previous: LiveSubmission | null): LiveSubmission | null {
  const my = snapshot.my;
  if (snapshot.qi === null || !my) {
    return null;
  }
  if (my.answered_current) {
    const answer: LiveAnswerDraft = my.last_answer
      ? answerFromLast(my.last_answer)
      : previous?.qi === snapshot.qi
        ? previous.answer
        : {};
    return { qi: snapshot.qi, answerId: previous?.qi === snapshot.qi ? previous.answerId : null, answer, status: "accepted", ack: "accepted" };
  }
  // Not recorded yet: keep a pending local submission for the same question (the outbox re-sends it).
  if (previous && previous.qi === snapshot.qi && previous.status === "sending") {
    return previous;
  }
  return null;
}

function applySnapshot(state: LiveState, snapshot: Snapshot, seq: number | undefined): LiveState {
  const me = snapshot.my
    ? { participant_id: snapshot.my.participant_id, display_name: snapshot.my.display_name, avatar_seed: snapshot.my.avatar_seed }
    : state.me;
  return {
    ...state,
    hydrated: true,
    me,
    seq: typeof seq === "number" ? seq : state.seq,
    sessionId: snapshot.session_id,
    title: snapshot.title,
    themeKey: snapshot.theme_key,
    joinCode: snapshot.join_code,
    joinUrl: snapshot.join_url,
    status: snapshot.status,
    phase: snapshot.phase,
    qi: snapshot.qi,
    total: snapshot.total,
    settings: snapshot.settings,
    roomLocked: snapshot.room_locked,
    participantCount: snapshot.participant_count,
    maxParticipants: typeof snapshot.max_participants === "number" ? snapshot.max_participants : state.maxParticipants,
    rehearsal: typeof snapshot.rehearsal === "boolean" ? snapshot.rehearsal : state.rehearsal,
    question: snapshot.question ?? null,
    timer: snapshot.timer ?? null,
    answered: snapshot.answered ?? null,
    answerTotal: typeof snapshot.answered === "number" ? snapshot.participant_count : null,
    counts: snapshot.counts ?? snapshot.reveal?.counts ?? null,
    wordCloud: snapshot.word_cloud ?? snapshot.reveal?.word_cloud ?? null,
    numeric: snapshot.numeric ?? snapshot.reveal?.numeric ?? null,
    lockReason: null,
    reveal: snapshot.reveal ?? null,
    leaderboard: snapshot.leaderboard ?? null,
    podium: snapshot.podium ?? null,
    lobby: snapshot.lobby ?? null,
    presenter: snapshot.presenter ?? null,
    presenterQi: snapshot.presenter ? snapshot.qi : null,
    hiddenWords: snapshot.presenter?.hidden_words ?? null,
    participants: snapshot.participants ?? null,
    my: snapshot.my ?? null,
    myTimeMultiplier: snapshot.my ? normalizeTimeMultiplier(snapshot.my.time_multiplier) : state.myTimeMultiplier,
    submission: submissionFromSnapshot(snapshot, state.submission),
    previousRank: snapshot.my?.rank ?? state.previousRank,
    ended: snapshot.status === "finished" ? (state.ended ?? { report_available: true }) : null
  };
}

function isStale(state: LiveState, seq: number | undefined): boolean {
  return typeof seq === "number" && state.hydrated && seq <= state.seq;
}

function withSeq(state: LiveState, seq: number | undefined): number {
  return typeof seq === "number" ? Math.max(state.seq, seq) : state.seq;
}

function sameQi(state: LiveState, qi: number): boolean {
  return state.qi === qi;
}

function reduceServer(state: LiveState, message: ServerMessage): LiveState {
  if (message.type !== "room.snapshot" && isStale(state, message.seq)) {
    return state;
  }
  const seq = withSeq(state, message.seq);

  switch (message.type) {
    case "welcome": {
      const { role, session_id: sessionId, me, hb_ms: heartbeatMs } = message.data;
      if (!me) {
        return { ...state, role, sessionId, heartbeatMs };
      }
      return {
        ...state,
        role,
        sessionId,
        heartbeatMs,
        me: { participant_id: me.participant_id, display_name: me.display_name, avatar_seed: me.avatar_seed },
        myTimeMultiplier: normalizeTimeMultiplier(me.time_multiplier)
      };
    }
    case "room.snapshot":
      return applySnapshot(state, message.data, message.seq);

    case "lobby.update": {
      const { count, recent } = message.data;
      const lobby: LobbyState = { count, recent: mergeLobbyRecent(state.lobby?.recent ?? [], recent) };
      let participants = state.participants;
      if (participants) {
        const known = new Set(participants.map((person) => person.participant_id));
        const added = recent
          .filter((person) => !known.has(person.participant_id))
          .map<HostParticipant>((person) => ({ ...person, score: 0, connected: true, time_multiplier: 1, is_bot: false, is_preview: false }));
        participants = added.length ? [...participants, ...added] : participants;
      }
      return { ...state, seq, lobby, participantCount: count, participants };
    }

    case "question.intro": {
      const { qi, total, question, answers_open_at_ms: openAt, deadline_ms: deadline } = message.data;
      return {
        ...state,
        seq,
        status: "live",
        phase: question.item_type === "content" ? "content" : "question",
        qi,
        total,
        question,
        timer: { answers_open_at_ms: openAt, deadline_ms: deadline },
        answered: 0,
        answerTotal: state.participantCount || null,
        counts: null,
        wordCloud: null,
        numeric: null,
        hiddenWords: state.role === "host" ? [] : null,
        lockReason: null,
        reveal: null,
        leaderboard: null,
        submission: null,
        my: state.my ? { ...state.my, answered_current: false, last_answer: null } : null
      };
    }

    case "answer.ack": {
      const submission = state.submission;
      if (!submission || !sameQi(state, message.data.qi) || submission.qi !== message.data.qi) {
        return state;
      }
      if (submission.answerId && submission.answerId !== message.data.answer_id) {
        return state;
      }
      // "paused" is a rejection too: nothing was recorded, the pad reopens when the host resumes.
      const ack = message.data.status;
      const accepted = ack === "accepted" || ack === "duplicate" || ack === "already_answered";
      return {
        ...state,
        seq,
        submission: { ...submission, status: accepted ? "accepted" : "rejected", ack },
        my: accepted && state.my ? { ...state.my, answered_current: true } : state.my
      };
    }

    case "results.tick":
    case "participant.progress": {
      if (!sameQi(state, message.data.qi)) {
        return state;
      }
      if (message.type === "participant.progress") {
        return { ...state, seq, answered: message.data.answered, answerTotal: message.data.total };
      }
      const data = message.data;
      return {
        ...state,
        seq,
        answered: data.answered,
        answerTotal: data.total,
        counts: data.counts ?? state.counts,
        wordCloud: data.word_cloud ?? state.wordCloud,
        numeric: data.numeric ?? state.numeric
      };
    }

    case "question.paused":
    case "question.timer": {
      if (!sameQi(state, message.data.qi) || state.phase !== "question") {
        return state;
      }
      const data = message.data;
      const timer: LiveTimer = { answers_open_at_ms: data.answers_open_at_ms, deadline_ms: data.deadline_ms, paused: data.paused };
      if (data.paused) {
        timer.paused_at_ms = data.paused_at_ms;
        timer.remaining_ms = data.remaining_ms;
      }
      return { ...state, seq, timer };
    }

    case "participant.time":
      return { ...state, myTimeMultiplier: normalizeTimeMultiplier(message.data.time_multiplier) };

    case "participant.updated": {
      if (!state.participants) {
        return state;
      }
      const { participant_id: participantId, time_multiplier: multiplier } = message.data;
      if (!state.participants.some((person) => person.participant_id === participantId)) {
        return state;
      }
      return {
        ...state,
        participants: state.participants.map((person) =>
          person.participant_id === participantId ? { ...person, time_multiplier: normalizeTimeMultiplier(multiplier) } : person
        )
      };
    }

    case "question.locked": {
      if (!sameQi(state, message.data.qi)) {
        return state;
      }
      return { ...state, seq, phase: "locked", lockReason: message.data.reason };
    }

    case "question.reveal": {
      const reveal = message.data;
      if (state.qi !== null && reveal.qi !== state.qi) {
        return state;
      }
      const my = reveal.my;
      return {
        ...state,
        seq,
        phase: "reveal",
        qi: reveal.qi,
        reveal,
        counts: reveal.counts,
        wordCloud: reveal.word_cloud ?? state.wordCloud,
        numeric: reveal.numeric ?? state.numeric,
        answered: reveal.answered,
        answerTotal: reveal.total,
        previousRank: state.my?.rank ?? state.previousRank,
        my: state.my && my ? { ...state.my, score: my.total_score, rank: my.rank } : state.my
      };
    }

    case "leaderboard.show": {
      const leaderboard: LiveLeaderboard = message.data;
      const my = leaderboard.my;
      const participants = state.participants
        ? state.participants.map((person) => {
            const standing = leaderboard.top.find((entry) => entry.participant_id === person.participant_id);
            return standing ? { ...person, score: standing.score } : person;
          })
        : null;
      return {
        ...state,
        seq,
        phase: "leaderboard",
        leaderboard,
        participants,
        previousRank: state.my?.rank ?? state.previousRank,
        my: state.my && my ? { ...state.my, score: my.score, rank: my.rank } : state.my
      };
    }

    case "podium.show": {
      const podium: LivePodium = message.data;
      const my = podium.my;
      return {
        ...state,
        seq,
        phase: "podium",
        podium,
        my: state.my && my ? { ...state.my, score: my.score, rank: my.rank } : state.my
      };
    }

    case "session.ended":
      return { ...state, seq, phase: "finished", status: "finished", ended: message.data };

    case "room.locked":
      return { ...state, seq, roomLocked: message.data.locked };

    case "participant.kicked":
      return { ...state, seq, kicked: message.data };

    case "word_cloud.update": {
      const { qi, word_cloud: wordCloud, hidden_words: hidden } = message.data;
      if (!sameQi(state, qi)) {
        return state;
      }
      const reveal = state.reveal && state.reveal.qi === qi ? { ...state.reveal, word_cloud: wordCloud } : state.reveal;
      return { ...state, seq, wordCloud, reveal, hiddenWords: hidden ?? state.hiddenWords };
    }

    case "item.removed": {
      const { qi, current } = message.data;
      const removedItem: LiveRemovedItem = { qi, current, sts: message.sts };
      if (!sameQi(state, qi) || !state.question) {
        // Another item (not on screen yet): the follow-up snapshot carries the placeholder.
        return { ...state, seq, removedItem };
      }
      return {
        ...state,
        seq,
        removedItem,
        phase: state.status === "finished" ? state.phase : "content",
        question: removedPlaceholder(state.question),
        timer: null,
        answered: null,
        answerTotal: null,
        counts: null,
        wordCloud: null,
        numeric: null,
        hiddenWords: null,
        lockReason: null,
        reveal: null,
        submission: null,
        // The presenter item (answer key, notes) of a removed item must not stay on screen.
        presenter: state.presenterQi === qi ? null : state.presenter,
        presenterQi: state.presenterQi === qi ? null : state.presenterQi,
        my: state.my ? { ...state.my, answered_current: false, last_answer: null } : null
      };
    }

    case "error":
      return {
        ...state,
        lastError: { code: message.data.code, refMid: message.data.ref_mid ?? null, detail: message.data.detail ?? null, sts: message.sts }
      };

    case "srv.ping":
    case "time.sync.reply":
      return state;

    default:
      return state;
  }
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case "server":
      return reduceServer(state, action.message);
    case "connection": {
      const connection: LiveConnectionState = {
        status: action.status,
        attempt: action.attempt,
        reason: action.reason ?? null,
        closeCode: action.closeCode ?? null,
        retryInMs: action.retryInMs ?? null,
        transport: action.transport ?? state.connection.transport
      };
      const current = state.connection;
      if (
        current.transport === connection.transport &&
        current.status === connection.status &&
        current.attempt === connection.attempt &&
        current.reason === connection.reason &&
        current.closeCode === connection.closeCode &&
        current.retryInMs === connection.retryInMs
      ) {
        return state;
      }
      return { ...state, connection };
    }
    case "local.submit":
      if (state.qi !== action.qi) {
        return state;
      }
      return {
        ...state,
        submission: { qi: action.qi, answerId: action.answerId, answer: action.answer, status: "sending", ack: null }
      };
    case "local.kick":
      return state.participants
        ? { ...state, participants: state.participants.filter((person) => person.participant_id !== action.participantId) }
        : state;
    case "local.clearError":
      return state.lastError ? { ...state, lastError: null } : state;
    case "reset":
      return createInitialLiveState(state.role);
    default:
      return state;
  }
}

// ----------------------------------------------------------------------------- derived selectors

/** Whether the answers window is open for input on the participant device. */
export function selectCanAnswer(state: LiveState, serverNow: number): boolean {
  if (state.phase !== "question" || !state.question || !state.timer) {
    return false;
  }
  if (state.submission && state.submission.status !== "rejected") {
    return false;
  }
  if (state.timer.paused) {
    return false;
  }
  return serverNow >= state.timer.answers_open_at_ms;
}

let myTimerCache: { timer: LiveTimer | null; multiplier: number; value: LiveTimer | null } | null = null;

/**
 * The participant's own timer: the room timer stretched by the extended-time multiplier (RF-622),
 * or without a deadline for `0`. Referentially stable while its inputs do not change.
 */
export function selectMyTimer(state: Pick<LiveState, "timer" | "myTimeMultiplier">): LiveTimer | null {
  const cached = myTimerCache;
  if (cached && cached.timer === state.timer && cached.multiplier === state.myTimeMultiplier) {
    return cached.value;
  }
  const value = personalTimer(state.timer, state.myTimeMultiplier);
  myTimerCache = { timer: state.timer, multiplier: state.myTimeMultiplier, value };
  return value;
}

/**
 * Public stage data only. The stage (projector) must never receive presenter data (correct answers,
 * notes, participant admin), even for the host session: mirrored projectors show everything.
 */
export interface StageView {
  hydrated: boolean;
  title: string;
  themeKey: LiveThemeKey;
  joinCode: string;
  joinUrl: string;
  status: LiveSessionStatus;
  phase: LivePhase;
  qi: number | null;
  total: number;
  roomLocked: boolean;
  participantCount: number;
  question: PublicQuestion | null;
  timer: LiveState["timer"];
  /** The host paused the open question (frozen countdown on the projector). */
  paused: boolean;
  answered: number | null;
  answerTotal: number | null;
  /** Live distribution only when the quiz shows it (or for polls); never before reveal otherwise. */
  liveCounts: OptionCounts | null;
  /** Word cloud: always public, like a poll (Incremento 5 §5). */
  wordCloud: WordCloudResults | null;
  /** Numeric histogram: only with the live distribution on (never the correct value). */
  liveNumeric: NumericResults | null;
  lockReason: LiveState["lockReason"];
  reveal: Reveal | null;
  leaderboard: { top: Standing[]; total: number } | null;
  podium: { top: Standing[]; stats: PodiumStats } | null;
  lobby: LobbyState | null;
  readingPhaseS: number;
  showExplanation: boolean;
}

export function selectStageView(state: LiveState): StageView {
  const showLive = Boolean(state.settings?.show_live_distribution) || state.question?.item_type === "poll";
  const reveal = state.reveal ? { ...state.reveal, my: undefined } : null;
  return {
    hydrated: state.hydrated,
    title: state.title,
    themeKey: state.themeKey,
    joinCode: state.joinCode,
    joinUrl: state.joinUrl,
    status: state.status,
    phase: state.phase,
    qi: state.qi,
    total: state.total,
    roomLocked: state.roomLocked,
    participantCount: state.participantCount,
    question: state.question,
    timer: state.timer,
    paused: state.phase === "question" && Boolean(state.timer?.paused),
    answered: state.answered,
    answerTotal: state.answerTotal,
    liveCounts: showLive ? state.counts : null,
    wordCloud: state.question?.item_type === "word_cloud" ? state.wordCloud : null,
    liveNumeric: state.settings?.show_live_distribution && state.question?.item_type === "numeric" ? state.numeric : null,
    lockReason: state.lockReason,
    reveal,
    leaderboard: state.leaderboard ? { top: state.leaderboard.top, total: state.leaderboard.total } : null,
    podium: state.podium ? { top: state.podium.top, stats: state.podium.stats } : null,
    lobby: state.lobby,
    readingPhaseS: state.settings?.reading_phase_s ?? 0,
    showExplanation: state.settings?.show_explanation ?? true
  };
}

// ----------------------------------------------------------------------------- external store

type Listener = () => void;

export class LiveStore {
  private state: LiveState;
  private readonly listeners = new Set<Listener>();

  constructor(initial: LiveState = createInitialLiveState()) {
    this.state = initial;
  }

  getState = (): LiveState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch = (action: LiveAction): void => {
    const next = liveReducer(this.state, action);
    if (next === this.state) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  };
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
  );
}

/**
 * Subscribes to a slice of the store. The selection is memoized across renders and compared with
 * `isEqual` (shallow by default), so returning a fresh object with the same fields does not
 * re-render.
 */
export function useLiveSelector<T>(
  store: LiveStore,
  selector: (state: LiveState) => T,
  isEqual: (a: T, b: T) => boolean = shallowEqual
): T {
  const memoRef = useRef<{ state: LiveState; selector: (state: LiveState) => T; value: T } | null>(null);

  const getSelection = useCallback((): T => {
    const state = store.getState();
    const memo = memoRef.current;
    if (memo && memo.state === state && memo.selector === selector) {
      return memo.value;
    }
    const next = selector(state);
    if (memo && isEqual(memo.value, next)) {
      memoRef.current = { state, selector, value: memo.value };
      return memo.value;
    }
    memoRef.current = { state, selector, value: next };
    return next;
  }, [store, selector, isEqual]);

  return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}
