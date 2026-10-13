import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ListenRepeatMachine, REPEAT_CUE_MS, REPEAT_RESULT_MS, type RepeatEffect } from "@/features/reading/lib/listen-repeat";

function create(sentenceCount = 2) {
  const effects: RepeatEffect[] = [];
  const machine = new ListenRepeatMachine({
    sentenceCount,
    onEffect: (effect) => effects.push(effect)
  });
  return {
    machine,
    effects,
    types: () => effects.map((effect) => effect.type)
  };
}

const blob = new Blob(["x"]);

describe("ListenRepeatMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs model → cue → recording → assessing → result → next sentence on a pass", () => {
    const { machine, effects, types } = create(2);
    machine.start();
    expect(machine.state.phase).toBe("model");
    expect(effects[0]).toEqual({ type: "play_model", sentence: 0 });

    machine.modelEnded();
    expect(machine.state.phase).toBe("cue");
    vi.advanceTimersByTime(REPEAT_CUE_MS - 1);
    expect(machine.state.phase).toBe("cue");
    vi.advanceTimersByTime(1);
    expect(machine.state.phase).toBe("recording");
    expect(effects[1]).toEqual({ type: "start_recording", sentence: 0 });

    machine.recordingCaptured(blob, "recording.webm");
    expect(machine.state.phase).toBe("assessing");
    expect(effects[2]).toMatchObject({
      type: "assess",
      sentence: 0,
      filename: "recording.webm"
    });

    machine.assessed(0.9);
    expect(machine.state).toMatchObject({
      phase: "result",
      tries: 1,
      lastScore: 0.9,
      passed: true
    });
    vi.advanceTimersByTime(REPEAT_RESULT_MS);
    expect(machine.state).toMatchObject({
      phase: "model",
      sentence: 1,
      tries: 0
    });
    expect(types()).toEqual(["play_model", "start_recording", "assess", "play_model"]);
  });

  it("repeats a failed sentence up to three times, then moves on", () => {
    const { machine, effects } = create(2);
    machine.start();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      machine.modelEnded();
      vi.advanceTimersByTime(REPEAT_CUE_MS);
      machine.recordingCaptured(blob, "r.webm");
      machine.assessed(0.5);
      expect(machine.state).toMatchObject({
        phase: "result",
        sentence: 0,
        tries: attempt,
        passed: false
      });
      vi.advanceTimersByTime(REPEAT_RESULT_MS);
    }
    expect(machine.state).toMatchObject({
      phase: "model",
      sentence: 1,
      tries: 0
    });
    expect(effects.filter((effect) => effect.type === "play_model" && effect.sentence === 0)).toHaveLength(3);
  });

  it("finishes after the last sentence", () => {
    const { machine, types } = create(1);
    machine.start();
    machine.modelEnded();
    vi.advanceTimersByTime(REPEAT_CUE_MS);
    machine.recordingCaptured(blob, "r.webm");
    machine.assessed(1);
    vi.advanceTimersByTime(REPEAT_RESULT_MS);
    expect(machine.state.phase).toBe("done");
    expect(types()).toContain("finished");
  });

  it("pauses (stopping timers) and resumes the same sentence from the model", () => {
    const { machine, types } = create(2);
    machine.start();
    machine.modelEnded();
    machine.pause();
    expect(machine.state.phase).toBe("paused");
    expect(types()).toEqual(["play_model", "stop"]);
    vi.advanceTimersByTime(REPEAT_CUE_MS * 2);
    expect(machine.state.phase).toBe("paused");
    // Events from the interrupted phase are ignored while paused.
    machine.recordingCaptured(blob, "r.webm");
    machine.assessed(1);
    expect(machine.state.phase).toBe("paused");

    machine.resume();
    expect(machine.state).toMatchObject({ phase: "model", sentence: 0 });
    expect(types()).toEqual(["play_model", "stop", "play_model"]);
    machine.toggle();
    expect(machine.state.phase).toBe("paused");
    machine.toggle();
    expect(machine.state.phase).toBe("model");
  });

  it("stops on failure and on exit", () => {
    const { machine, types } = create(2);
    machine.start();
    machine.modelEnded();
    vi.advanceTimersByTime(REPEAT_CUE_MS);
    machine.fail();
    expect(machine.state.phase).toBe("paused");
    machine.exit();
    expect(machine.state.phase).toBe("idle");
    expect(types()).toEqual(["play_model", "start_recording", "stop", "stop"]);
    machine.start(1);
    expect(machine.state.sentence).toBe(1);
  });

  it("is done immediately without sentences", () => {
    const { machine, types } = create(0);
    machine.start();
    expect(machine.state.phase).toBe("done");
    expect(types()).toEqual(["finished"]);
  });
});
