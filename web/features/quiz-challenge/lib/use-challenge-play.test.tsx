// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { attemptState, question } from "@/features/quiz-challenge/lib/test-fixtures";
import { useChallengePlay } from "@/features/quiz-challenge/lib/use-challenge-play";
import { ApiError } from "@/lib/api/errors";
import * as api from "@/lib/api/live-challenge";

vi.mock("@/lib/api/live-challenge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/live-challenge")>();
  return {
    ...actual,
    getCurrentAttempt: vi.fn(),
    startAttempt: vi.fn(),
    submitChallengeAnswer: vi.fn(),
    advanceAttempt: vi.fn(),
    finishAttempt: vi.fn()
  };
});

const mocked = vi.mocked(api);
const network = () => new ApiError({ code: "network_error", message: "offline", status: 0 });

function setup(onTokenLost = vi.fn()) {
  return renderHook(() => useChallengePlay({ slug: "SLUG0001", token: "tok", onTokenLost, retryDelays: [0, 0] }));
}

beforeEach(() => {
  mocked.getCurrentAttempt.mockResolvedValue(attemptState());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useChallengePlay", () => {
  it("resumes the open attempt and aligns the clock on server_now", async () => {
    const { result } = setup();
    let loaded: unknown;
    await act(async () => {
      loaded = await result.current.load();
    });
    expect(mocked.getCurrentAttempt).toHaveBeenCalledWith("SLUG0001", "tok");
    expect((loaded as { attempt_id: string }).attempt_id).toBe("a1");
    expect(result.current.attempt?.item?.qi).toBe(4);
    expect(Math.abs(result.current.clock.serverNow() - Date.parse("2026-10-01T12:00:00Z"))).toBeLessThan(1_000);
  });

  it("reports 'none' before the first attempt", async () => {
    mocked.getCurrentAttempt.mockRejectedValueOnce(new ApiError({ code: "attempt_not_found", message: "x", status: 404 }));
    const { result } = setup();
    let loaded: unknown;
    await act(async () => {
      loaded = await result.current.load();
    });
    expect(loaded).toBe("none");
    expect(result.current.error).toBeNull();
  });

  it("retries a failed answer with the SAME answer_id and replaces the state with the reply", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.load();
    });
    const next = attemptState({ index: 1, item: question(8) });
    mocked.submitChallengeAnswer.mockRejectedValueOnce(network()).mockRejectedValueOnce(network()).mockResolvedValueOnce({ status: "accepted", state: next });
    await act(async () => {
      await result.current.submit({ choice: ["o_4a"] });
    });
    expect(mocked.submitChallengeAnswer).toHaveBeenCalledTimes(3);
    const ids = mocked.submitChallengeAnswer.mock.calls.map((call) => call[3].answer_id);
    expect(new Set(ids).size).toBe(1);
    expect(mocked.submitChallengeAnswer.mock.calls[0]?.[3]).toMatchObject({ qi: 4, choice: ["o_4a"] });
    expect(result.current.attempt).toEqual(next);
    expect(result.current.pending).toBeNull();
  });

  it("after the retries give up, 'Enviar de novo' resends the same answer_id", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.load();
    });
    mocked.submitChallengeAnswer.mockRejectedValue(network());
    await act(async () => {
      await result.current.submit({ text: "smishing" });
    });
    expect(result.current.pending?.status).toBe("failed");
    expect(result.current.error).toBe("offline");
    const firstId = mocked.submitChallengeAnswer.mock.calls[0]?.[3].answer_id;
    mocked.submitChallengeAnswer.mockReset();
    mocked.submitChallengeAnswer.mockResolvedValue({ status: "duplicate", state: attemptState({ index: 1, item: question(9) }) });
    await act(async () => {
      result.current.retrySubmit();
    });
    await act(async () => undefined);
    expect(mocked.submitChallengeAnswer.mock.calls[0]?.[3].answer_id).toBe(firstId);
    expect(result.current.attempt?.item?.qi).toBe(9);
  });

  it("late: shows the notice and carries on with the new state", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.load();
    });
    mocked.submitChallengeAnswer.mockResolvedValue({ status: "late", state: attemptState({ index: 1, item: question(5) }) });
    await act(async () => {
      await result.current.submit({ choice: ["o_4b"] });
    });
    expect(result.current.notice?.kind).toBe("late");
    expect(result.current.attempt?.item?.qi).toBe(5);
    expect(mocked.submitChallengeAnswer).toHaveBeenCalledTimes(1);
  });

  it("a rejected token hands over to the return-code flow", async () => {
    const onTokenLost = vi.fn();
    mocked.getCurrentAttempt.mockRejectedValueOnce(new ApiError({ code: "token_expired", message: "x", status: 401 }));
    const { result } = setup(onTokenLost);
    await act(async () => {
      await result.current.load();
    });
    expect(onTokenLost).toHaveBeenCalledTimes(1);
  });

  it("next() reveals a pending item with GET attempts/current, then drops the correction", async () => {
    mocked.getCurrentAttempt.mockResolvedValueOnce(attemptState({ feedback: "each" }));
    const { result } = setup();
    await act(async () => {
      await result.current.load();
    });
    mocked.submitChallengeAnswer.mockResolvedValue({
      status: "accepted",
      state: attemptState({ feedback: "each", index: 1, item: null, item_deadline_at: null, next_pending: true, score: 900 }),
      feedback: { qi: 4, item_type: "single_choice", answered: true, correct: true, fraction: 1, points: 900, correct_option_ids: ["o_4a"], accepted_answers: [], explanation: null }
    });
    await act(async () => {
      await result.current.submit({ choice: ["o_4a"] });
    });
    expect(result.current.feedback).not.toBeNull();
    expect(result.current.attempt?.next_pending).toBe(true);
    mocked.getCurrentAttempt.mockResolvedValueOnce(attemptState({ feedback: "each", index: 1, item: question(6), score: 900 }));
    await act(async () => {
      await result.current.next();
    });
    expect(mocked.getCurrentAttempt).toHaveBeenCalledTimes(2);
    expect(result.current.feedback).toBeNull();
    expect(result.current.attempt?.item?.qi).toBe(6);
  });

  it("advance leaves the current content slide by its index", async () => {
    mocked.getCurrentAttempt.mockResolvedValue(attemptState({ index: 2, item: question(1, { item_type: "content", options: [] }) }));
    mocked.advanceAttempt.mockResolvedValue(attemptState({ index: 3 }));
    const { result } = setup();
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      await result.current.advance();
    });
    expect(mocked.advanceAttempt).toHaveBeenCalledWith("SLUG0001", "tok", "a1", 2);
    expect(result.current.attempt?.index).toBe(3);
  });
});
