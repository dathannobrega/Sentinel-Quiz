import { describe, expect, it, vi } from "vitest";

import {
  createInitialLiveState,
  liveReducer,
  LiveStore,
  selectCanAnswer,
  selectMyTimer,
  selectStageView,
  shallowEqual,
  type LiveState
} from "@/features/quiz-live/lib/live-store";
import type { PublicQuestion, Reveal, ServerMessage, Snapshot, Standing } from "@/features/quiz-live/lib/protocol";
import type { LiveItem } from "@/types/api/live";

let sts = 1_000;

function frame<T extends ServerMessage["type"]>(
  type: T,
  data: Extract<ServerMessage, { type: T }>["data"],
  seq?: number
): ServerMessage {
  sts += 10;
  return { v: 1, type, sts, data, ...(seq === undefined ? {} : { seq }) } as ServerMessage;
}

function apply(state: LiveState, ...messages: ServerMessage[]): LiveState {
  return messages.reduce((current, message) => liveReducer(current, { type: "server", message }), state);
}

const question: PublicQuestion = {
  qi: 0,
  item_type: "single_choice",
  prompt: "Qual porta usa o HTTPS?",
  options: [
    { id: "A", text: "80", index: 0 },
    { id: "B", text: "443", index: 1 }
  ],
  allow_multiple: false,
  body: null,
  time_limit_s: 20,
  points_multiplier: 1,
  scored: true,
  select_count: null
};

const presenterItem = {
  id: "item-1",
  position: 0,
  item_type: "single_choice",
  prompt: question.prompt,
  options: [
    { key: "A", text: "80", correct: false },
    { key: "B", text: "443", correct: true }
  ],
  presenter_notes: "Lembre do TLS"
} as unknown as LiveItem;

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    session_id: "s1",
    title: "Quiz de redes",
    theme_key: "sentinel",
    join_code: "482913",
    join_url: "https://x.test/j/482913",
    status: "lobby",
    phase: "lobby",
    qi: null,
    total: 5,
    settings: {
      scoring: "speed",
      show_live_distribution: false,
      show_correct_on_device: true,
      show_explanation: true,
      music: false,
      reading_phase_s: 3
    },
    room_locked: false,
    participant_count: 2,
    ...overrides
  };
}

const standings: Standing[] = [
  { rank: 1, participant_id: "p2", display_name: "Bia", avatar_seed: "b", score: 1800, correct: 2, delta: 1 },
  { rank: 2, participant_id: "p1", display_name: "Ana", avatar_seed: "a", score: 900, correct: 1, delta: -1 }
];

const reveal: Reveal = {
  qi: 0,
  item_type: "single_choice",
  correct_option_ids: ["B"],
  accepted_answers: [],
  counts: { A: 1, B: 3 },
  answered: 4,
  total: 5,
  pct_correct: 75,
  avg_ms: 4200,
  fastest: { display_name: "Bia", ms: 1200 },
  explanation: "HTTPS usa 443.",
  my: { answered: true, correct: true, fraction: 1, points: 870, total_score: 870, rank: 2, rank_delta: 1, streak: 1 }
};

const mySnap = { participant_id: "p1", display_name: "Ana", avatar_seed: "a", answered_current: false, score: 0, rank: null };

