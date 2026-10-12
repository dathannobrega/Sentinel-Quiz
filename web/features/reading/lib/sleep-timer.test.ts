import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fadeVolume, formatCountdown, sleepOptionMinutes, SLEEP_FADE_MS, startSleepTimer } from "@/features/reading/lib/sleep-timer";

describe("sleep timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maps the options to minutes", () => {
    expect(sleepOptionMinutes("off")).toBeNull();
    expect(sleepOptionMinutes("section")).toBeNull();
    expect(sleepOptionMinutes("45")).toBe(45);
  });

  it("keeps full volume until the last 10 s, then fades linearly", () => {
    expect(fadeVolume(60_000)).toBe(1);
    expect(fadeVolume(SLEEP_FADE_MS)).toBe(1);
    expect(fadeVolume(5_000)).toBe(0.5);
    expect(fadeVolume(0)).toBe(0);
  });

  it("ticks with the remaining time, fades and expires once", () => {
    const onTick = vi.fn();
    const onExpire = vi.fn();
    const handle = startSleepTimer(10 * 60_000, { onTick, onExpire });
    vi.advanceTimersByTime(60_000);
    expect(handle.remainingMs()).toBe(9 * 60_000);
    expect(onTick).toHaveBeenLastCalledWith(9 * 60_000, 1);
    vi.advanceTimersByTime(9 * 60_000 - 5_000);
    expect(onTick).toHaveBeenLastCalledWith(5_000, 0.5);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled", () => {
    const onExpire = vi.fn();
    const handle = startSleepTimer(1_000, { onExpire });
    handle.cancel();
    vi.advanceTimersByTime(5_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("formats the countdown", () => {
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(3_600_000)).toBe("60:00");
    expect(formatCountdown(400)).toBe("0:01");
  });
});
