import type { LiveDomainBand, LiveItemFlag, LiveReportItem, LiveReportParticipant } from "@/types/api";

/**
 * Scales (checked against backend/app/services/live_results.py):
 * - `p`, `discrimination`, `kr20` are fractions in [0, 1] (D in [-1, 1]) → rateToPercent when shown as %;
 * - `answered_rate`, `completion_rate`, `*_pct`, `pct`, `pct_correct` are percentages in [0, 100] → pctValue.
 * Report/issue `position` values are 0-based: add 1 for display.
 */

export function rateToPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return value > 1 ? value : value * 100;
}

export function pctValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, value));
}

export function formatPercent(value: number | null | undefined, locale: string, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}%`;
}

export function formatDecimal(value: number | null | undefined, locale: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatInteger(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "–";
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** 3200 → "3,2 s" (pt-BR) / "3.2 s"; ≥ 60 s → "1 min 05 s". */
export function formatDuration(ms: number | null | undefined, locale: string): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return "–";
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    const digits = seconds < 10 ? 1 : 0;
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(seconds)} s`;
  }
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}

export type DifficultyBand = "hard" | "ideal" | "easy" | "too_easy";

/** PLANO §14.3: < 0.30 hard; 0.30–0.80 ideal; 0.80–0.90 easy; > 0.90 too easy. */
export function difficultyBand(p: number | null | undefined): DifficultyBand | null {
  if (p === null || p === undefined || !Number.isFinite(p)) {
    return null;
  }
  const value = p > 1 ? p / 100 : p;
  if (value < 0.3) return "hard";
  if (value <= 0.8) return "ideal";
  if (value <= 0.9) return "easy";
  return "too_easy";
}

export type DiscriminationBand = "excellent" | "good" | "review" | "negative";

/** PLANO §14.3: ≥ 0.40 excellent; 0.20–0.39 ok; < 0.20 review; < 0 suspicious. */
export function discriminationBand(d: number | null | undefined): DiscriminationBand | null {
  if (d === null || d === undefined || !Number.isFinite(d)) {
    return null;
  }
  if (d < 0) return "negative";
  if (d < 0.2) return "review";
  if (d < 0.4) return "good";
  return "excellent";
}

export type ReliabilityBand = "acceptable" | "low";

export function reliabilityBand(kr20: number | null | undefined): ReliabilityBand | null {
  if (kr20 === null || kr20 === undefined || !Number.isFinite(kr20)) {
    return null;
  }
  return kr20 >= 0.7 ? "acceptable" : "low";
}

export const FLAG_ORDER: LiveItemFlag[] = [
  "negative_discrimination",
  "distractor_dominant",
  "too_hard",
  "low_discrimination",
  "too_easy"
];

export function flagTone(flag: LiveItemFlag): "danger" | "warning" | "neutral" {
  if (flag === "negative_discrimination" || flag === "distractor_dominant") return "danger";
  if (flag === "too_hard" || flag === "low_discrimination") return "warning";
  return "neutral";
}

export function sortFlags(flags: readonly LiveItemFlag[]): LiveItemFlag[] {
  return [...flags].sort((a, b) => FLAG_ORDER.indexOf(a) - FLAG_ORDER.indexOf(b));
}

export function bandTone(band: LiveDomainBand): "success" | "warning" | "danger" | "neutral" {
  if (band === "ready") return "success";
  if (band === "approaching") return "warning";
  if (band === "not_ready") return "danger";
  return "neutral";
}

/** The most chosen wrong option, when it beats the correct one (for the "distractor" callout). */
export function dominantDistractor(item: LiveReportItem): LiveReportItem["options"][number] | null {
  const correctMax = Math.max(0, ...item.options.filter((option) => option.correct).map((option) => option.count));
  const wrong = item.options.filter((option) => !option.correct).sort((a, b) => b.count - a.count);
  const top = wrong[0];
  return top && top.count > correctMax ? top : null;
}

export type ParticipantSortKey = "rank" | "display_name" | "score" | "correct" | "score_pct" | "avg_ms";
export type SortDirection = "asc" | "desc";

export function defaultSortDirection(key: ParticipantSortKey): SortDirection {
  return key === "rank" || key === "display_name" || key === "avg_ms" ? "asc" : "desc";
}

/** Stable sort; nulls (e.g. avg_ms) always last; ties fall back to rank. */
export function sortParticipants(
  list: readonly LiveReportParticipant[],
  key: ParticipantSortKey,
  direction: SortDirection,
  locale = "pt-BR"
): LiveReportParticipant[] {
  const factor = direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return [...list].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    let result = 0;
    if (typeof av === "string" && typeof bv === "string") {
      result = collator.compare(av, bv) * factor;
    } else if (typeof av === "number" && typeof bv === "number") {
      result = (av - bv) * factor;
    }
    return result !== 0 ? result : a.rank - b.rank;
  });
}

/** Width in % for a horizontal bar, with a minimum sliver so non-zero values stay visible. */
export function barWidth(value: number | null | undefined, max = 100): number {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0 || max <= 0) {
    return 0;
  }
  return Math.max(1.5, Math.min(100, (value / max) * 100));
}
