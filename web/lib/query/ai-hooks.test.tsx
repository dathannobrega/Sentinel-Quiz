// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { aiKeys, useAiJob, useApplyAiJob } from "@/lib/query/ai-hooks";
import type { AiJob, AiJobStatus, LiveQuizDetail } from "@/types/api";

function job(status: AiJobStatus, pct = 0): AiJob {
  return {
    id: "j1",
    kind: "generate",
    status,
    quiz_id: "q1",
    item_id: null,
    created_at: "2026-09-30T10:00:00Z",
    started_at: null,
    finished_at: status === "succeeded" ? "2026-09-30T10:00:20Z" : null,
    progress: { stage: status === "succeeded" ? "done" : "generating", pct },
    credits: 5,
    model: "fake",
    error_code: null,
    error_message: null,
    injection_suspected: false,
    result:
      status === "succeeded"
        ? {
            type: "drafts",
            items: [0, 1].map((index) => ({
              index,
              item_type: "single_choice" as const,
              prompt: "Q",
              options: [],
              accepted_answers: [],
              explanation: "",
              time_limit_s: 20,
              difficulty: null,
              domain: null,
              certification: null,
              issues: [],
              critic: null,
              applied: false,
              blocked: false
            })),
            summary: { requested: 2, produced: 2, blocked: 0, warnings: 0 }
          }
        : null
  };
}

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAiJob", () => {
  it("polls every 1.5 s while the job runs and stops once it finished", async () => {
    const responses = [job("queued"), job("running", 40), job("running", 80), job("succeeded", 100)];
    const get = vi.spyOn(apiClient, "get").mockImplementation(async () => responses.shift() ?? job("succeeded", 100));

    const { result } = renderHook(() => useAiJob("j1"), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]?.[0]).toBe("/ai/jobs/j1");
    expect(result.current.data?.status).toBe("queued");

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(get).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(get).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(get).toHaveBeenCalledTimes(4);
    // react-query notifies observers on a 0 ms timer.
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.data?.status).toBe("succeeded");

    // Finished: no more requests.
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(get).toHaveBeenCalledTimes(4);
  });

  it("pauses while the tab is hidden and resumes when it is visible again", async () => {
    const get = vi.spyOn(apiClient, "get").mockImplementation(async () => job("running", 50));
    renderHook(() => useAiJob("j1"), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(get).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(get).toHaveBeenCalledTimes(1);

    act(() => focusManager.setFocused(true));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(get).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("does nothing without a job id", async () => {
    const get = vi.spyOn(apiClient, "get");
    renderHook(() => useAiJob(null), { wrapper });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useApplyAiJob", () => {
  it("runs through the mutator with its version, after flushing, and marks drafts applied", async () => {
    client.setQueryData(aiKeys.job("j1"), job("succeeded", 100));
    const order: string[] = [];
    const detail = { id: "q1", version: 8, items: [] } as unknown as LiveQuizDetail;
    const post = vi.spyOn(apiClient, "post").mockImplementation(async () => {
      order.push("apply");
      return detail;
    });
    vi.spyOn(apiClient, "get").mockImplementation(async () => job("succeeded", 100));
    const mutator = {
      run: vi.fn(async <T,>(task: (version: number) => Promise<T>) => {
        order.push("run");
        return task(7);
      })
    };
    const beforeApply = vi.fn(async () => {
      order.push("flush");
    });

    const { result } = renderHook(() => useApplyAiJob("q1", mutator as never, { beforeApply }), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ jobId: "j1", indexes: [1] });
    });

    expect(order).toEqual(["flush", "run", "apply"]);
    expect(post).toHaveBeenCalledWith("/ai/jobs/j1/apply", { quiz_id: "q1", expected_version: 7, indexes: [1] });
    const cached = client.getQueryData<AiJob>(aiKeys.job("j1"));
    expect(cached?.result?.type === "drafts" && cached.result.items.map((item) => item.applied)).toEqual([false, true]);
  });
});
