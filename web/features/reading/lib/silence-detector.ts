/**
 * End-of-utterance detection for "listen and repeat": the microphone level (RMS over 100 ms
 * frames) is tracked with an AnalyserNode; the recording stops after 1.2 s below the threshold
 * once voice was heard, or at a hard cap. The decision logic (`createSilenceTracker`) is pure and
 * tested with synthetic RMS sequences; `startSilenceDetector` wires it to a MediaStream.
 */

export interface SilenceTrackerOptions {
  /** RMS level (0–1) that counts as voice. */
  threshold?: number;
  /** Consecutive time above the threshold before voice counts as detected. */
  voiceMs?: number;
  /** Consecutive time below the threshold, after voice, that ends the utterance. */
  silenceMs?: number;
  /** Hard cap on the whole recording. */
  maxMs: number;
}

export const SILENCE_FRAME_MS = 100;
export const SILENCE_DEFAULTS = {
  threshold: 0.02,
  voiceMs: 200,
  silenceMs: 1_200
} as const;

export type SilenceVerdict = "listening" | "voice" | "stop";

export interface SilenceTracker {
  /** Feeds one frame; `elapsedMs` is the time since the recording started. */
  feed(rms: number, elapsedMs: number): SilenceVerdict;
  readonly voiceDetected: boolean;
}

export function createSilenceTracker(options: SilenceTrackerOptions): SilenceTracker {
  const threshold = options.threshold ?? SILENCE_DEFAULTS.threshold;
  const voiceMs = options.voiceMs ?? SILENCE_DEFAULTS.voiceMs;
  const silenceMs = options.silenceMs ?? SILENCE_DEFAULTS.silenceMs;
  let aboveMs = 0;
  let belowMs = 0;
  let lastElapsed = 0;
  let voice = false;
  let stopped = false;
  return {
    get voiceDetected() {
      return voice;
    },
    feed(rms, elapsedMs) {
      if (stopped) {
        return "stop";
      }
      const frame = Math.max(0, elapsedMs - lastElapsed) || SILENCE_FRAME_MS;
      lastElapsed = elapsedMs;
      if (rms > threshold) {
        aboveMs += frame;
        belowMs = 0;
        if (aboveMs >= voiceMs) {
          voice = true;
        }
      } else {
        aboveMs = 0;
        belowMs += frame;
      }
      if (elapsedMs >= options.maxMs || (voice && belowMs >= silenceMs)) {
        stopped = true;
        return "stop";
      }
      return voice ? "voice" : "listening";
    }
  };
}

/** Root mean square of a time-domain frame (-1..1 samples). */
export function computeRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Recording cap for a sentence of `durationSeconds`: max(4 s, 2 × duration + 2 s). */
export function repeatRecordingCapSeconds(durationSeconds: number | null | undefined): number {
  const duration = durationSeconds && Number.isFinite(durationSeconds) ? durationSeconds : 0;
  return Math.max(4, 2 * duration + 2);
}

export interface SilenceDetectorHandle {
  stop(): void;
}

interface AudioContextScope {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

function audioContextScope(): AudioContextScope | null {
  return typeof window === "undefined" ? null : (globalThis as unknown as AudioContextScope);
}

export function isSilenceDetectionSupported(): boolean {
  const scope = audioContextScope();
  return Boolean(scope && (typeof scope.AudioContext === "function" || typeof scope.webkitAudioContext === "function"));
}

/** Test hook (non-production builds): `window.__sentinelReader.forceSilence()` ends the current utterance. */
interface ReaderTestHooks {
  forceSilence?: () => void;
}

function testHooks(): ReaderTestHooks | null {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") {
    return null;
  }
  const scope = window as Window & { __sentinelReader?: ReaderTestHooks };
  scope.__sentinelReader ??= {};
  return scope.__sentinelReader;
}

/**
 * Watches `stream` and calls `onStop` once (silence after voice, or the cap). Returns null when the
 * Web Audio API is unavailable, in which case the caller relies on the cap alone.
 */
export function startSilenceDetector(stream: MediaStream, options: SilenceTrackerOptions, onStop: () => void): SilenceDetectorHandle | null {
  const scope = audioContextScope();
  const Context = scope?.AudioContext ?? scope?.webkitAudioContext;
  if (!Context) {
    return null;
  }
  let context: AudioContext;
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    context = new Context();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
  } catch {
    return null;
  }
  const tracker = createSilenceTracker(options);
  const buffer = new Float32Array(analyser.fftSize);
  const startedAt = performance.now();
  let finished = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = () => {
    if (timer !== null) {
      globalThis.clearInterval(timer);
      timer = null;
    }
    try {
      source.disconnect();
    } catch {
      // Already disconnected.
    }
    void context.close().catch(() => {});
    const hooks = testHooks();
    if (hooks && hooks.forceSilence === force) {
      delete hooks.forceSilence;
    }
  };
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    onStop();
  };
  const force = () => finish();

  timer = globalThis.setInterval(() => {
    if (finished) {
      return;
    }
    analyser.getFloatTimeDomainData(buffer);
    const verdict = tracker.feed(computeRms(buffer), performance.now() - startedAt);
    if (verdict === "stop") {
      finish();
    }
  }, SILENCE_FRAME_MS);

  const hooks = testHooks();
  if (hooks) {
    hooks.forceSilence = force;
  }

  return {
    stop() {
      if (!finished) {
        finished = true;
        cleanup();
      }
    }
  };
}
