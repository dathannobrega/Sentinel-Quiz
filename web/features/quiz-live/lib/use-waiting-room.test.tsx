// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadWaitingTicket, saveWaitingTicket, type WaitingTicket } from "@/features/quiz-live/lib/live-fetch";
import { nextPollDelay, POLL_BACKOFF_MAX_MS, POLL_MAX_MS, POLL_MIN_MS, useWaitingRoom } from "@/features/quiz-live/lib/use-waiting-room";
import { ApiError } from "@/lib/api/errors";

const queue = vi.hoisted(() => ({ getQueueStatus: vi.fn(), leaveQueue: vi.fn() }));

vi.mock("@/features/quiz-live/lib/live-fetch", async (original) => ({
  ...(await original<typeof import("@/features/quiz-live/lib/live-fetch")>()),
  getQueueStatus: queue.getQueueStatus,
  leaveQueue: queue.leaveQueue
}));

const ticket: WaitingTicket = {
  requestId: "r1",
  waitToken: "wait-secret",
  sessionId: "s1",
  displayName: "Ana",
  avatarSeed: "abc",
  reason: "capacity",
  position: 3,
  waiting: 10,
  retryAfterMs: 3000
};

const join = { status: "joined", session_id: "s1", participant_id: "p1", token: "tok", expires_at: "2099-01-01T00:00:00Z", return_code: "ABC123", display_name: "Ana", avatar_seed: "abc" };

beforeEach(() => {
  vi.useFakeTimers();
  queue.getQueueStatus.mockReset();
  queue.leaveQueue.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function apiError(status: number, code: string): ApiError {
  return new ApiError({ message: code, code, status });
}

describe("nextPollDelay", () => {
  it("keeps the server's pace within 3-15 s and adds at most 20% jitter", () => {
    expect(nextPollDelay(4000, 0, () => 0)).toBe(4000);
    expect(nextPollDelay(4000, 0, () => 1)).toBe(4800);
    expect(nextPollDelay(100, 0, () => 0)).toBe(POLL_MIN_MS);
    expect(nextPollDelay(60_000, 0, () => 0)).toBe(POLL_MAX_MS);
    expect(nextPollDelay(Number.NaN, 0, () => 0)).toBe(POLL_MIN_MS);
  });

  it("backs off after failures, capped under the server's stale window", () => {
    expect(nextPollDelay(3000, 1, () => 0)).toBe(6000);
    expect(nextPollDelay(3000, 10, () => 0)).toBe(POLL_BACKOFF_MAX_MS);
  });
});

describe("useWaitingRoom", () => {
  it("polls at the server's pace, updates the place in line and hands over the join once admitted", async () => {
    const onAdmitted = vi.fn();
    queue.getQueueStatus
      .mockResolvedValueOnce({ status: "waiting", reason: "capacity", request_id: "r1", session_id: "s1", display_name: "Ana", avatar_seed: "abc", position: 1, waiting: 4, retry_after_ms: 3000 })
      .mockResolvedValueOnce({ status: "admitted", request_id: "r1", session_id: "s1", join });
    const { result } = renderHook(() => useWaitingRoom({ code: "123456", ticket, onAdmitted, random: () => 0 }));
    expect(queue.getQueueStatus).not.toHaveBeenCalled(); // the first poll waits the 202's pace
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(queue.getQueueStatus).toHaveBeenCalledWith("r1", "wait-secret", expect.anything());
    expect(result.current.ticket.position).toBe(1);
    expect(loadWaitingTicket("123456")?.position).toBe(1); // a reload resumes from here
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(onAdmitted).toHaveBeenCalledWith(join);
    expect(loadWaitingTicket("123456")).toBeNull();
  });

  it("ends on a rejection and on a ticket the server no longer knows", async () => {
    queue.getQueueStatus.mockResolvedValueOnce({ status: "rejected", request_id: "r1", session_id: "s1" });
    const rejected = renderHook(() => useWaitingRoom({ code: "123456", ticket, immediate: true, onAdmitted: vi.fn() }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rejected.result.current.end).toBe("rejected");
    rejected.unmount();

    queue.getQueueStatus.mockRejectedValueOnce(apiError(403, "invalid_wait_token"));
    const invalid = renderHook(() => useWaitingRoom({ code: "123456", ticket: { ...ticket, requestId: "r2" }, immediate: true, onAdmitted: vi.fn() }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invalid.result.current.end).toBe("invalid");
  });

  it("keeps waiting through network errors (counted for the screen) and leaves the queue on demand", async () => {
    saveWaitingTicket("123456", ticket);
    queue.getQueueStatus.mockRejectedValueOnce(apiError(0, "offline"));
    queue.leaveQueue.mockResolvedValue({ status: "withdrawn", request_id: "r1" });
    const { result } = renderHook(() => useWaitingRoom({ code: "123456", ticket, immediate: true, onAdmitted: vi.fn() }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.failures).toBe(1);
    expect(result.current.end).toBeNull();
    await act(async () => {
      await result.current.leave();
    });
    expect(queue.leaveQueue).toHaveBeenCalledWith("r1", "wait-secret");
    expect(loadWaitingTicket("123456")).toBeNull();
    queue.getQueueStatus.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(queue.getQueueStatus).not.toHaveBeenCalled(); // no more polls after leaving
  });

  it("skips its turn while the tab is hidden and polls as soon as it is visible again", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    queue.getQueueStatus.mockResolvedValue({ status: "waiting", reason: "approval", request_id: "r1", session_id: "s1", display_name: "Ana", avatar_seed: "abc", position: null, waiting: 1, retry_after_ms: 3000 });
    renderHook(() => useWaitingRoom({ code: "123456", ticket: { ...ticket, reason: "approval", position: null }, onAdmitted: vi.fn(), random: () => 0 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(queue.getQueueStatus).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(queue.getQueueStatus).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
});
