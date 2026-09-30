import { describe, expect, it } from "vitest";

import { avatarPattern, hashSeed } from "@/components/quiz-kit/avatar";
import { findFittingSize } from "@/components/quiz-kit/fit-text";
import { staggerDelay } from "@/components/quiz-kit/motion";
import { buildQrGeometry } from "@/components/quiz-kit/qr-code";
import { hotkeyFor } from "@/features/quiz-present/hooks/use-stage-hooks";
import {
  formatJoinCode,
  isValidJoinCode,
  normalizeJoinCode,
  optionLetter,
  optionShape
} from "@/features/quiz-live/lib/protocol";

describe("QR geometry", () => {
  it("keeps a 4-module quiet zone and places the three finders", () => {
    const geometry = buildQrGeometry("https://quiz.example.com/j/482913");
    expect(geometry.size).toBeGreaterThanOrEqual(21 + 8);
    expect(geometry.finders).toEqual([
      [4, 4],
      [geometry.size - 11, 4],
      [4, geometry.size - 11]
    ]);
    expect(geometry.bands.filter(Boolean).length).toBeGreaterThan(3);
  });
});

describe("avatar", () => {
  it("is deterministic per seed and symmetric", () => {
    const a = avatarPattern("seed-1");
    expect(avatarPattern("seed-1")).toEqual(a);
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
    for (let row = 0; row < 5; row += 1) {
      expect(a.cells[row * 5]).toBe(a.cells[row * 5 + 4]);
      expect(a.cells[row * 5 + 1]).toBe(a.cells[row * 5 + 3]);
    }
  });
});

describe("fit text", () => {
  it("finds the largest size that fits", () => {
    expect(findFittingSize(10, 100, (size) => size <= 42)).toBeGreaterThanOrEqual(41.5);
    expect(findFittingSize(10, 100, (size) => size <= 42)).toBeLessThanOrEqual(42);
    expect(findFittingSize(10, 100, () => true)).toBe(100);
    expect(findFittingSize(10, 100, () => false)).toBe(10);
  });
});

describe("stagger", () => {
  it("caps a list entrance at 400 ms", () => {
    expect(staggerDelay(3, 4, 0.06)).toBeCloseTo(0.18);
    expect(staggerDelay(19, 20, 0.06)).toBeLessThanOrEqual(0.4);
  });
});

describe("join code helpers", () => {
  it("normalizes pasted PINs and links", () => {
    expect(normalizeJoinCode("482 913")).toBe("482913");
    expect(normalizeJoinCode("https://quiz.example.com/j/482913")).toBe("482913");
    expect(normalizeJoinCode("48-29-13-99")).toBe("482913");
    expect(isValidJoinCode("482913")).toBe(true);
    expect(isValidJoinCode("082913")).toBe(false);
    expect(formatJoinCode("482913")).toBe("482 913");
  });

  it("pairs every option index with a letter and a shape", () => {
    expect([0, 1, 2, 3, 4, 5].map(optionLetter).join("")).toBe("ABCDEF");
    expect(optionShape(0)).toBe("triangle");
    expect(optionShape(5)).toBe("cross");
  });
});

describe("presenter hotkeys", () => {
  const key = (value: string, extra: Partial<KeyboardEvent> = {}) => ({ key: value, code: "", ctrlKey: false, metaKey: false, altKey: false, ...extra });
  it("maps keys (and clicker PageDown) to commands", () => {
    expect(hotkeyFor(key(" "))).toBe("advance");
    expect(hotkeyFor(key("ArrowRight"))).toBe("advance");
    expect(hotkeyFor(key("PageDown"))).toBe("advance");
    expect(hotkeyFor(key("l"))).toBe("lock");
    expect(hotkeyFor(key("R"))).toBe("reveal");
    expect(hotkeyFor(key("b"))).toBe("leaderboard");
    expect(hotkeyFor(key("f"))).toBe("fullscreen");
    expect(hotkeyFor(key("?"))).toBe("help");
    expect(hotkeyFor(key("p"))).toBe("pause");
    expect(hotkeyFor(key("+"))).toBe("extend");
    expect(hotkeyFor(key("r", { ctrlKey: true }))).toBeNull();
  });
});