describe("liveReducer: welcome and snapshot", () => {
  it("stores role, heartbeat and identity from welcome", () => {
    const state = apply(
      createInitialLiveState(),
      frame("welcome", { role: "participant", session_id: "s1", hb_ms: 5000, proto: 1, me: { participant_id: "p1", display_name: "Ana", avatar_seed: "a" } })
    );
    expect(state.role).toBe("participant");
    expect(state.heartbeatMs).toBe(5000);
    expect(state.me?.display_name).toBe("Ana");
    expect(state.hydrated).toBe(false);
  });

  it("replaces the room state with a snapshot", () => {
    const state = apply(createInitialLiveState(), frame("room.snapshot", snapshot({ lobby: { count: 2, recent: [] } }), 3));
    expect(state.hydrated).toBe(true);
    expect(state.seq).toBe(3);
    expect(state.joinCode).toBe("482913");
    expect(state.phase).toBe("lobby");
    expect(state.settings?.reading_phase_s).toBe(3);
  });

  it("drops local fields absent from a newer snapshot (reconnect replaces, never merges)", () => {
    let state = apply(
      createInitialLiveState(),
      frame("room.snapshot", snapshot(), 1),
      frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 5000, deadline_ms: 25_000 }, 2),
      frame("question.reveal", reveal, 3)
    );
    expect(state.reveal).not.toBeNull();
    // Reconnect: server went on to the leaderboard meanwhile.
    state = apply(state, frame("room.snapshot", snapshot({ status: "live", phase: "leaderboard", qi: 0, leaderboard: { top: standings, total: 5 } }), 10));
    expect(state.phase).toBe("leaderboard");
    expect(state.reveal).toBeNull();
    expect(state.question).toBeNull();
    expect(state.leaderboard?.top).toHaveLength(2);
    expect(state.seq).toBe(10);
  });

  it("accepts a snapshot even with a lower seq (server restart)", () => {
    let state = apply(createInitialLiveState(), frame("room.snapshot", snapshot(), 50));
    state = apply(state, frame("room.snapshot", snapshot({ phase: "podium", status: "live" }), 2));
    expect(state.phase).toBe("podium");
    expect(state.seq).toBe(2);
  });

  it("restores an accepted answer from the snapshot after reconnecting", () => {
    const state = apply(
      createInitialLiveState(),
      frame(
        "room.snapshot",
        snapshot({
          status: "live",
          phase: "question",
          qi: 0,
          question,
          timer: { answers_open_at_ms: 0, deadline_ms: 10 },
          my: { ...mySnap, answered_current: true, last_answer: { choice: ["B"] } }
        })
      )
    );
    expect(state.submission).toMatchObject({ qi: 0, status: "accepted", answer: { choice: ["B"] } });
  });

  it("keeps a pending local submission for the same question across a snapshot", () => {
    let state = apply(createInitialLiveState(), frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question, my: mySnap })));
    state = liveReducer(state, { type: "local.submit", qi: 0, answerId: "ans-1", answer: { choice: ["A"] } });
    state = apply(state, frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question, my: mySnap })));
    expect(state.submission).toMatchObject({ answerId: "ans-1", status: "sending" });
    state = apply(state, frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 1, question: { ...question, qi: 1 }, my: mySnap })));
    expect(state.submission).toBeNull();
  });

  it("marks a finished session from the snapshot", () => {
    const state = apply(createInitialLiveState(), frame("room.snapshot", snapshot({ status: "finished", phase: "finished" })));
    expect(state.ended).toEqual({ report_available: true });
  });
});

