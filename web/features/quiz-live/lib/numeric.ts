/**
 * Numeric items (T06, CONTRATO-INCREMENTO-5.md §2–§6): locale-aware parsing of what a person types,
 * display formatting and the histogram geometry shared by the phone, the stage, the presenter and
 * the report. The device parses the input in the UI locale and sends a JSON `number`, so the server
 * never has to guess whether "1.005" is one thousand and five or one point zero zero five.
 */
import { NUMERIC_BINS, type NumericResults, type NumericSpec } from "@/features/quiz-live/lib/protocol";

interface Separators {
  group: string;
  decimal: string;
}

/** pt-* uses "1.234,5"; everything else here (en-US) "1,234.5". */
export function numberSeparators(locale: string): Separators {
  return locale.toLowerCase().startsWith("pt") ? { group: ".", decimal: "," } : { group: ",", decimal: "." };
}

/** "1.234.567" → "1234567" when every group after the first has exactly 3 digits; else null. */
function stripGrouping(value: string, group: string): string | null {
  if (!value.includes(group)) {
    return value;
  }
  const parts = value.split(group);
  const [head, ...rest] = parts;
  if (!head || head.length > 3 || rest.some((part) => part.length !== 3)) {
    return null;
  }
  return parts.join("");
}

/**
 * Parses a number typed in `locale`. Accepts grouping ("1.234,5" in pt-BR, "1,234.5" in en-US),
 * a leading sign and spaces. When the only separator does not form valid thousands groups it is
 * read as the decimal mark ("2.5" in pt-BR = 2,5), which is what people mean on a phone keypad.
 * Returns null for anything that is not a finite number.
 */
export function parseLocaleNumber(input: string, locale: string): number | null {
  const compact = String(input ?? "").replace(/[\s  ']/g, "");
  if (!compact) {
    return null;
  }
  const negative = compact.startsWith("-") || compact.startsWith("−");
  const body = compact.replace(/^[-+−]/, "");
  if (!body || !/^[\d.,]+$/.test(body) || !/\d/.test(body)) {
    return null;
  }
  const { group, decimal } = numberSeparators(locale);
  let normalized: string | null;
  if (body.includes(decimal)) {
    const parts = body.split(decimal);
    if (parts.length !== 2 || (parts[1] ?? "").includes(group)) {
      return null;
    }
    const integer = stripGrouping(parts[0] ?? "", group);
    normalized = integer === null ? null : `${integer || "0"}.${parts[1] || "0"}`;
  } else if (body.includes(group)) {
    const integer = stripGrouping(body, group);
    // A lone separator that is not a thousands group reads as the decimal mark.
    normalized = integer ?? (body.split(group).length === 2 ? body.replace(group, ".") : null);
  } else {
    normalized = body;
  }
  if (normalized === null) {
    return null;
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return null;
  }
  return negative ? -value : value;
}

/** Decimal places written in a finite number (0.25 → 2, 1e-7 → 7, 3 → 0). */
function decimalsIn(value: number): number {
  const text = Math.abs(value).toString();
  const exponent = text.match(/e-(\d+)$/);
  if (exponent) {
    return Math.min(10, Number(exponent[1]));
  }
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(10, text.length - dot - 1);
}

/** Decimal places implied by a step (0.25 → 2, 1 → 0, free input → up to 6). */
export function stepDecimals(step: number | null | undefined): number {
  if (step === null || step === undefined || !Number.isFinite(step) || step <= 0) {
    return 6;
  }
  return decimalsIn(step);
}

/** Decimals for the mean on a projector: enough for the range, never "508,6667". */
export function statDecimals(min: number | null | undefined, max: number | null | undefined): number {
  const span = Math.abs((max ?? 0) - (min ?? 0));
  if (span >= 100) {
    return 1;
  }
  return span >= 1 ? 2 : 4;
}

/** Display with grouping: 1234.5 → "1.234,5" (pt-BR). */
export function formatNumber(value: number | null | undefined, locale: string, maximumFractionDigits = 6): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
}

/** Value for the text field (no grouping, so editing never trips over separators): "1234,5". */
export function formatNumberInput(value: number, locale: string, step: number | null | undefined): string {
  return new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: stepDecimals(step) }).format(value);
}

/** "256 bits", "12,5 %" → keeps the unit exactly as the author wrote it. */
export function formatWithUnit(value: number | null | undefined, unit: string | null | undefined, locale: string, maximumFractionDigits = 6): string {
  const text = formatNumber(value, locale, maximumFractionDigits);
  const suffix = (unit ?? "").trim();
  return suffix && text !== "–" ? `${text} ${suffix}` : text;
}

export type NumericInputError = "invalid" | "out_of_range";

/** Validation of the phone input before sending (the server rejects the same cases). */
export function numericInputError(raw: string, spec: Pick<NumericSpec, "min" | "max">, locale: string): NumericInputError | null {
  if (!raw.trim()) {
    return null;
  }
  const value = parseLocaleNumber(raw, locale);
  if (value === null) {
    return "invalid";
  }
  return value < spec.min || value > spec.max ? "out_of_range" : null;
}

/** Nearest step inside the range (slider). Free input keeps the value, only clamped. */
export function snapToStep(value: number, spec: Pick<NumericSpec, "min" | "max" | "step">): number {
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  if (!spec.step || spec.step <= 0) {
    return clamped;
  }
  const steps = Math.round((clamped - spec.min) / spec.step);
  const snapped = spec.min + steps * spec.step;
  // Round away float noise (0.1 + 0.2) at the precision the step and the minimum are written in.
  const decimals = Math.max(decimalsIn(spec.step), decimalsIn(spec.min));
  return Math.min(spec.max, Number(snapped.toFixed(decimals)));
}

/** A sensible starting point for the slider: the middle of the range, on a step. */
export function initialSliderValue(spec: Pick<NumericSpec, "min" | "max" | "step">): number {
  return snapToStep(spec.min + (spec.max - spec.min) / 2, spec);
}

/** Bin of a value on a histogram of `bins` equal slices over [min, max] (mirrors the server). */
export function binIndexFor(value: number, min: number, max: number, bins: number = NUMERIC_BINS): number {
  const span = max - min;
  const index = span > 0 ? Math.floor(((value - min) / span) * bins) : 0;
  return Math.min(Math.max(index, 0), bins - 1);
}

export interface HistogramBin {
  index: number;
  from: number;
  to: number;
  count: number;
  /** 0..1 of the tallest bin (bar height). */
  height: number;
}

/** The server bins with their value ranges, ready to draw. */
export function histogramBins(result: Pick<NumericResults, "min" | "max" | "bins">): HistogramBin[] {
  const count = result.bins.length || NUMERIC_BINS;
  const width = (result.max - result.min) / count;
  const tallest = Math.max(0, ...result.bins);
  return Array.from({ length: count }, (_, index) => {
    const value = result.bins[index] ?? 0;
    return {
      index,
      from: result.min + index * width,
      to: result.min + (index + 1) * width,
      count: value,
      height: tallest > 0 ? value / tallest : 0
    };
  });
}

/** Position of a value along [min, max] as 0..1 (for markers). */
export function rangeFraction(value: number, min: number, max: number): number {
  const span = max - min;
  if (!(span > 0)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, (value - min) / span));
}
