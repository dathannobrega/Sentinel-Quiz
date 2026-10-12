/**
 * Display tokens for read-along highlighting.
 *
 * The block text is split into words (maximal runs of letters/digits, joined by apostrophes or
 * hyphens) with their character offsets, so TTS word timings (`char_start`/`char_end` into the
 * same text) can be mapped onto the rendered `<span data-word>` elements.
 */

export interface DisplayToken {
  text: string;
  /** Offset of the first character in the block text. */
  start: number;
  /** Offset after the last character (exclusive). */
  end: number;
}

/** Timing of one display token (seconds into the block audio). */
export interface WordTiming {
  start: number;
  end: number;
  /** False when the token had no TTS word and inherited its neighbour's time. */
  matched: boolean;
}

/** The subset of a TTS word the mapper needs. */
export interface TimedCharRange {
  start: number;
  end: number;
  char_start: number;
  char_end: number;
}

// A word is a run of letters/digits; inner apostrophes (both kinds) and hyphens keep it together
// ("don't", "well-known", "SY0-701"). Punctuation around the word is never part of it.
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Splits text into word tokens with character offsets (whitespace and punctuation are skipped). */
export function tokenizeDisplay(text: string): DisplayToken[] {
  const tokens: DisplayToken[] = [];
  for (const match of text.matchAll(WORD_PATTERN)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Maps TTS words onto display tokens by overlapping character ranges. Tolerant on purpose: the
 * synthesizer may split or merge words differently ("well-known" as two tokens, "U.S." as one).
 * A token covered by several TTS words spans from the first start to the last end; a token with no
 * TTS word inherits the previous token's time (or the first word's start at the beginning).
 */
export function mapWordsToTokens(ttsWords: readonly TimedCharRange[], tokens: readonly DisplayToken[]): WordTiming[] {
  const sorted = [...ttsWords].sort((a, b) => a.char_start - b.char_start);
  const timings: WordTiming[] = [];
  let cursor = 0;
  let previous: WordTiming | null = null;

  for (const token of tokens) {
    // TTS words are sorted; skip the ones that end before this token starts.
    while (cursor < sorted.length && sorted[cursor].char_end <= token.start) {
      cursor += 1;
    }
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (let i = cursor; i < sorted.length && sorted[i].char_start < token.end; i += 1) {
      const word = sorted[i];
      if (overlaps(word.char_start, word.char_end, token.start, token.end)) {
        start = Math.min(start, word.start);
        end = Math.max(end, word.end);
      }
    }
    let timing: WordTiming;
    if (Number.isFinite(start) && Number.isFinite(end)) {
      timing = { start, end: Math.max(start, end), matched: true };
    } else if (previous) {
      timing = { start: previous.start, end: previous.end, matched: false };
    } else {
      const first = sorted[0];
      const at = first ? first.start : 0;
      timing = { start: at, end: at, matched: false };
    }
    timings.push(timing);
    previous = timing;
  }
  return timings;
}

/**
 * Index of the word being spoken at `time`: the last word whose start is <= time (binary search
 * over the non-decreasing starts). -1 before the first word.
 */
export function findWordIndexAtTime(timings: readonly Pick<WordTiming, "start">[], time: number): number {
  let low = 0;
  let high = timings.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timings[mid].start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Token index for a character offset (speechSynthesis `onboundary` gives `charIndex` at the start
 * of each spoken word): the token containing the offset, else the first token after it.
 */
export function findTokenIndexAtChar(tokens: readonly DisplayToken[], charIndex: number): number {
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const token = tokens[mid];
    if (charIndex < token.start) {
      high = mid - 1;
    } else if (charIndex >= token.end) {
      low = mid + 1;
    } else {
      return mid;
    }
  }
  return low < tokens.length ? low : tokens.length - 1;
}

/** Number of countable words in a text (used for `words_read`). */
export function countWords(text: string): number {
  return tokenizeDisplay(text).length;
}
