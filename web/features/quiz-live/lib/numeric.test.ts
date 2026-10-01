import { describe, expect, it } from "vitest";

import {
  statDecimals,
  binIndexFor,
  formatNumber,
  formatNumberInput,
  formatWithUnit,
  histogramBins,
  initialSliderValue,
  numericInputError,
  parseLocaleNumber,
  rangeFraction,
  snapToStep,
  stepDecimals
} from "@/features/quiz-live/lib/numeric";

describe("parseLocaleNumber", () => {
  it("reads pt-BR: dot groups thousands, comma is the decimal mark", () => {
    expect(parseLocaleNumber("1.234,5", "pt-BR")).toBe(1234.5);
    expect(parseLocaleNumber("1.005", "pt-BR")).toBe(1005);
    expect(parseLocaleNumber("12,75", "pt-BR")).toBe(12.75);
    expect(parseLocaleNumber("1.234.567", "pt-BR")).toBe(1234567);
    expect(parseLocaleNumber(" -3,5 ", "pt-BR")).toBe(-3.5);
    expect(parseLocaleNumber("256", "pt-BR")).toBe(256);
    expect(parseLocaleNumber(",5", "pt-BR")).toBe(0.5);
    expect(parseLocaleNumber("1 234,5", "pt-BR")).toBe(1234.5);
  });

  it("reads en-US: comma groups thousands, dot is the decimal mark", () => {
    expect(parseLocaleNumber("1,234.5", "en-US")).toBe(1234.5);
    expect(parseLocaleNumber("1.005", "en-US")).toBe(1.005);
    expect(parseLocaleNumber("1,005", "en-US")).toBe(1005);
    expect(parseLocaleNumber("-0.25", "en-US")).toBe(-0.25);
  });

  it("reads a lone separator that is not a thousands group as the decimal mark", () => {
    expect(parseLocaleNumber("2.5", "pt-BR")).toBe(2.5);
    expect(parseLocaleNumber("2,5", "en-US")).toBe(2.5);
  });

  it("rejects what is not a finite number", () => {
    for (const value of ["", "  ", "abc", "1,2,3", "1.234,5,6", "--1", "1e5", "12a", "1.23.4", "."]) {
      expect(parseLocaleNumber(value, "pt-BR"), value).toBeNull();
    }
    expect(parseLocaleNumber("1.234,5", "en-US")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats per locale, with and without grouping", () => {
    expect(formatNumber(1234.5, "pt-BR")).toBe("1.234,5");
    expect(formatNumber(1234.5, "en-US")).toBe("1,234.5");
    expect(formatNumber(null, "pt-BR")).toBe("–");
    expect(formatNumberInput(1234.5, "pt-BR", 0.5)).toBe("1234,5");
    expect(formatNumberInput(1234.5, "en-US", 1)).toBe("1235");
    expect(formatWithUnit(256, "bits", "pt-BR")).toBe("256 bits");
    expect(formatWithUnit(12.5, "", "pt-BR")).toBe("12,5");
  });

  it("derives decimals from the step", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals(1e-7)).toBe(7);
    expect(stepDecimals(null)).toBe(6);
  });
});

describe("range checks and slider", () => {
  const spec = { min: 0, max: 1000, step: 1 };

  it("flags invalid and out-of-range input before sending", () => {
    expect(numericInputError("", spec, "pt-BR")).toBeNull();
    expect(numericInputError("500", spec, "pt-BR")).toBeNull();
    expect(numericInputError("1.001", spec, "pt-BR")).toBe("out_of_range");
    expect(numericInputError("-1", spec, "pt-BR")).toBe("out_of_range");
    expect(numericInputError("abc", spec, "pt-BR")).toBe("invalid");
  });

  it("snaps to the step inside the range", () => {
    expect(snapToStep(12.4, spec)).toBe(12);
    expect(snapToStep(2000, spec)).toBe(1000);
    expect(snapToStep(0.3, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
    expect(snapToStep(7.77, { min: 0, max: 10, step: null })).toBe(7.77);
    expect(initialSliderValue({ min: 0, max: 5, step: 2 })).toBe(2);
  });
});

describe("histogram", () => {
  it("bins like the server (20 slices, clamped at the edges)", () => {
    expect(binIndexFor(256, 0, 1000)).toBe(5);
    expect(binIndexFor(900, 0, 1000)).toBe(18);
    expect(binIndexFor(1000, 0, 1000)).toBe(19);
    expect(binIndexFor(-5, 0, 1000)).toBe(0);
    expect(binIndexFor(5, 5, 5)).toBe(0);
  });

  it("returns every bin with its value range and relative height", () => {
    const bins = histogramBins({ min: 0, max: 1000, bins: [0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0] });
    expect(bins).toHaveLength(20);
    expect(bins[5]).toMatchObject({ from: 250, to: 300, count: 2, height: 1 });
    expect(bins[18]).toMatchObject({ from: 900, to: 950, count: 1, height: 0.5 });
    expect(bins[0]?.height).toBe(0);
  });

  it("places markers along the range", () => {
    expect(rangeFraction(256, 0, 1000)).toBeCloseTo(0.256);
    expect(rangeFraction(-10, 0, 10)).toBe(0);
    expect(rangeFraction(3, 3, 3)).toBe(0.5);
  });
});

describe("statDecimals", () => {
  it("keeps the projector mean short for the range", () => {
    expect(statDecimals(0, 1000)).toBe(1);
    expect(statDecimals(0, 10)).toBe(2);
    expect(statDecimals(0, 0.5)).toBe(4);
  });
});
