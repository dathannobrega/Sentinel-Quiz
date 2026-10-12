import { describe, expect, it } from "vitest";

import { countWords, findTokenIndexAtChar, findWordIndexAtTime, mapWordsToTokens, tokenizeDisplay } from "@/features/reading/lib/tokenize";

describe("tokenizeDisplay", () => {
  it("returns word tokens whose offsets round-trip into the text", () => {
    const text = "Security awareness training isn't optional — it's well-known (SY0-701).";
    const tokens = tokenizeDisplay(text);
    expect(tokens.map((token) => token.text)).toEqual(["Security", "awareness", "training", "isn't", "optional", "it's", "well-known", "SY0-701"]);
    for (const token of tokens) {
      expect(text.slice(token.start, token.end)).toBe(token.text);
    }
  });

  it("is Unicode-aware and ignores surrounding punctuation", () => {
    expect(tokenizeDisplay("Ação, café; naïve!").map((token) => token.text)).toEqual(["Ação", "café", "naïve"]);
    expect(tokenizeDisplay("'quoted' -dash- ...").map((token) => token.text)).toEqual(["quoted", "dash"]);
    expect(countWords("one two  three")).toBe(3);
  });
});

describe("mapWordsToTokens", () => {
  const text = "Phishing, well-known attacks: 42% succeed.";
  const tokens = tokenizeDisplay(text);
  // ["Phishing", "well-known", "attacks", "42", "succeed"]

  it("maps TTS words onto tokens by overlapping char ranges, merging split hyphenated words", () => {
    const words = [
      { text: "Phishing", start: 0, end: 0.5, char_start: 0, char_end: 8 },
      { text: "well", start: 0.6, end: 0.8, char_start: 10, char_end: 14 },
      { text: "known", start: 0.8, end: 1.1, char_start: 15, char_end: 20 },
      { text: "attacks", start: 1.2, end: 1.7, char_start: 21, char_end: 28 },
      { text: "forty-two percent", start: 1.9, end: 2.6, char_start: 30, char_end: 33 },
      { text: "succeed", start: 2.7, end: 3.2, char_start: 34, char_end: 41 }
    ];
    const timings = mapWordsToTokens(words, tokens);
    expect(timings).toHaveLength(tokens.length);
    expect(timings[0]).toEqual({ start: 0, end: 0.5, matched: true });
    expect(timings[1]).toEqual({ start: 0.6, end: 1.1, matched: true });
    expect(timings[2]).toEqual({ start: 1.2, end: 1.7, matched: true });
    expect(timings[3]).toEqual({ start: 1.9, end: 2.6, matched: true });
    expect(timings[4]).toEqual({ start: 2.7, end: 3.2, matched: true });
  });

  it("lets tokens without a TTS word inherit the previous word's time", () => {
    const words = [
      { text: "Phishing", start: 0, end: 0.5, char_start: 0, char_end: 8 },
      { text: "attacks", start: 1.2, end: 1.7, char_start: 21, char_end: 28 }
    ];
    const timings = mapWordsToTokens(words, tokens);
    expect(timings[1]).toEqual({ start: 0, end: 0.5, matched: false });
    expect(timings[2].matched).toBe(true);
    expect(timings[3]).toEqual({ start: 1.2, end: 1.7, matched: false });
    expect(timings[4]).toEqual({ start: 1.2, end: 1.7, matched: false });
  });

  it("anchors leading unmatched tokens at the first word's start and tolerates unsorted input", () => {
    const words = [
      { text: "succeed", start: 2.7, end: 3.2, char_start: 34, char_end: 41 },
      { text: "attacks", start: 1.2, end: 1.7, char_start: 21, char_end: 28 }
    ];
    const timings = mapWordsToTokens(words, tokens);
    expect(timings[0]).toEqual({ start: 1.2, end: 1.2, matched: false });
    expect(timings[2]).toEqual({ start: 1.2, end: 1.7, matched: true });
    expect(timings[4]).toEqual({ start: 2.7, end: 3.2, matched: true });
    expect(mapWordsToTokens([], tokens).every((timing) => timing.start === 0 && !timing.matched)).toBe(true);
  });
});

describe("findWordIndexAtTime", () => {
  const timings = [0, 0.5, 1.2, 1.9, 2.7].map((start) => ({ start }));

  it("binary-searches the last word starting at or before the time", () => {
    expect(findWordIndexAtTime(timings, -0.1)).toBe(-1);
    expect(findWordIndexAtTime(timings, 0)).toBe(0);
    expect(findWordIndexAtTime(timings, 0.49)).toBe(0);
    expect(findWordIndexAtTime(timings, 0.5)).toBe(1);
    expect(findWordIndexAtTime(timings, 1.95)).toBe(3);
    expect(findWordIndexAtTime(timings, 99)).toBe(4);
    expect(findWordIndexAtTime([], 1)).toBe(-1);
  });
});

describe("findTokenIndexAtChar", () => {
  const tokens = tokenizeDisplay("Hello, big world.");

  it("maps a speech boundary charIndex onto the token containing or following it", () => {
    expect(findTokenIndexAtChar(tokens, 0)).toBe(0);
    expect(findTokenIndexAtChar(tokens, 3)).toBe(0);
    expect(findTokenIndexAtChar(tokens, 5)).toBe(1); // the comma: next token
    expect(findTokenIndexAtChar(tokens, 7)).toBe(1);
    expect(findTokenIndexAtChar(tokens, 11)).toBe(2);
    expect(findTokenIndexAtChar(tokens, 40)).toBe(2);
  });
});