describe("liveReducer: incremental events", () => {
  const base = () => apply(createInitialLiveState(), frame("room.snapshot", snapshot({ my: mySnap, participants: [] }), 1));

  it("lobby.update merges newest joiners and updates the count", () => {
    let state = apply(base(), frame("lobby.update", { count: 3, recent: [{ participant_id: "p3", display_name: "Caio", avatar_seed: "c" }] }, 2));
    state = apply(state, frame("lobby.update", { count: 4, recent: [{ participant_id: "p4", display_name: "Duda", avatar_seed: "d" }, { participant_id: "p3", display_name: "Caio", avatar_seed: "c" }] }, 3));
    expect(state.participantCount).toBe(4);
    expect(state.lobby?.recent.map((person) => person.participant_id)).toEqual(["p4", "p3"]);
    expect(state.participants?.map((person) => person.participant_id)).toEqual(["p3", "p4"]);
  });

  it("question.intro opens a question and clears the previous round", () => {
    let state = liveReducer(base(), { type: "local.submit", qi: 0, answerId: null, answer: {} });
    state = apply(state, frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 5000, deadline_ms: 25_000 }, 2));
    expect(state).toMatchObject({ phase: "question", status: "live", qi: 0, answered: 0, reveal: null, submission: null });
    expect(state.timer).toEqual({ answers_open_at_ms: 5000, deadline_ms: 25_000 });
    const content = apply(state, frame("question.intro", { qi: 1, total: 5, question: { ...question, qi: 1, item_type: "content" }, answers_open_at_ms: 0, deadline_ms: null }, 3));
    expect(content.phase).toBe("content");
  });

  it("answer.ack settles the local submission", () => {
    let state = apply(base(), frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 0, deadline_ms: null }, 2));
    state = liveReducer(state, { type: "local.submit", qi: 0, answerId: "ans-1", answer: { choice: ["B"] } });
    expect(state.submission?.status).toBe("sending");
    const other = apply(state, frame("answer.ack", { answer_id: "zzz", qi: 0, status: "accepted" }));
    expect(other.submission?.status).toBe("sending");
    const accepted = apply(state, frame("answer.ack", { answer_id: "ans-1", qi: 0, status: "duplicate" }));
    expect(accepted.submission).toMatchObject({ status: "accepted", ack: "duplicate" });
    expect(accepted.my?.answered_current).toBe(true);
    const late = apply(state, frame("answer.ack", { answer_id: "ans-1", qi: 0, status: "late" }));
    expect(late.submission).toMatchObject({ status: "rejected", ack: "late" });
  });

  it("local.submit is ignored for another question", () => {
    const state = apply(base(), frame("question.intro", { qi: 1, total: 5, question, answers_open_at_ms: 0, deadline_ms: null }, 2));
    expect(liveReducer(state, { type: "local.submit", qi: 0, answerId: null, answer: {} })).toBe(state);
  });

  it("results.tick and participant.progress update counters only for the current qi", () => {
    let state = apply(base(), frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 0, deadline_ms: null }, 2));
    state = apply(state, frame("results.tick", { qi: 0, answered: 3, total: 5, counts: { A: 1, B: 2 } }));
    expect(state).toMatchObject({ answered: 3, answerTotal: 5, counts: { A: 1, B: 2 } });
    state = apply(state, frame("participant.progress", { qi: 0, answered: 4, total: 5 }));
    expect(state).toMatchObject({ answered: 4, counts: { A: 1, B: 2 } });
    const stale = apply(state, frame("results.tick", { qi: 7, answered: 99, total: 99 }));
    expect(stale).toBe(state);
  });

  it("question.locked, reveal, leaderboard, podium and ended move the phase", () => {
    let state = apply(base(), frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 0, deadline_ms: 1 }, 2));
    state = apply(state, frame("question.locked", { qi: 0, reason: "timer" }, 3));
    expect(state).toMatchObject({ phase: "locked", lockReason: "timer" });
    state = apply(state, frame("question.reveal", reveal, 4));
    expect(state).toMatchObject({ phase: "reveal", counts: { A: 1, B: 3 }, answered: 4 });
    expect(state.my).toMatchObject({ score: 870, rank: 2 });
    state = apply(state, frame("leaderboard.show", { top: standings, total: 5, my: { rank: 1, score: 1900, behind_by: null } }, 5));
    expect(state).toMatchObject({ phase: "leaderboard", previousRank: 2 });
    expect(state.my?.rank).toBe(1);
    state = apply(state, frame("podium.show", { top: standings, stats: { participants: 5, avg_pct: 62, hardest_qi: 0 }, my: { rank: 1, score: 1900 } }, 6));
    expect(state.phase).toBe("podium");
    state = apply(state, frame("session.ended", { report_available: true }, 7));
    expect(state).toMatchObject({ phase: "finished", status: "finished", ended: { report_available: true } });
  });

  it("ignores events for another qi", () => {
    const state = apply(base(), frame("question.intro", { qi: 2, total: 5, question: { ...question, qi: 2 }, answers_open_at_ms: 0, deadline_ms: 1 }, 2));
    expect(apply(state, frame("question.locked", { qi: 1, reason: "host" }))).toBe(state);
    expect(apply(state, frame("question.reveal", { ...reveal, qi: 1 }))).toBe(state);
  });

  it("room.locked, participant.kicked and error", () => {
    let state = apply(base(), frame("room.locked", { locked: true }, 2));
    expect(state.roomLocked).toBe(true);
    state = apply(state, frame("participant.kicked", { banned: true }));
    expect(state.kicked).toEqual({ banned: true });
    state = apply(state, frame("error", { code: "stale", ref_mid: "m1", detail: "qi" }));
    expect(state.lastError).toMatchObject({ code: "stale", refMid: "m1" });
    state = liveReducer(state, { type: "local.clearError" });
    expect(state.lastError).toBeNull();
  });

  it("srv.ping and time.sync.reply never change the state", () => {
    const state = base();
    expect(apply(state, frame("srv.ping", { ts: 1 }))).toBe(state);
    expect(apply(state, frame("time.sync.reply", { t0: 1, t1: 2, t2: 3 }))).toBe(state);
  });

  it("ignores frames with a seq already applied", () => {
    let state = apply(base(), frame("room.locked", { locked: true }, 5));
    const before = state;
    state = apply(state, frame("room.locked", { locked: false }, 5));
    expect(state).toBe(before);
    state = apply(state, frame("room.locked", { locked: false }, 4));
    expect(state).toBe(before);
  });

  it("local.kick removes the participant from the host list", () => {
    let state = apply(base(), frame("lobby.update", { count: 1, recent: [{ participant_id: "p3", display_name: "Caio", avatar_seed: "c" }] }, 2));
    state = liveReducer(state, { type: "local.kick", participantId: "p3" });
    expect(state.participants).toEqual([]);
  });

  it("connection updates are no-ops when unchanged", () => {
    const state = base();
    const next = liveReducer(state, { type: "connection", status: "open", attempt: 0 });
    expect(next.connection.status).toBe("open");
    expect(liveReducer(next, { type: "connection", status: "open", attempt: 0 })).toBe(next);
  });

  it("reset keeps the role", () => {
    const state = liveReducer({ ...base(), role: "host" }, { type: "reset" });
    expect(state.role).toBe("host");
    expect(state.hydrated).toBe(false);
  });
});

