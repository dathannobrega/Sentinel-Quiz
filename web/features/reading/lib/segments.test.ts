import { describe, expect, it } from "vitest";

import { buildSegmentTimings, findSegmentIndexAtTime, nextSegmentOffset, shiftSegmentWords, type ReceivedSegment } from "@/features/reading/lib/segments";
import { findWordIndexAtTime, tokenizeDisplay } from "@/features/reading/lib/tokenize";
import type { ReadingStreamSegment } from "@/types/api";

const TEXT = "One two. Three four.";

function segment(index: number, charStart: number, charEnd: number, words: Array<[string, number, number, number, number]>): ReadingStreamSegment {
  return {
    type: "segment",
    index,
    audio_id: `a${index}`,
    audio_url: `/api/reading/audio/a${index}`,
    char_start: charStart,
    char_end: charEnd,
    duration_seconds: 1,
    cached: false,
    words: words.map(([text, start, end, cs, ce]) => ({
      text,
      start,
      end,
      char_start: cs,
      char_end: ce
    }))
  };
}

describe("segments", () => {
  const first = segment(0, 0, 8, [
    ["One", 0, 0.3, 0, 3],
    ["two", 0.4, 0.7, 4, 7]
  ]);
  const second = segment(1, 9, 20, [
    ["Three", 0, 0.4, 9, 14],
    ["four", 0.5, 0.9, 15, 19]
  ]);

  it("shifts the words of a segment onto the block timeline", () => {
    expect(shiftSegmentWords(second, 1).map((word) => [word.start, word.end, word.char_start])).toEqual([
      [1, 1.4, 9],
      [1.5, 1.9, 15]
    ]);
    expect(nextSegmentOffset([])).toBe(0);
    expect(nextSegmentOffset([{ url: "", duration: 1.5, offset: 0 }])).toBe(1.5);
  });

  it("gives tokens past the received segments no time yet", () => {
    const tokens = tokenizeDisplay(TEXT);
    const received: ReceivedSegment[] = [
      {
        url: "blob:0",
        duration: 1,
        offset: 0,
        index: 0,
        charStart: 0,
        charEnd: 8,
        words: shiftSegmentWords(first, 0)
      }
    ];
    const timings = buildSegmentTimings(received, tokens);
    expect(timings[0]).toEqual({ start: 0, end: 0.3, matched: true });
    expect(timings[1]).toEqual({ start: 0.4, end: 0.7, matched: true });
    expect(timings[2].start).toBe(Number.POSITIVE_INFINITY);
    // While buffering, the time past the first sentence still highlights its last word.
    expect(findWordIndexAtTime(timings, 1.5)).toBe(1);

    received.push({
      url: "blob:1",
      duration: 1,
      offset: 1,
      index: 1,
      charStart: 9,
      charEnd: 20,
      words: shiftSegmentWords(second, 1)
    });
    const complete = buildSegmentTimings(received, tokens);
    expect(complete[2]).toEqual({ start: 1, end: 1.4, matched: true });
    expect(findWordIndexAtTime(complete, 1.6)).toBe(3);
    expect(buildSegmentTimings([], tokens).every((timing) => timing.start === Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("finds the segment of a timeline position", () => {
    const list = [
      { url: "", duration: 2, offset: 0 },
      { url: "", duration: 3, offset: 2 },
      { url: "", duration: 1, offset: 5 }
    ];
    expect(findSegmentIndexAtTime(list, 0)).toBe(0);
    expect(findSegmentIndexAtTime(list, 1.99)).toBe(0);
    expect(findSegmentIndexAtTime(list, 2)).toBe(1);
    expect(findSegmentIndexAtTime(list, 9)).toBe(2);
    expect(findSegmentIndexAtTime([], 1)).toBe(-1);
  });
});
