import { describe, expect, it } from "vitest";

import { ClockSync, computeClockSample } from "@/features/quiz-live/lib/clock-sync";

describe("computeClockSample", () => {
  it("computes NTP-style offset and rtt", () => {
    // Client clock at 1000 when server clock is 51_000 (offset 50_000); 40 ms each way, 2 ms server work.
    const sample = computeClockSample({ t0: 1000, t1: 51_040, t2: 51_042 }, 1082);
    expect(sample.offset).toBe(50_000);
    expect(sample.rtt).toBe(80);
  });

  it("never reports a negative rtt", () => {
    expect(computeClockSample({ t0: 10, t1: 20, t2: 40 }, 15).rtt).toBe(0);
  });
});

describe("ClockSync", () => {
  function fakeClock(start = 0) {
    let value = start;
    return {
      now: () => value,
      advance: (ms: number) => {
        value += ms;
      }
    };
  }

  it("keeps the offset of the minimum-RTT sample among 5", () => {
    const clock = fakeClock(100);
    const sync = new ClockSync({ now: clock.now, samples: 5 });
    sync.beginRound();
    const trueOffset = 1_700_000_000_000;
    // Asymmetric paths distort offsets; the fastest round trip should win.
    const rtts = [300, 120, 40, 200, 90];
    for (const rtt of rtts) {
      expect(sync.needsSamples()).toBe(true);
      const t0 = sync.createRequest();
      const upstream = rtt * 0.75; // asymmetric: 75% up, 25% down
      const t1 = t0 + trueOffset + upstream;
      clock.advance(rtt);
      sync.addReply({ t0, t1, t2: t1 });
    }
    expect(sync.needsSamples()).toBe(false);
    expect(sync.rttMs).toBe(40);
    // Error bounded by rtt/2 of the best sample.
    expect(Math.abs(sync.offsetMs - trueOffset)).toBeLessThanOrEqual(20);
    expect(sync.isSynced).toBe(true);
  });

  it("serverNow follows the monotonic clock plus offset", () => {
    const clock = fakeClock(0);
    const sync = new ClockSync({ now: clock.now });
    const t0 = sync.createRequest();
    clock.advance(10);
    sync.addReply({ t0, t1: 5005, t2: 5005 });
    expect(sync.offsetMs).toBe(5000);
    clock.advance(1000);
    expect(sync.serverNow()).toBe(6010);
    expect(sync.toLocal(6010)).toBe(1010);
  });

  it("ignores replies for unknown or duplicated t0", () => {
    const clock = fakeClock(0);
    const sync = new ClockSync({ now: clock.now });
    expect(sync.addReply({ t0: 999, t1: 1, t2: 1 })).toBeNull();
    const t0 = sync.createRequest();
    expect(sync.addReply({ t0, t1: 1, t2: 1 }, 5)).not.toBeNull();
    expect(sync.addReply({ t0, t1: 1, t2: 1 }, 5)).toBeNull();
  });

  it("uses the server timestamp as a seed until a real sample exists", () => {
    const clock = fakeClock(50);
    const sync = new ClockSync({ now: clock.now });
    sync.seedFromServerTime(10_050);
    expect(sync.isSynced).toBe(false);
    expect(sync.serverNow()).toBe(10_050);
    const t0 = sync.createRequest();
    clock.advance(20);
    sync.addReply({ t0, t1: 20_060, t2: 20_060 });
    expect(sync.offsetMs).toBe(20_000);
  });

  it("starts a fresh round after a reconnect but keeps the previous offset meanwhile", () => {
    const clock = fakeClock(0);
    const sync = new ClockSync({ now: clock.now, samples: 2 });
    for (let index = 0; index < 2; index += 1) {
      const t0 = sync.createRequest();
      clock.advance(10);
      sync.addReply({ t0, t1: t0 + 1000 + 5, t2: t0 + 1000 + 5 });
    }
    expect(sync.needsSamples()).toBe(false);
    sync.beginRound();
    expect(sync.needsSamples()).toBe(true);
    expect(sync.offsetMs).toBe(1000);
  });
});