describe("presenter protection", () => {
  it("the stage view never exposes presenter data, participants or personal results", () => {
    const state = apply(
      createInitialLiveState("host"),
      frame(
        "room.snapshot",
        snapshot({
          status: "live",
          phase: "reveal",
          qi: 0,
          question,
          reveal,
          counts: { A: 1, B: 3 },
          presenter: { item: presenterItem, next_prompt: "Próxima" },
          participants: [{ participant_id: "p1", display_name: "Ana", avatar_seed: "a", score: 0, connected: true }]
        })
      )
    );
    expect(state.presenter).not.toBeNull();
    expect(state.presenterQi).toBe(0);
    const stage = selectStageView(state);
    const serialized = JSON.stringify(stage);
    expect(serialized).not.toContain("presenter");
    expect(serialized).not.toContain("Lembre do TLS");
    expect(serialized).not.toContain("participants");
    expect(stage.reveal?.my).toBeUndefined();
  });

  it("hides live counts on the stage unless the quiz shows the live distribution (or it is a poll)", () => {
    const open = apply(
      createInitialLiveState("host"),
      frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question, counts: { A: 1 } }))
    );
    expect(selectStageView(open).liveCounts).toBeNull();
    const poll = apply(open, frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question: { ...question, item_type: "poll" }, counts: { A: 1 } })));
    expect(selectStageView(poll).liveCounts).toEqual({ A: 1 });
  });
});

describe("selectCanAnswer", () => {
  it("waits for the reading phase and blocks after a submission", () => {
    let state = apply(
      createInitialLiveState("participant"),
      frame("room.snapshot", snapshot({ my: mySnap })),
      frame("question.intro", { qi: 0, total: 5, question, answers_open_at_ms: 5000, deadline_ms: 25_000 })
    );
    expect(selectCanAnswer(state, 4999)).toBe(false);
    expect(selectCanAnswer(state, 5000)).toBe(true);
    state = liveReducer(state, { type: "local.submit", qi: 0, answerId: "x", answer: { choice: ["A"] } });
    expect(selectCanAnswer(state, 6000)).toBe(false);
  });
});

