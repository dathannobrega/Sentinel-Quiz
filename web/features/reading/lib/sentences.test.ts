import { describe, expect, it } from "vitest";

import { mapAssessedWordsToTokens, nextSentenceIndex, sentenceText, sentenceTokenRange, shiftWords } from "@/features/reading/lib/sentences";
import { tokenizeDisplay } from "@/features/reading/lib/tokenize";
import type { ReadingAssessedWord, ReadingSentence } from "@/types/api";

const TEXT = "Phishing is common. Attackers spoof trusted senders. Report it fast.";
const SENTENCES: ReadingSentence[] = [
  { index: 0, char_start: 0, char_end: 19 },
  { index: 1, char_start: 20, char_end: 52 },
  { index: 2, char_start: 53, char_end: 68 }
];

function word(index: number, text: string, start: number, status: ReadingAssessedWord["status"] = "ok"): ReadingAssessedWord {
  return { index, text, char_start: start, char_end: start + text.length, status, heard: null, confidence: null, start: null, end: null, expected_ipa: null, heard_ipa: null };
}

describe("drill sentence mapping", () => {
  const tokens = tokenizeDisplay(TEXT);

  it("finds the display tokens and the text of a sentence", () => {
    expect(sentenceText(TEXT, SENTENCES[1])).toBe("Attackers spoof trusted senders.");
    expect(sentenceTokenRange(tokens, SENTENCES[1])).toEqual({ first: 3, last: 6 });
    expect(sentenceTokenRange(tokens, SENTENCES[2])).toEqual({ first: 7, last: 9 });
    expect(sentenceTokenRange(tokens, { char_start: 68, char_end: 68 })).toEqual({ first: 0, last: -1 });
  });

  it("offsets sentence-relative words by char_offset onto the block tokens", () => {
    // Words of sentence 1 relative to the sentence ("Attackers spoof trusted senders.").
    const words = [word(0, "Attackers", 0), word(1, "spoof", 10, "mispronounced"), word(2, "trusted", 16, "missed"), word(3, "senders", 24)];
    expect(shiftWords(words, 20).map((item) => [item.char_start, item.char_end])).toEqual([
      [20, 29],
      [30, 35],
      [36, 43],
      [44, 51]
    ]);
    const marks = mapAssessedWordsToTokens(words, 20, tokens);
    expect([...marks.keys()]).toEqual([3, 4, 5, 6]);
    expect(marks.get(4)?.status).toBe("mispronounced");
    expect(marks.get(5)?.status).toBe("missed");
    expect(tokens[4].text).toBe("spoof");
    // The original words are untouched.
    expect(words[1].char_start).toBe(10);
  });

  it("moves to the next sentence and stops at the end of the block", () => {
    expect(nextSentenceIndex(SENTENCES, 0)).toBe(1);
    expect(nextSentenceIndex(SENTENCES, 2)).toBeNull();
    expect(nextSentenceIndex(SENTENCES, 7)).toBeNull();
  });
});
