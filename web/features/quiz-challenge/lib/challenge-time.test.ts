import { describe, expect, it } from "vitest";

import {
  createChallengeClock,
  formatClock,
  formatDurationShort,
  itemTimer,
  remainingMs,
  splitDuration,
  syncClock,
  totalTimer
} from "@/features/quiz-challenge/lib/challenge-time";
import { computeCountdown } from "@/features/quiz-live/lib/countdown";

describe("server clock correction", () => {
  it("serverNow follows server_now, not the local clock", () => {
    let local = 1_000;
    const clock = createChallengeClock("2026-10-01T12:00:00.000000+00:00", () => local);
    expect(clock.serverNow()).toBe(Date.parse("2026-10-01T12:00:00Z"));
    local += 2_500;
    expect(clock.serverNow()).toBe(Date.parse("2026-10-01T12:00:02.500Z"));
    // A later response re-aligns (the device clock may drift or jump).
    syncClock(clock, "2026-10-01T12:01:00+00:00");
    expect(clock.serverNow()).toBe(Date.parse("2026-10-01T12:01:00Z"));
  });

  it("ignores missing or invalid timestamps", () => {
    const clock = createChallengeClock(null, () => 0);
    const before = clock.serverNow();
    syncClock(clock, "not a date");
    expect(clock.serverNow()).toBe(before);
  });
});

describe("timers", () => {
  const state = {
    status: "in_progress" as const,
    item_started_at: "2026-10-01T12:00:00+00:00",
    item_deadline_at: "2026-10-01T12:00:30+00:00",
    started_at: "2026-10-01T11:58:00+00:00",
    deadline_at: "2026-10-01T12:18:00+00:00"
  };

  it("item countdown runs from item_started_at to item_deadline_at", () => {
    const timer = itemTimer(state);
    expect(timer).toEqual({ answers_open_at_ms: Date.parse("2026-10-01T12:00:00Z"), deadline_ms: Date.parse("2026-10-01T12:00:30Z") });
    const at10s = computeCountdown(timer, Date.parse("2026-10-01T12:00:10Z"));
    expect(at10s.stage).toBe("open");
    expect(at10s.seconds).toBe(20);
    expect(computeCountdown(timer, Date.parse("2026-10-01T12:00:31Z")).stage).toBe("expired");
  });

  it("untimed items and finished attempts have no item timer", () => {
    expect(itemTimer({ ...state, item_deadline_at: null })).toBeNull();
    expect(itemTimer({ ...state, status: "finished" })).toBeNull();
    // Policy "each": the next item is pending until "Próxima" (no clock yet).
    expect(itemTimer({ ...state, next_pending: true })).toBeNull();
    expect(itemTimer(null)).toBeNull();
  });

  it("total countdown runs to deadline_at", () => {
    const timer = totalTimer(state);
    expect(timer?.deadline_ms).toBe(Date.parse("2026-10-01T12:18:00Z"));
    expect(computeCountdown(timer, Date.parse("2026-10-01T12:17:00Z")).remainingMs).toBe(60_000);
    expect(totalTimer({ ...state, deadline_at: null })).toBeNull();
  });

  it("remainingMs never goes negative", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(remainingMs("2026-10-01T12:00:05Z", now)).toBe(5_000);
    expect(remainingMs("2026-10-01T11:00:00Z", now)).toBe(0);
    expect(remainingMs(null, now)).toBeNull();
  });
});

describe("duration formatting", () => {
  it("splits and rounds up to the second", () => {
    expect(splitDuration(90_061_001)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 2 });
    expect(splitDuration(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("formats clocks and short durations", () => {
    expect(formatClock(247_000)).toBe("4:07");
    expect(formatClock(3_729_000)).toBe("1:02:09");
    expect(formatClock(0)).toBe("0:00");
    expect(formatDurationShort(312_000)).toBe("5 min 12 s");
    expect(formatDurationShort(3_840_000)).toBe("1 h 4 min");
    expect(formatDurationShort(2 * 86_400_000 + 3 * 3_600_000)).toBe("2 d 3 h");
    expect(formatDurationShort(null)).toBe("–");
  });
});
