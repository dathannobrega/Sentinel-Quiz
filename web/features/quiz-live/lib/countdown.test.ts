import { describe, expect, it } from "vitest";

import { computeCountdown, elapsedSinceOpen, IDLE_COUNTDOWN } from "@/features/quiz-live/lib/countdown";

const timer = { answers_open_at_ms: 10_000, deadline_ms: 30_000 };

describe("computeCountdown", () => {
  it("is idle without a timer", () => {
    expect(computeCountdown(null, 0)).toBe(IDLE_COUNTDOWN);
  });

  it("counts the reading phase down to the opening", () => {
    const value = computeCountdown(timer, 7_500);
    expect(value).toMatchObject({ stage: "reading", readingMs: 2_500, seconds: 3, fraction: 1, totalMs: 20_000 });
  });

  it("derives the remaining time from the server deadline", () => {
    expect(computeCountdown(timer, 10_000)).toMatchObject({ stage: "open", remainingMs: 20_000, seconds: 20, fraction: 1, warning: false });
    const halfway = computeCountdown(timer, 20_000);
    expect(halfway.fraction).toBeCloseTo(0.5);
    expect(halfway.seconds).toBe(10);
    // Joining late: bar is already at the right place.
    expect(computeCountdown(timer, 26_001)).toMatchObject({ seconds: 4, warning: true });
  });

  it("expires at the deadline", () => {
    expect(computeCountdown(timer, 30_000)).toMatchObject({ stage: "expired", seconds: 0, fraction: 0 });
    expect(computeCountdown(timer, 99_000).stage).toBe("expired");
  });

  it("handles questions without a timer", () => {
    expect(computeCountdown({ answers_open_at_ms: 0, deadline_ms: null }, 5)).toMatchObject({ stage: "untimed", totalMs: null });
  });

  it("reports elapsed time since opening", () => {
    expect(elapsedSinceOpen(timer, 12_345.4)).toBe(2_345);
    expect(elapsedSinceOpen(timer, 1)).toBe(0);
    expect(elapsedSinceOpen(null, 1)).toBeUndefined();
  });
});
