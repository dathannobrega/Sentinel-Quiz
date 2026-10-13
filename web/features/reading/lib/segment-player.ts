/**
 * Segment player: plays an ordered list of audio segments (one sentence each) as one track, on a
 * single timeline (`segment offset + element time`). Two HTMLAudioElements alternate: while one
 * plays, the next segment is already loaded in the other (`preload=auto`, blob URL), so the hand-
 * over at the sentence boundary is a `play()` on an element that is ready (target gap ≤ 60 ms).
 *
 * The segments come from a `SegmentFeed` that may still be growing (streamed TTS): when the
 * current segment ends and the next one has not arrived, the player reports `buffering` and
 * resumes as soon as it does. A single file (offline, fallback) is a complete feed of one segment.
 *
 * Framework-free: the React hook wraps it; tests drive it with fake elements and a fake clock.
 */

import { findSegmentIndexAtTime, segmentsDuration, type PlayerSegment } from "@/features/reading/lib/segments";
import { findWordIndexAtTime, type WordTiming } from "@/features/reading/lib/tokenize";

export type SegmentPlayerStatus = "idle" | "loading" | "buffering" | "ready" | "playing" | "paused" | "ended" | "error";

export interface SegmentPlayerState {
  status: SegmentPlayerStatus;
  /** Index into the timings; -1 before the first word. */
  currentWordIndex: number;
  /** Timeline position rounded to 0.25 s (precise value through `getTimes`). */
  currentTime: number;
  duration: number;
  /** Segment being played (-1 when none is loaded). */
  segmentIndex: number;
}

/** Ordered segments that may still be arriving. */
export interface SegmentFeed {
  readonly segments: readonly PlayerSegment[];
  /** True once every segment is known. */
  readonly complete: boolean;
  /** Set when the source failed; the player reports an error when it runs out of segments. */
  readonly error: unknown;
  subscribe(listener: () => void): () => void;
}

export interface MutableSegmentFeed extends SegmentFeed {
  push(segment: PlayerSegment): void;
  finish(): void;
  fail(error: unknown): void;
}

/** A feed the owner appends to (streamed block) or creates complete (single file). */
export function createSegmentFeed(initial: readonly PlayerSegment[] = [], complete = false): MutableSegmentFeed {
  const segments: PlayerSegment[] = [...initial];
  const listeners = new Set<() => void>();
  let done = complete;
  let error: unknown = null;
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get segments() {
      return segments;
    },
    get complete() {
      return done;
    },
    get error() {
      return error;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push(segment) {
      if (done) {
        return;
      }
      segments.push(segment);
      notify();
    },
    finish() {
      if (!done) {
        done = true;
        notify();
      }
    },
    fail(reason) {
      if (!done) {
        error = reason ?? new Error("segment feed failed");
        done = true;
        notify();
      }
    }
  };
}

export interface SegmentPlayerOptions {
  createElement?: () => HTMLAudioElement;
  /** Ticker used while playing (requestAnimationFrame by default; a timeout in tests). */
  schedule?: (callback: (now: number) => void) => number;
  cancel?: (handle: number) => void;
  onState?: (state: SegmentPlayerState) => void;
  /** The last segment of a complete feed played to its end (not after `playRange`). */
  onEnded?: () => void;
  onError?: (error: unknown) => void;
}

export const INITIAL_SEGMENT_PLAYER_STATE: SegmentPlayerState = {
  status: "idle",
  currentWordIndex: -1,
  currentTime: 0,
  duration: 0,
  segmentIndex: -1
};

function defaultCreateElement(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  return audio;
}

function defaultSchedule(callback: (now: number) => void): number {
  if (typeof requestAnimationFrame === "function") {
    return requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(performance.now()), 50) as unknown as number;
}

function defaultCancel(handle: number): void {
  if (typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(handle);
  } else {
    globalThis.clearTimeout(handle);
  }
}

interface Slot {
  element: HTMLAudioElement;
  /** Segment index loaded in this element (-1 = nothing useful). */
  segment: number;
  /** Feed the loaded segment belongs to (guards against stale events after a reload). */
  feed: SegmentFeed | null;
}

