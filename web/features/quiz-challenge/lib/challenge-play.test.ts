import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_PLAY_STATE,
  answerBody,
  answerIdFor,
  challengePlayReducer,
  noticeFor,
  progressOf,
  withRetry,
  type ChallengePlayState
} from "@/features/quiz-challenge/lib/challenge-play";
import { attemptState, question } from "@/features/quiz-challenge/lib/test-fixtures";
import type { LiveAttemptState } from "@/types/api";

function withState(state: LiveAttemptState): ChallengePlayState {
  return challengePlayReducer(INITIAL_PLAY_STATE, { type: "state", state });
}

describe("challengePlayReducer", () => {
  it("always replaces the attempt with the server copy", () => {
    const first = withState(attemptState());
    const second = challengePlayReducer(first, { type: "state", state: attemptState({ index: 1, item: question(7) }) });
    expect(second.attempt?.index).toBe(1);
    expect(second.attempt?.item?.qi).toBe(7);
  });

  it("accepted answer: new state, no pending, correction kept with the answered question (policy each)", () => {
    let state = withState(attemptState({ feedback: "each" }));
    state = challengePlayReducer(state, { type: "answer.send", pending: { attemptId: "a1", qi: 4, answerId: "id-1", answer: { choice: ["o_4a"] } } });
    expect(state.pending?.status).toBe("sending");
    const next = attemptState({ feedback: "each", index: 1, item: question(9) });
    const feedback = { qi: 4, item_type: "single_choice" as const, answered: true, correct: true, fraction: 1, points: 900, correct_option_ids: ["o_4a"], accepted_answers: [], explanation: null };
    state = challengePlayReducer(state, { type: "answer.result", answerId: "id-1", result: { status: "accepted", state: next, feedback }, question: question(4) });
    expect(state.attempt).toBe(next);
    expect(state.pending).toBeNull();
    expect(state.feedback?.question.qi).toBe(4);
    expect(state.feedback?.answer).toEqual({ choice: ["o_4a"] });
    expect(state.notice).toBeNull();
    expect(challengePlayReducer(state, { type: "feedback.dismiss" }).feedback).toBeNull();
  });

  it("late: the returned state replaces the item and a notice is raised", () => {
    let state = withState(attemptState());
    state = challengePlayReducer(state, { type: "answer.send", pending: { attemptId: "a1", qi: 4, answerId: "id-2", answer: { text: "x" } } });
    const next = attemptState({ index: 1, item: question(5) });
    state = challengePlayReducer(state, { type: "answer.result", answerId: "id-2", result: { status: "late", state: next }, question: question(4) });
    expect(state.attempt?.item?.qi).toBe(5);
    expect(state.notice?.kind).toBe("late");
    expect(state.feedback).toBeNull();
  });

  it("a network failure keeps the pending answer so it is resent with the same id", () => {
    let state = withState(attemptState());
    state = challengePlayReducer(state, { type: "answer.send", pending: { attemptId: "a1", qi: 4, answerId: "id-3", answer: { choice: ["o_4b"] } } });
    state = challengePlayReducer(state, { type: "answer.failed", answerId: "id-3" });
    expect(state.pending).toMatchObject({ status: "failed", answerId: "id-3" });
    const create = vi.fn(() => "fresh");
    expect(answerIdFor(state.pending, "a1", 4, create)).toBe("id-3");
    expect(create).not.toHaveBeenCalled();
    // Another item (or attempt) gets a fresh id.
    expect(answerIdFor(state.pending, "a1", 5, create)).toBe("fresh");
    expect(answerIdFor(state.pending, "a2", 4, create)).toBe("fresh");
  });

  it("a refreshed state on another item drops a stale pending answer", () => {
    let state = withState(attemptState());
    state = challengePlayReducer(state, { type: "answer.send", pending: { attemptId: "a1", qi: 4, answerId: "id-4", answer: {} } });
    state = challengePlayReducer(state, { type: "answer.failed", answerId: "id-4" });
    state = challengePlayReducer(state, { type: "state", state: attemptState({ index: 1, item: question(6) }) });
    expect(state.pending).toBeNull();
  });

  it("ignores results for an answer that is no longer pending", () => {
    let state = withState(attemptState());
    state = challengePlayReducer(state, { type: "answer.send", pending: { attemptId: "a1", qi: 4, answerId: "new", answer: {} } });
    const after = challengePlayReducer(state, { type: "answer.result", answerId: "old", result: { status: "accepted", state: attemptState({ index: 2 }) }, question: null });
    expect(after).toBe(state);
  });

  it("maps statuses to notices", () => {
    expect(noticeFor("accepted")).toBeNull();
    expect(noticeFor("duplicate")).toBeNull();
    expect(noticeFor("late")).toBe("late");
    expect(noticeFor("invalid")).toBe("invalid");
    expect(noticeFor("already_answered")).toBe("stale");
    expect(noticeFor("closed")).toBe("closed");
  });
});

describe("helpers", () => {
  it("answerBody keeps only the fields the pad used", () => {
    expect(answerBody("id", 3, { choice: ["a"] })).toEqual({ answer_id: "id", qi: 3, choice: ["a"] });
    expect(answerBody("id", 3, { number: 0 })).toEqual({ answer_id: "id", qi: 3, number: 0 });
    expect(answerBody("id", 3, { text: "smishing" })).toEqual({ answer_id: "id", qi: 3, text: "smishing" });
    expect(answerBody("id", 3, { words: ["mfa"] })).toEqual({ answer_id: "id", qi: 3, words: ["mfa"] });
  });

  it("withRetry resends the same request while the error is retryable", async () => {
    const sleep = vi.fn(async () => undefined);
    const send = vi.fn().mockRejectedValueOnce(new Error("net")).mockRejectedValueOnce(new Error("net")).mockResolvedValue("ok");
    await expect(withRetry(send, () => true, { delays: [1, 2, 3], sleep })).resolves.toBe("ok");
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1], [2]]);
  });

  it("withRetry stops on a non-retryable error and after the last delay", async () => {
    const sleep = vi.fn(async () => undefined);
    const fatal = vi.fn().mockRejectedValue(new Error("422"));
    await expect(withRetry(fatal, () => false, { delays: [1], sleep })).rejects.toThrow("422");
    expect(fatal).toHaveBeenCalledTimes(1);
    const flaky = vi.fn().mockRejectedValue(new Error("net"));
    await expect(withRetry(flaky, () => true, { delays: [1, 1], sleep })).rejects.toThrow("net");
    expect(flaky).toHaveBeenCalledTimes(3);
  });

  it("progressOf is 1-based and clamped", () => {
    expect(progressOf(attemptState({ index: 0, total: 4 }))).toEqual({ current: 1, total: 4, fraction: 0 });
    expect(progressOf(attemptState({ index: 2, total: 4 }))).toEqual({ current: 3, total: 4, fraction: 0.5 });
    expect(progressOf(attemptState({ index: 4, total: 4, status: "finished" }))).toEqual({ current: 4, total: 4, fraction: 1 });
    expect(progressOf(null)).toEqual({ current: 0, total: 0, fraction: 0 });
  });

  it("progressOf keeps the corrected item's number while its correction is shown", () => {
    // The server already moved to item 2 (index 1); the screen still corrects item 1.
    expect(progressOf(attemptState({ index: 1, total: 4 }), true)).toEqual({ current: 1, total: 4, fraction: 0.25 });
    expect(progressOf(attemptState({ index: 4, total: 4, status: "finished" }), true).current).toBe(4);
  });
});
