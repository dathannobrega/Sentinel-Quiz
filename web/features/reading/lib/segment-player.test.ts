import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSegmentFeed, SegmentPlayer, type SegmentPlayerState } from "@/features/reading/lib/segment-player";
import type { WordTiming } from "@/features/reading/lib/tokenize";

/**
 * HTMLAudioElement stand-in driven by the fake clock: `currentTime` advances with Date.now() while
 * playing and `ended` fires when it reaches the duration registered for the src.
 */
class FakeAudio extends EventTarget {
  static durations = new Map<string, number>();
  src = "";
  preload = "";
  volume = 1;
  playbackRate = 1;
  readyState = 0;
  paused = true;
  ended = false;
  error: MediaError | null = null;
  playCalls: number[] = [];
  endedAt: number | null = null;
  private base = 0;
  private startedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  get duration(): number {
    return FakeAudio.durations.get(this.src) ?? Number.NaN;
  }

  get currentTime(): number {
    return this.startedAt === null ? this.base : this.base + (Date.now() - this.startedAt) / 1000;
  }

  set currentTime(value: number) {
    this.base = value;
    this.ended = false;
    if (this.startedAt !== null) {
      this.startedAt = Date.now();
    }
  }

  load() {
    this.stopTimer();
    this.base = 0;
    this.startedAt = null;
    this.ended = false;
    this.paused = true;
    if (this.src) {
      this.readyState = 4;
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("durationchange"));
      this.dispatchEvent(new Event("canplay"));
    }
  }

  play(): Promise<void> {
    this.playCalls.push(Date.now());
    if (!this.src) {
      return Promise.reject(new DOMException("no source", "NotSupportedError"));
    }
    if (this.ended) {
      this.base = 0;
      this.ended = false;
    }
    this.paused = false;
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      if (this.currentTime >= this.duration) {
        this.base = this.duration;
        this.startedAt = null;
        this.stopTimer();
        this.paused = true;
        this.ended = true;
        this.endedAt = Date.now();
        this.dispatchEvent(new Event("pause"));
        this.dispatchEvent(new Event("ended"));
      }
    }, 5);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  }

  pause() {
    if (this.paused) {
      return;
    }
    this.base = this.currentTime;
    this.startedAt = null;
    this.stopTimer();
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }

  removeAttribute(name: string) {
    if (name === "src") {
      this.src = "";
    }
  }

  private stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function createPlayer(options: { onEnded?: () => void; onError?: (error: unknown) => void } = {}) {
  const elements: FakeAudio[] = [];
  const states: SegmentPlayerState[] = [];
  const player = new SegmentPlayer({
    createElement: () => {
      const element = new FakeAudio();
      elements.push(element);
      return element as unknown as HTMLAudioElement;
    },
    schedule: (callback) => setTimeout(() => callback(Date.now()), 16) as unknown as number,
    cancel: (handle) => clearTimeout(handle),
    onState: (state) => states.push(state),
    onEnded: options.onEnded,
    onError: options.onError
  });
  return { player, elements, states };
}

const TIMINGS: WordTiming[] = [
  { start: 0, end: 0.4, matched: true },
  { start: 0.5, end: 0.9, matched: true },
  { start: 1, end: 1.4, matched: true },
  { start: 1.5, end: 1.9, matched: true }
];