export class SegmentPlayer {
  private readonly options: SegmentPlayerOptions;
  private slots: Slot[] | null = null;
  private active = 0;
  private feed: SegmentFeed | null = null;
  private unsubscribe: (() => void) | null = null;
  private timings: WordTiming[] = [];
  private rangeEnd: number | null = null;
  private rangeResolvers: Array<() => void> = [];
  /** Segment (and time inside it) to activate as soon as the feed delivers it. */
  private pending: { segment: number; time: number } | null = null;
  /** Playback requested (autoplay or play while buffering). */
  private wantPlaying = false;
  private volume = 1;
  private playbackRate = 1;
  private frame: number | null = null;
  private lastTick: number | null = null;
  private listened = 0;
  private wasRange = false;
  state: SegmentPlayerState = INITIAL_SEGMENT_PLAYER_STATE;

  constructor(options: SegmentPlayerOptions = {}) {
    this.options = options;
  }

  /* ------------------------------------------------------------------ elements */

  private ensureSlots(): Slot[] | null {
    if (this.slots) {
      return this.slots;
    }
    if (typeof window === "undefined" && !this.options.createElement) {
      return null;
    }
    const create = this.options.createElement ?? defaultCreateElement;
    this.slots = [0, 1].map(() => {
      const element = create();
      element.volume = this.volume;
      element.playbackRate = this.playbackRate;
      const slot: Slot = { element, segment: -1, feed: null };
      this.attach(slot);
      return slot;
    });
    return this.slots;
  }

  private attach(slot: Slot) {
    const { element } = slot;
    const isActive = () => this.slots !== null && this.slots[this.active] === slot && slot.feed === this.feed && slot.feed !== null;
    element.addEventListener("play", () => {
      if (isActive()) {
        this.setState({ status: "playing" });
        this.startLoop();
      }
    });
    element.addEventListener("pause", () => {
      if (!isActive() || element.ended) {
        return;
      }
      this.stopLoop();
      this.syncPosition();
      if (this.state.status === "playing" || this.state.status === "ready" || this.state.status === "loading") {
        this.setState({ status: "paused" });
      }
      this.resolveRange();
    });
    element.addEventListener("ended", () => {
      if (isActive()) {
        this.handleSegmentEnded();
      }
    });
    const handleDuration = () => {
      if (isActive()) {
        this.setState({ duration: this.totalDuration() });
      }
    };
    element.addEventListener("durationchange", handleDuration);
    element.addEventListener("loadedmetadata", handleDuration);
    element.addEventListener("canplay", () => {
      if (isActive() && this.state.status === "loading") {
        this.setState({ status: "ready" });
      }
    });
    element.addEventListener("error", () => {
      if (isActive()) {
        this.stopLoop();
        this.setState({ status: "error" });
        this.options.onError?.(element.error);
      } else {
        // A failed preload: forget it so the activation reloads the segment.
        slot.segment = -1;
      }
    });
  }

  private activeSlot(): Slot | null {
    return this.slots ? this.slots[this.active] : null;
  }

  private standbySlot(): Slot | null {
    return this.slots ? this.slots[1 - this.active] : null;
  }

  /* ------------------------------------------------------------------ state */

  private setState(patch: Partial<SegmentPlayerState>) {
    const next = { ...this.state, ...patch };
    if (
      next.status === this.state.status &&
      next.currentWordIndex === this.state.currentWordIndex &&
      next.currentTime === this.state.currentTime &&
      next.duration === this.state.duration &&
      next.segmentIndex === this.state.segmentIndex
    ) {
      return;
    }
    this.state = next;
    this.options.onState?.(next);
  }

  private segmentDuration(index: number): number {
    const segment = this.feed?.segments[index];
    if (!segment) {
      return 0;
    }
    if (segment.duration > 0) {
      return segment.duration;
    }
    const slot = this.slots?.find((item) => item.feed === this.feed && item.segment === index);
    const measured = slot?.element.duration;
    return measured !== undefined && Number.isFinite(measured) ? measured : 0;
  }

  private totalDuration(): number {
    if (!this.feed) {
      return 0;
    }
    const known = segmentsDuration(this.feed.segments);
    if (known > 0) {
      return known;
    }
    return this.segmentDuration(0);
  }