describe("LiveStore", () => {
  it("notifies only when the state actually changes", () => {
    const store = new LiveStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.dispatch({ type: "server", message: frame("srv.ping", { ts: 1 }) });
    expect(listener).not.toHaveBeenCalled();
    store.dispatch({ type: "server", message: frame("room.snapshot", snapshot()) });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.dispatch({ type: "server", message: frame("room.locked", { locked: true }) });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("shallowEqual compares one level", () => {
    expect(shallowEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
  });
});

describe("liveReducer: time controls (Incremento 3)", () => {
  const open = () =>
    apply(
      createInitialLiveState("participant"),
      frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question, timer: { answers_open_at_ms: 5000, deadline_ms: 25_000, paused: false }, my: mySnap }), 1)
    );

  it("question.paused freezes the timer and blocks answers; question.timer resumes it", () => {
    let state = apply(open(), frame("question.paused", { qi: 0, answers_open_at_ms: 5000, deadline_ms: 25_000, paused: true, paused_at_ms: 12_000, remaining_ms: 13_000 }, 2));
    expect(state.timer).toMatchObject({ paused: true, paused_at_ms: 12_000, remaining_ms: 13_000 });
    expect(selectCanAnswer(state, 13_000)).toBe(false);
    expect(selectStageView(state).paused).toBe(true);

    state = apply(state, frame("question.timer", { qi: 0, reason: "resume", answers_open_at_ms: 9000, deadline_ms: 29_000, paused: false }, 3));
    expect(state.timer).toEqual({ answers_open_at_ms: 9000, deadline_ms: 29_000, paused: false });
    expect(selectCanAnswer(state, 16_000)).toBe(true);
    expect(selectStageView(state).paused).toBe(false);
  });

  it("ignores timer frames for another question", () => {
    const state = apply(open(), frame("question.timer", { qi: 3, reason: "extend", answers_open_at_ms: 1, deadline_ms: 2, paused: false }, 2));
    expect(state.timer?.deadline_ms).toBe(25_000);
  });

  it("derives the personal deadline from the multiplier", () => {
    let state = open();
    expect(selectMyTimer(state)).toBe(state.timer);
    state = apply(state, frame("participant.time", { time_multiplier: 2, qi: 0, deadline_ms: 45_000 }));
    expect(state.myTimeMultiplier).toBe(2);
    expect(selectMyTimer(state)?.deadline_ms).toBe(45_000);
    expect(selectMyTimer(state)).toBe(selectMyTimer(state));
    state = apply(state, frame("participant.time", { time_multiplier: 0 }));
    expect(selectMyTimer(state)?.deadline_ms).toBeNull();
  });

  it("reads the multiplier from welcome and snapshots", () => {
    let state = apply(
      createInitialLiveState("participant"),
      frame("welcome", { role: "participant", session_id: "s1", hb_ms: 5000, proto: 1, me: { participant_id: "p1", display_name: "Ana", avatar_seed: "a", time_multiplier: 1.5 } })
    );
    expect(state.myTimeMultiplier).toBe(1.5);
    expect(state.me).toEqual({ participant_id: "p1", display_name: "Ana", avatar_seed: "a" });
    state = apply(state, frame("room.snapshot", snapshot({ my: { ...mySnap, time_multiplier: 0 } }), 1));
    expect(state.myTimeMultiplier).toBe(0);
  });

  it("answer.ack paused rejects the submission so the pad reopens", () => {
    let state = apply(open(), frame("question.paused", { qi: 0, answers_open_at_ms: 5000, deadline_ms: 25_000, paused: true, paused_at_ms: 12_000, remaining_ms: 13_000 }, 2));
    state = liveReducer(state, { type: "local.submit", qi: 0, answerId: "a1", answer: { choice: ["B"] } });
    state = apply(state, frame("answer.ack", { answer_id: "a1", qi: 0, status: "paused" }));
    expect(state.submission).toMatchObject({ status: "rejected", ack: "paused" });
    expect(state.my?.answered_current).toBe(false);
  });

  it("participant.updated updates the host list", () => {
    const people = [
      { participant_id: "p1", display_name: "Ana", avatar_seed: "a", score: 0, connected: true, time_multiplier: 1, is_bot: false },
      { participant_id: "b1", display_name: "Bot Lince", avatar_seed: "x", score: 0, connected: true, time_multiplier: 1, is_bot: true }
    ];
    let state = apply(createInitialLiveState("host"), frame("room.snapshot", snapshot({ participants: people }), 1));
    state = apply(state, frame("participant.updated", { participant_id: "p1", time_multiplier: 1.5 }));
    expect(state.participants?.[0].time_multiplier).toBe(1.5);
    expect(state.participants?.[1].is_bot).toBe(true);
    const same = apply(state, frame("participant.updated", { participant_id: "ghost", time_multiplier: 2 }));
    expect(same).toBe(state);
  });

  it("stores the transport of the connection", () => {
    const state = liveReducer(createInitialLiveState(), { type: "connection", status: "open", attempt: 0, transport: "sse" });
    expect(state.connection.transport).toBe("sse");
  });
});

