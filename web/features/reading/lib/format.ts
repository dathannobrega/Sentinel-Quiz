import type { AppLocale } from "@/lib/i18n/core";

/** 0–1 score to a whole percentage (0–100). */
export function scoreToPercent(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

/** Grouped integer in the UI locale ("12.000" / "12,000"). */
export function formatCount(value: number | null | undefined, locale: AppLocale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "0";
  }
  return Math.round(value).toLocaleString(locale);
}

/** Whole minutes from seconds, rounded to the nearest minute. */
export function secondsToMinutes(seconds: number | null | undefined): number {
  if (!seconds || !Number.isFinite(seconds)) {
    return 0;
  }
  return Math.round(seconds / 60);
}

/** "0:42" style clock for short durations. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

/** Playback speed label without trailing zeros ("1", "0.9", "1.25"). */
export function formatSpeed(speed: number): string {
  return String(Math.round(speed * 100) / 100);
}
