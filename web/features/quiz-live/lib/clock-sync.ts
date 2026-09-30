/**
 * Client ↔ server clock alignment (CONTRATO §6 "Relógio do cliente", PLANO §10.4).
 *
 * The client sends `time.sync {t0}` (t0 = local monotonic clock), the server answers
 * `time.sync.reply {t0, t1, t2}` (t1 = receive, t2 = send, both server epoch ms) and the client
 * stamps t3 on arrival. For every sample:
 *
 *   offset = ((t1 − t0) + (t2 − t3)) / 2      rtt = (t3 − t0) − (t2 − t1)
 *
 * Only the sample with the smallest RTT is kept (its offset has the tightest error bound, RTT/2).
 * `serverNow()` = monotonic now + offset, so timers never depend on `Date.now()` (which can jump).
 */

export interface ClockReply {
  t0: number;
  t1: number;
  t2: number;
}

export interface ClockSample {
  offset: number;
  rtt: number;
}

export interface ClockSyncOptions {
  /** Monotonic clock in ms. Defaults to performance.now(). */
  now?: () => number;
  /** Samples per sync round (contract: 5). */
  samples?: number;
}

export const CLOCK_SYNC_SAMPLES = 5;

/** Pure math for one round trip. */
export function computeClockSample(reply: ClockReply, t3: number): ClockSample {
  const offset = (reply.t1 - reply.t0 + (reply.t2 - t3)) / 2;
  const rtt = Math.max(0, t3 - reply.t0 - (reply.t2 - reply.t1));
  return { offset, rtt };
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export class ClockSync {
  private readonly now: () => number;
  private readonly target: number;
  private readonly pending = new Set<number>();
  private best: ClockSample | null = null;
  private seeded: number | null = null;
  private roundSamples = 0;

  constructor(options: ClockSyncOptions = {}) {
    this.now = options.now ?? defaultNow;
    this.target = Math.max(1, options.samples ?? CLOCK_SYNC_SAMPLES);
  }

  /** Local monotonic time (ms). */
  localNow(): number {
    return this.now();
  }

  /** Starts a new round (after every (re)connect). The previous best offset stays usable meanwhile. */
  beginRound(): void {
    this.pending.clear();
    this.roundSamples = 0;
  }

  /** Returns the `t0` to send in `time.sync`, and remembers it so replies can be validated. */
  createRequest(): number {
    const t0 = this.now();
    this.pending.add(t0);
    return t0;
  }

  /** Whether the current round still needs samples. */
  needsSamples(): boolean {
    return this.roundSamples + this.pending.size < this.target;
  }

  get samplesInRound(): number {
    return this.roundSamples;
  }

  /**
   * Applies a reply. Replies for a `t0` this instance did not send (or already consumed) are
   * ignored. Returns the accepted sample or null.
   */
  addReply(reply: ClockReply, t3: number = this.now()): ClockSample | null {
    if (!this.pending.has(reply.t0)) {
      return null;
    }
    this.pending.delete(reply.t0);
    if (![reply.t0, reply.t1, reply.t2, t3].every(Number.isFinite) || t3 < reply.t0) {
      return null;
    }
    const sample = computeClockSample(reply, t3);
    this.roundSamples += 1;
    if (!this.best || sample.rtt <= this.best.rtt) {
      this.best = sample;
    }
    return sample;
  }

  /**
   * Rough fallback before any sample arrives: aligns on a frame's `sts` (server epoch ms),
   * ignoring latency. Superseded as soon as a real sample exists.
   */
  seedFromServerTime(sts: number, receivedAt: number = this.now()): void {
    if (Number.isFinite(sts)) {
      this.seeded = sts - receivedAt;
    }
  }

  get offsetMs(): number {
    return this.best?.offset ?? this.seeded ?? Date.now() - this.now();
  }

  get rttMs(): number | null {
    return this.best?.rtt ?? null;
  }

  get isSynced(): boolean {
    return this.best !== null;
  }

  /** Server epoch ms, now. */
  serverNow(): number {
    return this.now() + this.offsetMs;
  }

  /** Converts a server epoch timestamp to the local monotonic timeline. */
  toLocal(serverMs: number): number {
    return serverMs - this.offsetMs;
  }
}