describe("liveReducer: moderation and room limits (Incremento 4)", () => {
  function openQuestion(): LiveState {
    return apply(
      createInitialLiveState("participant"),
      frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question, timer: { answers_open_at_ms: 0, deadline_ms: 20_000 }, my: mySnap }), 1)
    );
  }

  it("keeps max_participants and rehearsal from the snapshot (and the last known values without them)", () => {
    let state = apply(createInitialLiveState("host"), frame("room.snapshot", snapshot({ max_participants: 500, rehearsal: true }), 1));
    expect(state.maxParticipants).toBe(500);
    expect(state.rehearsal).toBe(true);
    state = apply(state, frame("room.snapshot", snapshot(), 2));
    expect(state.maxParticipants).toBe(500);
    expect(createInitialLiveState().maxParticipants).toBeNull();
  });

  it("item.removed on the item on screen swaps it for the neutral placeholder at once", () => {
    let state = liveReducer(openQuestion(), { type: "local.submit", qi: 0, answerId: "a1", answer: { choice: ["B"] } });
    state = apply(state, frame("item.removed", { qi: 0, current: true }, 2));
    expect(state.seq).toBe(2);
    expect(state.phase).toBe("content");
    expect(state.question?.removed).toBe(true);
    expect(state.question?.prompt).toBe("");
    expect(state.question?.options).toEqual([]);
    expect(state.question?.scored).toBe(false);
    expect(state.timer).toBeNull();
    expect(state.submission).toBeNull();
    expect(state.removedItem).toMatchObject({ qi: 0, current: true });
    expect(selectCanAnswer(state, 5_000)).toBe(false);
  });

  it("item.removed for another item only records the event (the snapshot that follows carries it)", () => {
    const before = openQuestion();
    const state = apply(before, frame("item.removed", { qi: 3, current: false }, 2));
    expect(state.question).toBe(before.question);
    expect(state.phase).toBe("question");
    expect(state.removedItem).toMatchObject({ qi: 3, current: false });
  });

  it("drops the presenter item (answer key, notes) of the removed item", () => {
    const host = apply(
      createInitialLiveState("host"),
      frame(
        "room.snapshot",
        snapshot({ status: "live", phase: "question", qi: 0, question, timer: { answers_open_at_ms: 0, deadline_ms: 1 }, presenter: { item: presenterItem, next_prompt: null } }),
        1
      )
    );
    expect(host.presenter).not.toBeNull();
    const state = apply(host, frame("item.removed", { qi: 0, current: true }, 2));
    expect(state.presenter).toBeNull();
    expect(state.presenterQi).toBeNull();
  });

  it("ignores a stale item.removed and lets the fresh snapshot win", () => {
    let state = apply(openQuestion(), frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question }), 5));
    state = apply(state, frame("item.removed", { qi: 0, current: true }, 4));
    expect(state.question?.removed).toBeUndefined();
    const placeholder = { ...question, item_type: "content" as const, prompt: "", options: [], scored: false, removed: true };
    state = apply(state, frame("room.snapshot", snapshot({ status: "live", phase: "content", qi: 0, question: placeholder }), 6));
    expect(state.phase).toBe("content");
    expect(selectStageView(state).question?.removed).toBe(true);
  });

  it("host participants added from lobby.update are never previews", () => {
    let state = apply(createInitialLiveState("host"), frame("room.snapshot", snapshot({ participants: [] }), 1));
    state = apply(state, frame("lobby.update", { count: 1, recent: [{ participant_id: "p9", display_name: "Caio", avatar_seed: "c" }] }, 2));
    expect(state.participants?.[0]?.is_preview).toBe(false);
  });
});