describe("SegmentPlayer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    FakeAudio.durations.clear();
    FakeAudio.durations.set("blob:a", 1);
    FakeAudio.durations.set("blob:b", 1);
    FakeAudio.durations.set("blob:c", 1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands over to the preloaded segment with a gap of at most 60 ms", async () => {
    const onEnded = vi.fn();
    const { player, elements } = createPlayer({ onEnded });
    const feed = createSegmentFeed(
      [
        { url: "blob:a", duration: 1, offset: 0 },
        { url: "blob:b", duration: 1, offset: 1 }
      ],
      true
    );
    player.load(feed, TIMINGS, { autoplay: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("playing");
    expect(player.state.segmentIndex).toBe(0);
    // The second element already holds the next segment.
    expect(elements[1].src).toBe("blob:b");

    await vi.advanceTimersByTimeAsync(1_100);
    expect(player.state.status).toBe("playing");
    expect(player.state.segmentIndex).toBe(1);
    const endedAt = elements[0].endedAt;
    expect(endedAt).not.toBeNull();
    expect(elements[1].playCalls).toHaveLength(1);
    expect(elements[1].playCalls[0] - (endedAt as number)).toBeLessThanOrEqual(60);
    // One timeline: 1.5 s is the fourth word.
    expect(player.getTimes().currentTime).toBeCloseTo(1.1, 1);
    await vi.advanceTimersByTimeAsync(400);
    expect(player.state.currentWordIndex).toBe(3);

    await vi.advanceTimersByTimeAsync(600);
    expect(player.state.status).toBe("ended");
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("buffers when the next segment has not arrived and resumes when it does", async () => {
    const onEnded = vi.fn();
    const { player } = createPlayer({ onEnded });
    const feed = createSegmentFeed([{ url: "blob:a", duration: 1, offset: 0 }]);
    player.load(feed, TIMINGS, { autoplay: true });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(player.state.status).toBe("buffering");
    expect(onEnded).not.toHaveBeenCalled();

    feed.push({ url: "blob:b", duration: 1, offset: 1 });
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("playing");
    expect(player.state.segmentIndex).toBe(1);

    await vi.advanceTimersByTimeAsync(1_100);
    // The feed is still open: the end of the last known segment is not the end of the block.
    expect(player.state.status).toBe("buffering");
    feed.finish();
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("ended");
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("starts buffering with an empty feed and plays the first segment on arrival", async () => {
    const { player } = createPlayer();
    const feed = createSegmentFeed();
    player.load(feed, TIMINGS, { autoplay: true });
    expect(player.state.status).toBe("buffering");
    feed.push({ url: "blob:a", duration: 1, offset: 0 });
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("playing");
    expect(player.getTimes().duration).toBe(1);
  });

  it("seeks across segments on the shared timeline", async () => {
    const { player, elements } = createPlayer();
    const feed = createSegmentFeed(
      [
        { url: "blob:a", duration: 1, offset: 0 },
        { url: "blob:b", duration: 1, offset: 1 },
        { url: "blob:c", duration: 1, offset: 2 }
      ],
      true
    );
    player.load(feed, TIMINGS);
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("ready");

    player.seek(1.5);
    expect(player.state.segmentIndex).toBe(1);
    expect(player.getTimes().currentTime).toBeCloseTo(1.5, 5);
    expect(player.state.currentWordIndex).toBe(3);
    expect(player.state.status).toBe("paused");
    // The segment after the target is preloaded in the other element.
    const standby = elements.find((element) => element.src === "blob:c");
    expect(standby).toBeDefined();

    player.seek(0.5, { play: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.segmentIndex).toBe(0);
    expect(player.state.status).toBe("playing");
    expect(player.getTimes().currentTime).toBeCloseTo(0.52, 1);
    expect(player.segmentAt(2.5)).toBe(2);
    expect(player.segmentAt(9)).toBe(-1);
  });

  it("plays a range across a boundary and resolves without ending the track", async () => {
    const onEnded = vi.fn();
    const { player } = createPlayer({ onEnded });
    const feed = createSegmentFeed(
      [
        { url: "blob:a", duration: 1, offset: 0 },
        { url: "blob:b", duration: 1, offset: 1 }
      ],
      true
    );
    player.load(feed, TIMINGS);
    let resolved = false;
    const done = player.playRange(0.8, 1.3).then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(player.state.segmentIndex).toBe(1);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await done;
    expect(resolved).toBe(true);
    expect(player.state.status).toBe("paused");
    expect(onEnded).not.toHaveBeenCalled();
    expect(player.getTimes().currentTime).toBeGreaterThanOrEqual(1.3);
  });

  it("plays a single file whose duration comes from the element", async () => {
    FakeAudio.durations.set("blob:single", 2.5);
    const { player, elements } = createPlayer();
    player.load(createSegmentFeed([{ url: "blob:single", duration: 0, offset: 0 }], true), TIMINGS, { autoplay: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(player.state.status).toBe("playing");
    expect(player.getTimes().duration).toBe(2.5);
    player.setVolume(0.5);
    expect(elements.every((element) => element.volume === 0.5)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    player.pause();
    expect(player.state.status).toBe("paused");
    expect(player.drainListenedSeconds()).toBeGreaterThan(0);
    expect(player.drainListenedSeconds()).toBe(0);
    player.stop();
    expect(player.state.currentTime).toBe(0);
    expect(player.hasSource()).toBe(true);
  });

  it("reports an error when the feed fails before the next segment", async () => {
    const onError = vi.fn();
    const { player } = createPlayer({ onError });
    const feed = createSegmentFeed([{ url: "blob:a", duration: 1, offset: 0 }]);
    player.load(feed, TIMINGS, { autoplay: true });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(player.state.status).toBe("buffering");
    feed.fail(new Error("tts_failed"));
    expect(player.state.status).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
