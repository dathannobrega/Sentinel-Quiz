import { describe, expect, it } from "vitest";

import { moveItem, optionsInOrder, orderingSlots } from "@/features/quiz-live/lib/ordering";
import type { PublicOption, WordCloudWord } from "@/features/quiz-live/lib/protocol";
import { cleanWords, layoutWordCloud, normalizeWordKey, sortWords, type PlacedWord } from "@/features/quiz-live/lib/word-cloud";

describe("word input rules", () => {
  it("normalizes like the server (case, accents, spaces, trailing punctuation)", () => {
    expect(normalizeWordKey("  Segurança  da   Informação! ")).toBe("seguranca da informacao");
    expect(normalizeWordKey("MFA")).toBe("mfa");
    expect(normalizeWordKey("x".repeat(40))).toHaveLength(25);
  });

  it("trims, drops empty words, counts repeats once and caps at max", () => {
    expect(cleanWords(["  Senha ", "SENHA", "", "MFA"], 3)).toEqual(["Senha", "MFA"]);
    expect(cleanWords(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(cleanWords(["   ", ""], 3)).toEqual([]);
    expect(cleanWords(["y".repeat(30)], 1)[0]).toHaveLength(25);
  });
});

function words(count: number): WordCloudWord[] {
  return Array.from({ length: count }, (_, index) => ({ text: `palavra${index}`, key: `palavra${index}`, n: count - index }));
}

function overlapping(a: PlacedWord, b: PlacedWord): boolean {
  return Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height;
}

describe("layoutWordCloud", () => {
  const box = { width: 1000, height: 560 };

  it("is deterministic: same words and counts, same picture (whatever the input order)", () => {
    const input = words(30);
    const first = layoutWordCloud(input, box);
    const second = layoutWordCloud([...input].reverse(), box);
    expect(second).toEqual(first);
  });

  it("puts the most sent word in the centre with the largest font", () => {
    const placed = layoutWordCloud(words(12), box);
    const top = placed[0] as PlacedWord;
    expect(top.key).toBe("palavra0");
    expect(top.x).toBeCloseTo(500, 0);
    expect(top.y).toBeCloseTo(280, 0);
    expect(Math.max(...placed.map((word) => word.fontSize))).toBe(top.fontSize);
  });

  it("never overlaps words and keeps them inside the box", () => {
    const placed = layoutWordCloud(words(60), box);
    expect(placed.length).toBeGreaterThan(40);
    for (const [index, word] of placed.entries()) {
      expect(word.x - word.width / 2).toBeGreaterThanOrEqual(0);
      expect(word.x + word.width / 2).toBeLessThanOrEqual(box.width);
      expect(word.y - word.height / 2).toBeGreaterThanOrEqual(0);
      expect(word.y + word.height / 2).toBeLessThanOrEqual(box.height);
      for (const other of placed.slice(index + 1)) {
        expect(overlapping(word, other), `${word.key} × ${other.key}`).toBe(false);
      }
    }
  });

  it("returns nothing for an empty cloud and ranks ties alphabetically", () => {
    expect(layoutWordCloud([], box)).toEqual([]);
    expect(sortWords([{ text: "b", key: "b", n: 1 }, { text: "a", key: "a", n: 1 }, { text: "c", key: "c", n: 2 }]).map((word) => word.key)).toEqual(["c", "a", "b"]);
  });
});

describe("ordering helpers", () => {
  const options: PublicOption[] = [
    { id: "o_c", text: "Contenção", index: 0 },
    { id: "o_p", text: "Preparação", index: 1 },
    { id: "o_d", text: "Detecção", index: 2 }
  ];

  it("moveItem moves one entry and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 1, 9)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("orderingSlots compares the person's order with the correct one", () => {
    const slots = orderingSlots(options, ["o_p", "o_d", "o_c"], ["o_d", "o_p", "o_c"], [33.3, null, 66.7]);
    expect(slots.map((slot) => [slot.correct?.text, slot.mine?.text, slot.hit, slot.pct])).toEqual([
      ["Preparação", "Detecção", false, 33.3],
      ["Detecção", "Preparação", false, null],
      ["Contenção", "Contenção", true, 66.7]
    ]);
    // Hidden on the device: no slots at all.
    expect(orderingSlots(options, [], ["o_d"])).toEqual([]);
    expect(orderingSlots(options, ["o_p", "o_d", "o_c"], null)[0]?.hit).toBeNull();
  });

  it("optionsInOrder follows the ids (received order without them)", () => {
    expect(optionsInOrder(options, ["o_d", "o_c"]).map((option) => option.id)).toEqual(["o_d", "o_c", "o_p"]);
    expect(optionsInOrder(options, null).map((option) => option.id)).toEqual(["o_c", "o_p", "o_d"]);
  });
});