describe("liveReducer: GA item types (Incremento 5)", () => {
  const cloudQuestion: PublicQuestion = {
    ...question,
    item_type: "word_cloud",
    options: [],
    scored: false,
    points_multiplier: 0,
    numeric: null,
    max_words: 2
  };
  const numericQuestion: PublicQuestion = {
    ...question,
    item_type: "numeric",
    options: [],
    numeric: { min: 0, max: 1000, step: 1, unit: "bits" },
    max_words: null
  };
  const cloud = { words: [{ text: "Senha", key: "senha", n: 2 }, { text: "MFA", key: "mfa", n: 2 }], distinct: 3, filtered: 1 };
  const histogram = { min: 0, max: 1000, bins: Array.from({ length: 20 }, (_, index) => (index === 5 ? 2 : 0)), n: 2, mean: 260, median: 260 };

  function open(questionOnScreen: PublicQuestion, role: "host" | "display" | "participant" = "host", extra: Partial<Snapshot> = {}): LiveState {
    return apply(
      createInitialLiveState(role),
      frame("room.snapshot", snapshot({ status: "live", phase: "question", qi: 0, question: questionOnScreen, timer: { answers_open_at_ms: 0, deadline_ms: 30_000 }, ...extra }), 10)
    );
  }

  it("results.tick stores the live word cloud and histogram; participant.progress never clears them", () => {
    let state = open(cloudQuestion);
    state = apply(state, frame("results.tick", { qi: 0, answered: 2, total: 4, counts: {}, word_cloud: cloud }, 11));
    expect(state.wordCloud).toEqual(cloud);
    state = apply(state, frame("participant.progress", { qi: 0, answered: 3, total: 4 }, 12));
    expect(state.wordCloud).toEqual(cloud);
    expect(state.answered).toBe(3);
    // Another question's tick is ignored.
    state = apply(state, frame("results.tick", { qi: 1, answered: 9, total: 9, word_cloud: { words: [], distinct: 0, filtered: 0 } }, 13));
    expect(state.wordCloud).toEqual(cloud);

    let numeric = open(numericQuestion);
    numeric = apply(numeric, frame("results.tick", { qi: 0, answered: 2, total: 4, counts: {}, numeric: histogram }, 11));
    expect(numeric.numeric).toEqual(histogram);
  });

  it("the snapshot carries the live blocks while the question is open", () => {
    const state = open(cloudQuestion, "display", { word_cloud: cloud, answered: 2 });
    expect(state.wordCloud).toEqual(cloud);
    const numeric = open(numericQuestion, "host", { numeric: histogram });
    expect(numeric.numeric).toEqual(histogram);
  });

  it("question.intro clears the previous item's cloud and histogram", () => {
    let state = open(cloudQuestion, "host", { word_cloud: cloud });
    state = apply(state, frame("question.intro", { qi: 1, total: 5, question: { ...numericQuestion, qi: 1 }, answers_open_at_ms: 0, deadline_ms: null }, 11));
    expect(state.wordCloud).toBeNull();
    expect(state.numeric).toBeNull();
  });

  it("word_cloud.update replaces the cloud live and inside a reveal, only for the current item", () => {
    const hidden = { words: [{ text: "Senha", key: "senha", n: 2 }], distinct: 3, filtered: 2 };
    let state = open(cloudQuestion, "host", { word_cloud: cloud });
    state = apply(state, frame("word_cloud.update", { qi: 0, word_cloud: hidden }, 11));
    expect(state.wordCloud).toEqual(hidden);

    const cloudReveal: Reveal = { ...reveal, item_type: "word_cloud", correct_option_ids: [], counts: {}, pct_correct: null, word_cloud: cloud, my: undefined };
    state = apply(state, frame("question.reveal", cloudReveal, 12));
    expect(state.phase).toBe("reveal");
    expect(state.wordCloud).toEqual(cloud);
    state = apply(state, frame("word_cloud.update", { qi: 0, word_cloud: hidden }, 13));
    expect(state.reveal?.word_cloud).toEqual(hidden);
    expect(state.wordCloud).toEqual(hidden);

    const before = state;
    expect(apply(state, frame("word_cloud.update", { qi: 3, word_cloud: cloud }, 14))).toBe(before);
  });

  it("keeps the host's hidden word list from the snapshot and the host word_cloud.update", () => {
    const presenter = { item: presenterItem, next_prompt: null, hidden_words: ["backup"] };
    let state = open(cloudQuestion, "host", { word_cloud: cloud, presenter });
    expect(state.hiddenWords).toEqual(["backup"]);
    state = apply(state, frame("word_cloud.update", { qi: 0, word_cloud: cloud, hidden_words: ["backup", "mfa"] }, 11));
    expect(state.hiddenWords).toEqual(["backup", "mfa"]);
    // Display/participant copies carry no list: the known one stays.
    state = apply(state, frame("word_cloud.update", { qi: 0, word_cloud: cloud }, 12));
    expect(state.hiddenWords).toEqual(["backup", "mfa"]);
    // A new item starts empty; the stage view never exposes the list.
    state = apply(state, frame("question.intro", { qi: 1, total: 5, question: { ...cloudQuestion, qi: 1 }, answers_open_at_ms: 0, deadline_ms: null }, 13));
    expect(state.hiddenWords).toEqual([]);
    expect(JSON.stringify(selectStageView(state))).not.toContain("hidden");
  });

  it("restores ordering, numeric and word answers from my.last_answer after a reconnect", () => {
    const cases = [
      { last_answer: { order: ["o_b", "o_a", "o_c"] }, expected: { choice: ["o_b", "o_a", "o_c"] } },
      { last_answer: { number: 275 }, expected: { number: 275 } },
      { last_answer: { words: ["Zero Trust", "MFA"] }, expected: { words: ["Zero Trust", "MFA"] } }
    ];
    for (const { last_answer, expected } of cases) {
      const state = open(numericQuestion, "participant", { my: { ...mySnap, answered_current: true, last_answer } });
      expect(state.submission?.status).toBe("accepted");
      expect(state.submission?.answer).toEqual(expected);
    }
  });

  it("the stage shows the cloud always and the histogram only with the live distribution on", () => {
    const withCloud = selectStageView(open(cloudQuestion, "host", { word_cloud: cloud }));
    expect(withCloud.wordCloud).toEqual(cloud);
    const hiddenHistogram = selectStageView(open(numericQuestion, "host", { numeric: histogram }));
    expect(hiddenHistogram.liveNumeric).toBeNull();
    const liveSettings = { ...snapshot().settings, show_live_distribution: true };
    const shown = selectStageView(open(numericQuestion, "host", { numeric: histogram, settings: liveSettings }));
    expect(shown.liveNumeric).toEqual(histogram);
  });

  it("item.removed drops the live blocks with the item", () => {
    let state = open(cloudQuestion, "host", { word_cloud: cloud });
    state = apply(state, frame("item.removed", { qi: 0, current: true }, 11));
    expect(state.wordCloud).toBeNull();
    expect(state.question?.max_words).toBeNull();
  });

  it("parses the new server frame and keeps unknown ones out", async () => {
    const { parseServerMessage } = await import("@/features/quiz-live/lib/protocol");
    const parsed = parseServerMessage(JSON.stringify({ v: 1, type: "word_cloud.update", sts: 1, data: { qi: 0, word_cloud: cloud } }));
    expect(parsed?.type).toBe("word_cloud.update");
    expect(parseServerMessage(JSON.stringify({ v: 1, type: "word_cloud.nope", sts: 1, data: {} }))).toBeNull();
  });
});

