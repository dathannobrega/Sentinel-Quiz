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
 */
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { LiveCloseReason, LiveSocketStatus } from "@/features/quiz-live/lib/live-socket";
import type {
  AnswerAckStatus,
  HostParticipant,
  LiveErrorCode,
  LiveRole,
  LobbyPerson,
  LobbyState,
  MySnapshot,
  OptionCounts,
  PodiumStats,
  PublicQuestion,
  Reveal,
  ServerMessage,
  Snapshot,
  SnapshotSettings,
  Standing
} from "@/features/quiz-live/lib/protocol";
import type { LiveItem, LivePhase, LiveSessionStatus, LiveThemeKey } from "@/types/api/live";

export interface LiveConnectionState {
  status: LiveSocketStatus;
  attempt: number;
  reason: LiveCloseReason | null;
  closeCode: number | null;
  retryInMs: number | null;
}

export interface LiveAnswerDraft {
  choice?: string[];
  text?: string;
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

  question: PublicQuestion | null;
  timer: { answers_open_at_ms: number; deadline_ms: number | null } | null;
  answered: number | null;
  answerTotal: number | null;
  counts: OptionCounts | null;
  lockReason: "timer" | "all_answered" | "host" | null;
  reveal: Reveal | null;
  leaderboard: LiveLeaderboard | null;
  podium: LivePodium | null;
  lobby: LobbyState | null;

  /** Host only. `presenterQi` = the qi the presenter item belongs to (it only arrives in snapshots). */
  presenter: { item: LiveItem; next_prompt: string | null } | null;
  presenterQi: number | null;
  participants: HostParticipant[] | null;

  /** Participant only. */
  my: MySnapshot | null;
  submission: LiveSubmission | null;
  /** Rank before the latest reveal/leaderboard (drives ▲▼ on the phone). */
  previousRank: number | null;

  ended: { report_available: boolean } | null;
  kicked: { banned: boolean } | null;
  lastError: LiveErrorEvent | null;
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
    connection: { status: "idle", attempt: 0, reason: null, closeCode: null, retryInMs: null },
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
    question: null,
    timer: null,
    answered: null,
    answerTotal: null,
    counts: null,
    lockReason: null,
    reveal: null,
    leaderboard: null,
    podium: null,
    lobby: null,
    presenter: null,
    presenterQi: null,
    participants: null,
    my: null,
    submission: null,
    previousRank: null,
    ended: null,
    kicked: null,
    lastError: null
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

function submissionFromSnapshot(snapshot: Snapshot, previous: LiveSubmission | null): LiveSubmission | null {
  const my = snapshot.my;
  if (snapshot.qi === null || !my) {
    return null;
  }
  if (my.answered_current) {
    const answer: LiveAnswerDraft = my.last_answer
      ? { choice: my.last_answer.choice, text: my.last_answer.text }
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
    question: snapshot.question ?? null,
    timer: snapshot.timer ?? null,
    answered: snapshot.answered ?? null,
    answerTotal: typeof snapshot.answered === "number" ? snapshot.participant_count : null,
    counts: snapshot.counts ?? snapshot.reveal?.counts ?? null,
    lockReason: null,
    reveal: snapshot.reveal ?? null,
    leaderboard: snapshot.leaderboard ?? null,
    podium: snapshot.podium ?? null,
    lobby: snapshot.lobby ?? null,
    presenter: snapshot.presenter ?? null,
    presenterQi: snapshot.presenter ? snapshot.qi : null,
    participants: snapshot.participants ?? null,
    my: snapshot.my ?? null,
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
      return { ...state, role, sessionId, me: me ?? state.me, heartbeatMs };
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
          .map<HostParticipant>((person) => ({ ...person, score: 0, connected: true }));
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
      const counts = message.type === "results.tick" && message.data.counts ? message.data.counts : state.counts;
      return { ...state, seq, answered: message.data.answered, answerTotal: message.data.total, counts };
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
        retryInMs: action.retryInMs ?? null
      };
      const current = state.connection;
      if (
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
  return serverNow >= state.timer.answers_open_at_ms;
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
  answered: number | null;
  answerTotal: number | null;
  /** Live distribution only when the quiz shows it (or for polls); never before reveal otherwise. */
  liveCounts: OptionCounts | null;
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
    answered: state.answered,
    answerTotal: state.answerTotal,
    liveCounts: showLive ? state.counts : null,
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
