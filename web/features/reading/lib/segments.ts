/**
 * Sentence segments of a streamed block: the shared timeline (segment offset + segment time) and
 * the word timings of the display tokens on that timeline. The server speaks one sentence per
 * segment; `words` of a segment carry block character offsets and segment-relative times.
 */

import { mapWordsToTokens, type DisplayToken, type WordTiming } from "@/features/reading/lib/tokenize";
import type { ReadingStreamSegment, ReadingTtsWord } from "@/types/api";

/** A segment the player can play: blob URL plus its place on the block timeline. */
export interface PlayerSegment {
  url: string;
  /** Seconds, from the server (the element's own duration wins once known). */
  duration: number;
  /** Start of this segment on the block timeline (seconds). */
  offset: number;
}

/** A received segment with its audio and the words shifted onto the block timeline. */
export interface ReceivedSegment extends PlayerSegment {
  index: number;
  charStart: number;
  charEnd: number;
  /** Words with block character offsets and block-timeline times. */
  words: ReadingTtsWord[];
}

/** Shifts the words of a stream segment onto the block timeline starting at `offset`. */
export function shiftSegmentWords(segment: ReadingStreamSegment, offset: number): ReadingTtsWord[] {
  return segment.words.map((word) => ({
    ...word,
    start: word.start + offset,
    end: word.end + offset
  }));
}

/** Offset of the next segment: the end of the previous one on the timeline. */
export function nextSegmentOffset(segments: readonly PlayerSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.offset + Math.max(0, last.duration) : 0;
}

const UNKNOWN: WordTiming = {
  start: Number.POSITIVE_INFINITY,
  end: Number.POSITIVE_INFINITY,
  matched: false
};

/**
 * Word timings of the display tokens from the segments received so far. Tokens past the last
 * received segment have no time yet (`Infinity`, never current) so the highlight does not jump
 * ahead while the next sentence is still buffering.
 */
export function buildSegmentTimings(segments: readonly ReceivedSegment[], tokens: readonly DisplayToken[]): WordTiming[] {
  if (segments.length === 0) {
    return tokens.map(() => UNKNOWN);
  }
  const words = segments.flatMap((segment) => segment.words);
  const coveredEnd = Math.max(...segments.map((segment) => segment.charEnd));
  const timings = mapWordsToTokens(words, tokens);
  return timings.map((timing, index) => (tokens[index].start >= coveredEnd ? UNKNOWN : timing));
}

/** Index of the segment that contains timeline second `time` (the last one starting at or before it). */
export function findSegmentIndexAtTime(segments: readonly PlayerSegment[], time: number): number {
  let found = 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index].offset <= time) {
      found = index;
    } else {
      break;
    }
  }
  return segments.length ? found : -1;
}

/** Total duration of the known segments (the block duration once the stream is complete). */
export function segmentsDuration(segments: readonly PlayerSegment[]): number {
  return nextSegmentOffset(segments);
}