describe("liveReducer: waiting room (Incremento 7)", () => {
  const room = {
    require_approval: true,
    max_participants: 100,
    platform_max: 2000,
    approval_count: 2,
    capacity_count: 3,
    approval: [{ request_id: "r1", display_name: "Ana", avatar_seed: "a", signed_in: false, created_at: "2026-10-01T10:00:00Z", connected: true }]
  };

  it("takes the block from the host snapshot and replaces it on each update (the cap follows)", async () => {
    const { waitingTotal } = await import("@/features/quiz-live/lib/live-store");
    let state = apply(createInitialLiveState("host"), frame("room.snapshot", snapshot({ waiting_room: room }), 1));
    expect(state.waitingRoom).toEqual(room);
    expect(waitingTotal(state.waitingRoom)).toBe(5);
    state = apply(state, frame("waiting_room.update", { ...room, max_participants: 150, approval_count: 0, capacity_count: 0, approval: [] }, 2));
    expect(state.waitingRoom?.approval).toEqual([]);
    expect(state.maxParticipants).toBe(150);
    expect(waitingTotal(state.waitingRoom)).toBe(0);
    expect(waitingTotal(null)).toBe(0);
  });

  it("the stage shows a count only, never names", () => {
    const state = apply(createInitialLiveState("host"), frame("room.snapshot", snapshot({ waiting_room: room }), 1));
    const view = selectStageView(state);
    expect(view.waitingCount).toBe(5);
    expect(JSON.stringify(view)).not.toContain("Ana");
    expect(selectStageView(apply(createInitialLiveState("display"), frame("room.snapshot", snapshot(), 1))).waitingCount).toBeNull();
  });
});