  /** Current position on the block timeline (seconds). */
  private timelineNow(): number {
    const slot = this.activeSlot();
    if (!slot || !this.feed || slot.segment < 0) {
      return this.pending ? (this.feed?.segments[this.pending.segment]?.offset ?? segmentsDuration(this.feed?.segments ?? [])) + this.pending.time : 0;
    }
    const segment = this.feed.segments[slot.segment];
    return (segment?.offset ?? 0) + slot.element.currentTime;
  }

  private syncPosition() {
    const time = this.timelineNow();
    const index = findWordIndexAtTime(this.timings, time + 0.02);
    this.setState({
      currentWordIndex: index,
      currentTime: Math.round(time * 4) / 4
    });
  }

  /* ------------------------------------------------------------------ loop */

  private stopLoop() {
    if (this.frame !== null) {
      (this.options.cancel ?? defaultCancel)(this.frame);
      this.frame = null;
    }
    this.lastTick = null;
  }

  private startLoop() {
    this.stopLoop();
    const schedule = this.options.schedule ?? defaultSchedule;
    const tick = (now: number) => {
      const slot = this.activeSlot();
      if (!slot) {
        return;
      }
      if (this.lastTick !== null && !slot.element.paused) {
        this.listened += Math.max(0, (now - this.lastTick) / 1000);
      }
      this.lastTick = now;
      if (this.rangeEnd !== null && this.timelineNow() >= this.rangeEnd) {
        this.finishRange();
        return;
      }
      this.syncPosition();
      this.frame = schedule(tick);
    };
    this.frame = schedule(tick);
  }

  /* ------------------------------------------------------------------ segments */

  private preload(index: number) {
    const standby = this.standbySlot();
    const segment = this.feed?.segments[index];
    if (!standby || !segment || (standby.segment === index && standby.feed === this.feed)) {
      return;
    }
    standby.segment = index;
    standby.feed = this.feed;
    standby.element.src = segment.url;
    standby.element.load();
  }

  /** Loads segment `index` into the active element (swapping in the preloaded one when possible). */
  private activate(index: number, time: number, play: boolean) {
    const slots = this.ensureSlots();
    if (!slots || !this.feed) {
      return;
    }
    const segment = this.feed.segments[index];
    if (!segment) {
      if (this.feed.error) {
        this.fail(this.feed.error);
      } else if (this.feed.complete) {
        this.finishTrack();
      } else {
        this.pending = { segment: index, time };
        this.wantPlaying = play || this.wantPlaying;
        this.setState({ status: "buffering", segmentIndex: -1 });
      }
      return;
    }
    this.pending = null;
    const standby = this.standbySlot();
    const current = this.activeSlot();
    if (current && !current.element.paused) {
      current.element.pause();
    }
    // Status first: `load()` may fire `canplay` synchronously (cached blob), which moves loading → ready.
    this.setState({
      status: play ? this.state.status : "loading",
      segmentIndex: index
    });
    if (standby && standby.segment === index && standby.feed === this.feed) {
      this.active = 1 - this.active;
      if (!play && this.state.status === "loading" && standby.element.readyState >= 3) {
        this.setState({ status: "ready" });
      }
    } else if (current) {
      current.segment = index;
      current.feed = this.feed;
      current.element.src = segment.url;
      current.element.load();
    }
    const slot = this.activeSlot();
    if (!slot) {
      return;
    }
    if (time > 0 || slot.element.currentTime !== 0) {
      slot.element.currentTime = Math.max(0, time);
    }
    this.setState({ duration: this.totalDuration() });
    this.syncPosition();
    this.preload(index + 1);
    if (play) {
      void this.playElement(slot.element);
    }
  }

  private async playElement(element: HTMLAudioElement) {
    this.wantPlaying = false;
    try {
      await element.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        // Autoplay policies reject play() without a gesture; surface it as paused, not broken.
        this.setState({ status: "paused" });
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      this.setState({ status: "error" });
      this.options.onError?.(error);
    }
  }

  private handleSegmentEnded() {
    const slot = this.activeSlot();
    if (!slot || !this.feed) {
      return;
    }
    const next = slot.segment + 1;
    const nextOffset = segmentsDuration(this.feed.segments.slice(0, next));
    if (this.rangeEnd !== null && this.rangeEnd <= nextOffset + 0.001) {
      this.finishRange();
      return;
    }
    if (this.feed.segments[next]) {
      this.activate(next, 0, true);
    } else if (this.feed.error) {
      this.fail(this.feed.error);
    } else if (this.feed.complete) {
      this.finishTrack();
    } else {
      this.stopLoop();
      this.pending = { segment: next, time: 0 };
      this.wantPlaying = true;
      this.setState({ status: "buffering" });
    }
  }

