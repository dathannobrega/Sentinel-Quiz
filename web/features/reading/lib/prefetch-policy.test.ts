import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWarmScheduler, planPrefetch, WARM_DEBOUNCE_MS, WARM_MIN_INTERVAL_MS } from "@/features/reading/lib/prefetch-policy";

describe("planPrefetch", () => {
  it("prefetches exactly one block ahead", () => {
    expect(planPrefetch({ activeIndex: 0, blockCount: 3, nextSectionId: "s2" })).toEqual({ kind: "block", index: 1 });
    expect(planPrefetch({ activeIndex: 1, blockCount: 3, nextSectionId: "s2" })).toEqual({ kind: "block", index: 2 });
  });

  it("prefetches the next section on the last block, or nothing at the end of the book", () => {
    expect(planPrefetch({ activeIndex: 2, blockCount: 3, nextSectionId: "s2" })).toEqual({ kind: "next-section", sectionId: "s2" });
    expect(planPrefetch({ activeIndex: 2, blockCount: 3, nextSectionId: null })).toBeNull();
  });
});

describe("createWarmScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces 2 s and sends the latest payload", () => {
    const send = vi.fn();
    const scheduler = createWarmScheduler<number>(send);
    scheduler.request("s1", 1);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS - 500);
    scheduler.request("s1", 2);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS - 1);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("s1", 2);
  });

  it("sends at most once per minute per section", () => {
    const send = vi.fn();
    const scheduler = createWarmScheduler<number>(send);
    scheduler.request("s1", 1);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS);
    scheduler.request("s1", 2);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(1);
    // Another section is independent.
    scheduler.request("s2", 3);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(WARM_MIN_INTERVAL_MS);
    scheduler.request("s1", 4);
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith("s1", 4);
  });

  it("can be cancelled", () => {
    const send = vi.fn();
    const scheduler = createWarmScheduler<number>(send);
    scheduler.request("s1", 1);
    scheduler.cancel();
    vi.advanceTimersByTime(WARM_DEBOUNCE_MS * 2);
    expect(send).not.toHaveBeenCalled();
  });
});
