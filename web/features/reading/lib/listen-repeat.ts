/**
 * "Listen and repeat" state machine, per sentence:
 * model (the sentence plays) → cue (300 ms) → recording (microphone, stops on silence) →
 * assessing → result → next sentence when overall ≥ 0.85, otherwise the same sentence again, up
 * to 3 tries, then on. The result phase waits for the learner (`next()` / `retry()`) so there is
 * time to review each word; with `resultMs` set it moves on by itself after that delay instead.
 * Pause restarts the current sentence at `model` on resume.
 * Framework-free (timers injectable through globalThis); the panel renders it.
 */

export type RepeatPhase = "idle" | "model" | "cue" | "recording" | "assessing" | "result" | "paused" | "done";

export interface RepeatState {
  phase: RepeatPhase;
  /** 0-based position of the current sentence. */
  sentence: number;
  /** Attempts made on the current sentence. */
  tries: number;
  lastScore: number | null;
  /** True when the last result let the drill move on. */
  passed: boolean;
}

export type RepeatEffect =
  | { type: "play_model"; sentence: number }
  | { type: "start_recording"; sentence: number }
  | { type: "assess"; sentence: number; blob: Blob; filename: string }
  /** Stop whatever is playing or recording (pause, exit, failure). */
  | { type: "stop" }
  | { type: "finished" };

export interface RepeatMachineOptions {
  sentenceCount: number;
  passScore?: number;
  maxTries?: number;
  cueMs?: number;
  /** Auto-advance delay after a result; `null`/absent = wait for `next()` or `retry()`. */
  resultMs?: number | null;
  onEffect: (effect: RepeatEffect) => void;
  onChange?: (state: RepeatState) => void;
}

export const REPEAT_PASS_SCORE = 0.85;
export const REPEAT_MAX_TRIES = 3;
export const REPEAT_CUE_MS = 300;
/** Delay used when auto-advance is on (the default is to wait for the learner). */
export const REPEAT_RESULT_MS = 6_000;

export class ListenRepeatMachine {
  private readonly options: RepeatMachineOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  state: RepeatState = {
    phase: "idle",
    sentence: 0,
    tries: 0,
    lastScore: null,
    passed: false
  };

  constructor(options: RepeatMachineOptions) {
    this.options = options;
  }

  private set(patch: Partial<RepeatState>) {
    this.state = { ...this.state, ...patch };
    this.options.onChange?.(this.state);
  }

  private clearTimer() {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private playModel() {
    this.set({ phase: "model" });
    this.options.onEffect({
      type: "play_model",
      sentence: this.state.sentence
    });
  }

  /** Starts (or restarts) at sentence `sentence`. */
  start(sentence = 0) {
    this.clearTimer();
    if (this.options.sentenceCount <= 0) {
      this.set({
        phase: "done",
        sentence: 0,
        tries: 0,
        lastScore: null,
        passed: false
      });
      this.options.onEffect({ type: "finished" });
      return;
    }
    this.set({
      sentence: Math.min(Math.max(0, sentence), this.options.sentenceCount - 1),
      tries: 0,
      lastScore: null,
      passed: false
    });
    this.playModel();
  }

  /** The model sentence finished playing. */
  modelEnded() {
    if (this.state.phase !== "model") {
      return;
    }
    this.set({ phase: "cue" });
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      if (this.state.phase !== "cue") {
        return;
      }
      this.set({ phase: "recording" });
      this.options.onEffect({
        type: "start_recording",
        sentence: this.state.sentence
      });
    }, this.options.cueMs ?? REPEAT_CUE_MS);
  }

  /** The microphone produced a usable recording. */
  recordingCaptured(blob: Blob, filename: string) {
    if (this.state.phase !== "recording") {
      return;
    }
    this.set({ phase: "assessing" });
    this.options.onEffect({
      type: "assess",
      sentence: this.state.sentence,
      blob,
      filename
    });
  }

  /** Recording or assessment failed: pause so the learner sees the error and resumes by hand. */
  fail() {
    if (this.state.phase === "idle" || this.state.phase === "done") {
      return;
    }
    this.clearTimer();
    this.set({ phase: "paused" });
    this.options.onEffect({ type: "stop" });
  }

  /** The assessment came back with its overall score (0–1). */
  assessed(overall: number) {
    if (this.state.phase !== "assessing") {
      return;
    }
    const tries = this.state.tries + 1;
    const passed = overall >= (this.options.passScore ?? REPEAT_PASS_SCORE);
    this.set({ phase: "result", tries, lastScore: overall, passed });
    const delay = this.options.resultMs;
    if (typeof delay === "number" && delay > 0) {
      this.timer = globalThis.setTimeout(() => {
        this.timer = null;
        if (this.state.phase !== "result") {
          return;
        }
        this.advance();
      }, delay);
    }
  }

  /** Learner's choice after a result: hear the model again and repeat the same sentence. */
  retry() {
    if (this.state.phase !== "result" && this.state.phase !== "paused") {
      return;
    }
    this.clearTimer();
    this.playModel();
  }

  /** Learner's choice after a result: move on regardless of the score. */
  next() {
    if (this.state.phase !== "result" && this.state.phase !== "paused") {
      return;
    }
    this.clearTimer();
    this.moveOn();
  }

  /** Whether the machine would move on by itself (passed, or out of tries). */
  get wouldMoveOn(): boolean {
    return this.state.passed || this.state.tries >= (this.options.maxTries ?? REPEAT_MAX_TRIES);
  }

  private advance() {
    if (!this.wouldMoveOn) {
      this.playModel();
      return;
    }
    this.moveOn();
  }

  private moveOn() {
    const next = this.state.sentence + 1;
    if (next >= this.options.sentenceCount) {
      this.set({ phase: "done" });
      this.options.onEffect({ type: "finished" });
      return;
    }
    this.set({ sentence: next, tries: 0, lastScore: null, passed: false });
    this.playModel();
  }

  pause() {
    if (this.state.phase === "idle" || this.state.phase === "paused" || this.state.phase === "done") {
      return;
    }
    this.clearTimer();
    this.set({ phase: "paused" });
    this.options.onEffect({ type: "stop" });
  }

  /** Resumes the current sentence from its model playback (tries are kept). */
  resume() {
    if (this.state.phase !== "paused") {
      return;
    }
    this.playModel();
  }

  toggle() {
    if (this.state.phase === "paused") {
      this.resume();
    } else if (this.state.phase === "idle" || this.state.phase === "done") {
      this.start(this.state.phase === "done" ? 0 : this.state.sentence);
    } else {
      this.pause();
    }
  }

  exit() {
    this.clearTimer();
    this.set({ phase: "idle" });
    this.options.onEffect({ type: "stop" });
  }

  dispose() {
    this.clearTimer();
  }
}
