import { describe, expect, it } from "vitest";

import {
  barWidth,
  bandTone,
  difficultyBand,
  discriminationBand,
  dominantDistractor,
  flagTone,
  formatDecimal,
  formatDuration,
  formatPercent,
  pctValue,
  rateToPercent,
  reliabilityBand,
  sortFlags,
  sortParticipants
} from "@/features/quiz-reports/lib/report-format";
import type { LiveReportItem, LiveReportParticipant } from "@/types/api";

describe("number formatting", () => {
  it("formats percent, decimals and durations per locale", () => {
    expect(formatPercent(72.5, "pt-BR", 1)).toBe("72,5%");
    expect(formatPercent(72.5, "en-US", 1)).toBe("72.5%");
    expect(formatPercent(null, "pt-BR")).toBe("–");
    expect(formatDecimal(0.734, "pt-BR")).toBe("0,73");
    expect(formatDuration(3200, "pt-BR")).toBe("3,2 s");
    expect(formatDuration(12_400, "en-US")).toBe("12 s");
    expect(formatDuration(65_000, "pt-BR")).toBe("1 min 05 s");
    expect(formatDuration(null, "pt-BR")).toBe("–");
  });

  it("converts rates (0..1) and clamps percentages (0..100)", () => {
    expect(rateToPercent(0.42)).toBeCloseTo(42);
    expect(rateToPercent(42)).toBe(42);
    expect(rateToPercent(null)).toBeNull();
    expect(pctValue(130)).toBe(100);
    expect(pctValue(-1)).toBe(0);
  });

  it("bar width keeps a visible sliver for small non-zero values", () => {
    expect(barWidth(0)).toBe(0);
    expect(barWidth(0.2)).toBe(1.5);
    expect(barWidth(50)).toBe(50);
    expect(barWidth(5, 10)).toBe(50);
  });
});

describe("psychometric bands (PLANO §14.3)", () => {
  it("difficulty p", () => {
    expect(difficultyBand(0.29)).toBe("hard");
    expect(difficultyBand(0.3)).toBe("ideal");
    expect(difficultyBand(0.8)).toBe("ideal");
    expect(difficultyBand(0.85)).toBe("easy");
    expect(difficultyBand(0.95)).toBe("too_easy");
    expect(difficultyBand(null)).toBeNull();
  });

  it("discrimination D", () => {
    expect(discriminationBand(-0.1)).toBe("negative");
    expect(discriminationBand(0.1)).toBe("review");
    expect(discriminationBand(0.3)).toBe("good");
    expect(discriminationBand(0.4)).toBe("excellent");
  });

  it("KR-20", () => {
    expect(reliabilityBand(0.7)).toBe("acceptable");
    expect(reliabilityBand(0.5)).toBe("low");
    expect(reliabilityBand(null)).toBeNull();
  });

  it("flags are ordered by severity with a tone each", () => {
    expect(sortFlags(["too_easy", "negative_discrimination", "too_hard"])).toEqual(["negative_discrimination", "too_hard", "too_easy"]);
    expect(flagTone("distractor_dominant")).toBe("danger");
    expect(flagTone("low_discrimination")).toBe("warning");
    expect(flagTone("too_easy")).toBe("neutral");
    expect(bandTone("ready")).toBe("success");
    expect(bandTone("insufficient_data")).toBe("neutral");
  });
});

describe("dominantDistractor", () => {
  const base: LiveReportItem = {
    position: 1,
    item_type: "single_choice",
    prompt: "?",
    scored: true,
    answered: 10,
    n_correct: 3,
    p: 0.3,
    discrimination: 0.1,
    avg_ms: 1000,
    median_ms: 900,
    flags: [],
    options: [
      { key: "A", text: "a", correct: true, count: 3, pct: 30, upper_pct: null, lower_pct: null },
      { key: "B", text: "b", correct: false, count: 6, pct: 60, upper_pct: null, lower_pct: null },
      { key: "C", text: "c", correct: false, count: 1, pct: 10, upper_pct: null, lower_pct: null }
    ],
    domain: null
  };

  it("returns the wrong option that beats the correct one", () => {
    expect(dominantDistractor(base)?.key).toBe("B");
  });

  it("returns null when the correct option leads", () => {
    const options = base.options.map((option) => (option.key === "A" ? { ...option, count: 7 } : option));
    expect(dominantDistractor({ ...base, options })).toBeNull();
  });
});

describe("sortParticipants", () => {
  const people: LiveReportParticipant[] = [
    { participant_id: "1", display_name: "Bruna", is_guest: false, rank: 2, score: 800, correct: 4, answered: 5, score_pct: 80, avg_ms: 3000 },
    { participant_id: "2", display_name: "álvaro", is_guest: true, rank: 1, score: 900, correct: 5, answered: 5, score_pct: 100, avg_ms: null },
    { participant_id: "3", display_name: "Caio", is_guest: false, rank: 3, score: 500, correct: 2, answered: 5, score_pct: 40, avg_ms: 1500 }
  ];

  it("sorts by rank, name (locale-aware), score and time with nulls last", () => {
    expect(sortParticipants(people, "rank", "asc").map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(sortParticipants(people, "display_name", "asc", "pt-BR").map((p) => p.display_name)).toEqual(["álvaro", "Bruna", "Caio"]);
    expect(sortParticipants(people, "score", "desc").map((p) => p.score)).toEqual([900, 800, 500]);
    expect(sortParticipants(people, "avg_ms", "asc").map((p) => p.avg_ms)).toEqual([1500, 3000, null]);
    expect(sortParticipants(people, "avg_ms", "desc").map((p) => p.avg_ms)).toEqual([3000, 1500, null]);
  });
});