  private finishTrack() {
    this.stopLoop();
    const wasRange = this.rangeEnd !== null;
    this.rangeEnd = null;
    this.pending = null;
    this.wantPlaying = false;
    this.setState({
      status: "ended",
      currentWordIndex: this.timings.length - 1,
      currentTime: Math.round(this.totalDuration() * 4) / 4
    });
    this.resolveRange();
    if (!wasRange) {
      this.options.onEnded?.();
    }
  }

  private fail(error: unknown) {
    this.stopLoop();
    this.pending = null;
    this.wantPlaying = false;
    this.setState({ status: "error" });
    this.resolveRange();
    this.options.onError?.(error);
  }

  private finishRange() {
    this.rangeEnd = null;
    const slot = this.activeSlot();
    if (slot && !slot.element.paused) {
      slot.element.pause();
    } else {
      this.stopLoop();
      this.setState({ status: "paused" });
    }
    this.syncPosition();
    this.resolveRange();
  }

  private resolveRange() {
    const resolvers = this.rangeResolvers;
    this.rangeResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private handleFeedChange = () => {
    if (!this.feed) {
      return;
    }
    if (this.pending) {
      const { segment, time } = this.pending;
      if (this.feed.segments[segment]) {
        const play = this.wantPlaying;
        this.activate(segment, time, play);
        if (!play) {
          this.setState({ status: "paused" });
        }
      } else if (this.feed.error) {
        this.fail(this.feed.error);
      } else if (this.feed.complete) {
        this.finishTrack();
      }
      return;
    }
    const slot = this.activeSlot();
    if (slot && slot.segment >= 0) {
      this.preload(slot.segment + 1);
    }
    this.setState({ duration: this.totalDuration() });
  };

  /* ------------------------------------------------------------------ public API */

  /** Replaces the track. `autoplay` starts as soon as the first segment can play. */
  load(feed: SegmentFeed, timings: WordTiming[], options: { autoplay?: boolean } = {}) {
    this.stopLoop();
    this.unsubscribe?.();
    this.rangeEnd = null;
    this.resolveRange();
    this.pending = null;
    this.timings = timings;
    this.feed = feed;
    this.wantPlaying = Boolean(options.autoplay);
    const slots = this.ensureSlots();
    if (slots) {
      slots.forEach((slot) => {
        slot.element.pause();
        slot.segment = -1;
        slot.feed = null;
      });
    }
    this.state = { ...INITIAL_SEGMENT_PLAYER_STATE, status: "loading" };
    this.options.onState?.(this.state);
    this.unsubscribe = feed.subscribe(this.handleFeedChange);
    this.activate(0, 0, Boolean(options.autoplay));
  }

  /** Word timings on the block timeline (grow as streamed segments arrive). */
  setTimings(timings: WordTiming[]) {
    this.timings = timings;
    if (this.feed) {
      this.syncPosition();
    }
  }

  play() {
    if (!this.feed) {
      return;
    }
    const slot = this.activeSlot();
    if (this.state.status === "ended") {
      this.activate(0, 0, true);
      return;
    }
    if (this.pending || !slot || slot.segment < 0) {
      this.wantPlaying = true;
      this.setState({ status: "buffering" });
      return;
    }
    this.rangeEnd = null;
    void this.playElement(slot.element);
  }

  pause() {
    this.wantPlaying = false;
    const slot = this.activeSlot();
    if (slot && !slot.element.paused) {
      slot.element.pause();
    } else if (this.state.status === "buffering") {
      this.setState({ status: "paused" });
    }
  }

  toggle() {
    if (!this.feed) {
      return;
    }
    const slot = this.activeSlot();
    const playing = this.state.status === "playing" || this.state.status === "buffering" || (slot !== null && slot.segment >= 0 && !slot.element.paused);
    if (playing) {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Seeks on the block timeline (switching segment when needed). */
  seek(seconds: number, options: { play?: boolean } = {}) {
    if (!this.feed) {
      return;
    }
    const slot = this.activeSlot();
    const wasPlaying =
      options.play ||
      this.wantPlaying ||
      this.state.status === "playing" ||
      this.state.status === "buffering" ||
      (slot !== null && slot.segment >= 0 && !slot.element.paused);
    this.rangeEnd = null;
    this.resolveRange();
    const target = Math.max(0, seconds);
    const segments = this.feed.segments;
    const known = segmentsDuration(segments);
    if (segments.length === 0 || (target >= known && !this.feed.complete)) {
      // Past the received segments: wait for the one that will contain the position.
      this.pending = { segment: segments.length, time: target - known };
      this.wantPlaying = Boolean(wasPlaying);
      if (slot && !slot.element.paused) {
        slot.element.pause();
      }
      this.stopLoop();
      this.setState({
        status: wasPlaying ? "buffering" : "paused",
        currentTime: Math.round(target * 4) / 4
      });
      return;
    }
    const index = findSegmentIndexAtTime(segments, Math.min(target, Math.max(0, known - 0.001)));
    const segment = segments[index];
    const inside = Math.min(Math.max(0, target - segment.offset), Math.max(0, this.segmentDuration(index) - 0.05));
    if (slot && slot.segment === index && slot.feed === this.feed) {
      slot.element.currentTime = inside;
      this.pending = null;
      if (this.state.status === "ended") {
        this.setState({ status: "paused" });
      }
      this.syncPosition();
      if (wasPlaying) {
        void this.playElement(slot.element);
      }
      return;
    }
    this.activate(index, inside, Boolean(wasPlaying));
    if (!wasPlaying) {
      this.setState({ status: "paused" });
    }
  }

  /** Plays only `[start, end]` of the timeline; resolves when the range ends or is interrupted. */
  playRange(start: number, end: number): Promise<void> {
    if (!this.feed) {
      return Promise.resolve();
    }
    // Seek first: it settles any previous range before this one is registered.
    this.seek(start, { play: true });
    const promise = new Promise<void>((resolve) => {
      this.rangeResolvers.push(resolve);
    });
    this.rangeEnd = Math.max(start + 0.05, end);
    return promise;
  }

  /** Pauses and rewinds to the start of the track. */
  stop() {
    this.wantPlaying = false;
    this.rangeEnd = null;
    this.pending = null;
    const slot = this.activeSlot();
    if (slot && !slot.element.paused) {
      slot.element.pause();
    }
    this.stopLoop();
    if (this.feed && this.feed.segments.length) {
      this.activate(0, 0, false);
      this.setState({ status: "paused", currentWordIndex: -1, currentTime: 0 });
    } else {
      this.setState({
        status: this.feed ? "paused" : "idle",
        currentWordIndex: -1,
        currentTime: 0
      });
    }
    this.resolveRange();
  }

  /** Returns and resets the wall-clock seconds spent playing since the previous call. */
  drainListenedSeconds(): number {
    const seconds = this.listened;
    this.listened = 0;
    return seconds;
  }

  hasSource(): boolean {
    return this.feed !== null && this.feed.segments.length > 0;
  }

  /** Volume 0–1 on both elements (the sleep timer fades with it). */
  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.slots?.forEach((slot) => {
      slot.element.volume = this.volume;
    });
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    this.slots?.forEach((slot) => {
      slot.element.playbackRate = rate;
    });
  }

  /** Precise timeline position and duration (the state rounds the time). */
  getTimes() {
    return {
      currentTime: this.timelineNow(),
      duration: this.totalDuration(),
      playbackRate: this.playbackRate
    };
  }

  /** Index of the segment that holds timeline second `time`, or -1 when not received yet. */
  segmentAt(time: number): number {
    if (!this.feed) {
      return -1;
    }
    const index = findSegmentIndexAtTime(this.feed.segments, time);
    return index >= 0 && time < segmentsDuration(this.feed.segments) ? index : -1;
  }

  destroy() {
    this.stopLoop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.feed = null;
    this.resolveRange();
    this.slots?.forEach((slot) => {
      slot.element.pause();
      slot.element.removeAttribute("src");
      slot.element.load();
    });
    this.slots = null;
  }
}
