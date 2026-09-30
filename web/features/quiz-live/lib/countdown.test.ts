import { describe, expect, it } from "vitest";

import { computeCountdown, elapsedSinceOpen, IDLE_COUNTDOWN, personalTimer } from "@/features/quiz-live/lib/countdown";

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

describe("paused timer", () => {
  const paused = { ...timer, paused: true, paused_at_ms: 20_000, remaining_ms: 10_000 };

  it("freezes at the pause instant, however much time passes", () => {
    const early = computeCountdown(paused, 20_000);
    const late = computeCountdown(paused, 90_000);
    expect(late).toMatchObject({ stage: "open", remainingMs: 10_000, seconds: 10, paused: true });
    expect(late.fraction).toBeCloseTo(early.fraction);
  });

  it("never shows the hurry warning while frozen", () => {
    const value = computeCountdown({ ...timer, paused: true, paused_at_ms: 27_000 }, 60_000);
    expect(value).toMatchObject({ remainingMs: 3_000, warning: false, paused: true });
  });

  it("freezes the reading phase too", () => {
    expect(computeCountdown({ ...timer, paused: true, paused_at_ms: 8_000 }, 50_000)).toMatchObject({ stage: "reading", readingMs: 2_000 });
  });
});

describe("personalTimer", () => {
  it("keeps the room timer for 1×", () => {
    expect(personalTimer(timer, 1)).toBe(timer);
    expect(personalTimer(null, 2)).toBeNull();
  });

  it("stretches the answer window from the opening instant", () => {
    expect(personalTimer(timer, 1.5)).toMatchObject({ answers_open_at_ms: 10_000, deadline_ms: 40_000 });
    expect(personalTimer(timer, 2)).toMatchObject({ deadline_ms: 50_000 });
  });

  it("removes the deadline for untimed participants", () => {
    expect(computeCountdown(personalTimer(timer, 0), 20_000).stage).toBe("untimed");
  });

  it("recomputes the remaining time of a paused personal timer", () => {
    const value = personalTimer({ ...timer, paused: true, paused_at_ms: 20_000, remaining_ms: 10_000 }, 2);
    expect(value).toMatchObject({ deadline_ms: 50_000, remaining_ms: 30_000 });
    expect(computeCountdown(value, 99_000)).toMatchObject({ remainingMs: 30_000, paused: true });
  });
});
