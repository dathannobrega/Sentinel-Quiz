/**
 * Sentence drill helpers. The API splits each block into sentences (offsets into the block text);
 * a drill assessment is sentence-relative and carries `char_offset`, the sentence start in the block.
 */

import type { DisplayToken } from "@/features/reading/lib/tokenize";
import type { ReadingAssessedWord, ReadingSentence } from "@/types/api";

export interface TokenRange {
  /** First display token of the sentence (inclusive). */
  first: number;
  /** Last display token of the sentence (inclusive); -1 when the sentence has no word. */
  last: number;
}

/** Display tokens that start inside `[char_start, char_end)` of the sentence. */
export function sentenceTokenRange(tokens: readonly DisplayToken[], sentence: Pick<ReadingSentence, "char_start" | "char_end">): TokenRange {
  let first = -1;
  let last = -1;
  tokens.forEach((token, index) => {
    if (token.start >= sentence.char_start && token.start < sentence.char_end) {
      if (first < 0) {
        first = index;
      }
      last = index;
    }
  });
  return first < 0 ? { first: 0, last: -1 } : { first, last };
}

/** Text of a sentence in its block. */
export function sentenceText(blockText: string, sentence: Pick<ReadingSentence, "char_start" | "char_end">): string {
  return blockText.slice(sentence.char_start, sentence.char_end);
}

/** Shifts sentence-relative word offsets to block offsets (`char_offset` = sentence start in the block). */
export function shiftWords(words: readonly ReadingAssessedWord[], charOffset: number): ReadingAssessedWord[] {
  return words.map((word) => ({ ...word, char_start: word.char_start + charOffset, char_end: word.char_end + charOffset }));
}

/**
 * Maps the words of a (sentence) assessment onto the display tokens of the block: token index →
 * assessed word with block offsets. A token takes the first assessed word overlapping it.
 */
export function mapAssessedWordsToTokens(
  words: readonly ReadingAssessedWord[],
  charOffset: number,
  tokens: readonly DisplayToken[]
): Map<number, ReadingAssessedWord> {
  const marks = new Map<number, ReadingAssessedWord>();
  const shifted = shiftWords(words, charOffset).sort((a, b) => a.char_start - b.char_start);
  let cursor = 0;
  tokens.forEach((token, tokenIndex) => {
    while (cursor < shifted.length && shifted[cursor].char_end <= token.start) {
      cursor += 1;
    }
    const word = shifted[cursor];
    if (word && word.char_start < token.end && token.start < word.char_end) {
      marks.set(tokenIndex, word);
    }
  });
  return marks;
}

/** Index of the next sentence, or null at the end of the block. */
export function nextSentenceIndex(sentences: readonly ReadingSentence[], current: number): number | null {
  const position = sentences.findIndex((sentence) => sentence.index === current);
  if (position < 0 || position + 1 >= sentences.length) {
    return null;
  }
  return sentences[position + 1].index;
}

/** Drill pass mark: the sentence auto-advances at this overall score. */
export const DRILL_PASS_SCORE = 0.85;
/** After this many attempts below the pass mark, the drill offers to move on. */
export const DRILL_MAX_TRIES = 3;
