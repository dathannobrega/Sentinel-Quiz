import { describe, expect, it } from "vitest";

import { computeRms, createSilenceTracker, repeatRecordingCapSeconds, SILENCE_FRAME_MS } from "@/features/reading/lib/silence-detector";

/** Feeds a sequence of RMS values, one per 100 ms frame; returns the verdicts. */
function run(levels: number[], maxMs = 10_000) {
  const tracker = createSilenceTracker({ maxMs });
  return levels.map((rms, index) => tracker.feed(rms, (index + 1) * SILENCE_FRAME_MS));
}

describe("createSilenceTracker", () => {
  it("ignores silence before any voice was heard", () => {
    const verdicts = run(new Array(30).fill(0));
    expect(verdicts.every((verdict) => verdict === "listening")).toBe(true);
  });

  it("needs 200 ms above the threshold before counting voice", () => {
    expect(run([0.1, 0, 0, 0])).toEqual(["listening", "listening", "listening", "listening"]);
    expect(run([0.1, 0.1, 0])).toEqual(["listening", "voice", "voice"]);
  });

  it("stops after 1.2 s of silence once voice was detected, and not before", () => {
    const voice = [0.1, 0.1, 0.1];
    const silence = new Array(11).fill(0.005);
    const verdicts = run([...voice, ...silence, 0.005]);
    expect(verdicts.slice(0, 3)).toEqual(["listening", "voice", "voice"]);
    expect(verdicts.slice(3, 14).every((verdict) => verdict === "voice")).toBe(true);
    expect(verdicts[14]).toBe("stop");
  });

  it("resets the silence run when voice comes back", () => {
    const verdicts = run([0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 0, 0]);
    expect(verdicts.includes("stop")).toBe(false);
  });

  it("stops at the hard cap even without voice", () => {
    const verdicts = run(new Array(50).fill(0), 4_000);
    expect(verdicts.indexOf("stop")).toBe(39);
    expect(verdicts.slice(40).every((verdict) => verdict === "stop")).toBe(true);
  });

  it("computes the RMS of a frame", () => {
    expect(computeRms([])).toBe(0);
    expect(computeRms([0, 0, 0])).toBe(0);
    expect(computeRms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5, 6);
  });

  it("caps the recording at max(4 s, 2 × duration + 2 s)", () => {
    expect(repeatRecordingCapSeconds(0.5)).toBe(4);
    expect(repeatRecordingCapSeconds(1)).toBe(4);
    expect(repeatRecordingCapSeconds(3)).toBe(8);
    expect(repeatRecordingCapSeconds(null)).toBe(4);
  });
});
