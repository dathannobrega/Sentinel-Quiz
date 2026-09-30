/**
 * Pure helpers for the host's room operations (Incremento 4 §4): the capacity warning (RF-1205)
 * and the pre-event check (RF-1115). No React here, so the thresholds and mappings are unit tested.
 */
import type { LivePreflight, LivePreflightCheck, LivePreflightStatus } from "@/types/api/live";

/** The host is warned at 80% of the room limit (RF-1205). */
export const CAPACITY_WARN_RATIO = 0.8;

/** Rooms from this size run the pre-event check on their own when the lobby opens (RF-1115). */
export const PREFLIGHT_AUTO_RUN_FROM = 300;

export type CapacityLevel = "ok" | "near" | "full";

/**
 * `near` from 80% of `max`, `full` at the limit. Unknown or invalid limits never warn (older
 * servers do not send `max_participants`).
 */
export function capacityLevel(count: number, max: number | null | undefined): CapacityLevel {
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0 || !Number.isFinite(count) || count < 0) {
    return "ok";
  }
  if (count >= max) {
    return "full";
  }
  return count >= Math.ceil(max * CAPACITY_WARN_RATIO) ? "near" : "ok";
}

/** Whole percentage of the room already taken (0..100, capped). */
export function capacityPercent(count: number, max: number | null | undefined): number {
  if (typeof max !== "number" || max <= 0 || !Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((count / max) * 100));
}

export function shouldAutoRunPreflight(maxParticipants: number | null | undefined): boolean {
  return typeof maxParticipants === "number" && maxParticipants >= PREFLIGHT_AUTO_RUN_FROM;
}

/** Known check keys and detail codes with dedicated copy; anything else uses the generic text. */
export const PREFLIGHT_KEYS = ["database", "capacity", "content", "realtime_bus", "rate_limit", "token_keys", "event_loop"] as const;
export const PREFLIGHT_DETAILS = [
  "slow",
  "unreachable",
  "near_limit",
  "above_platform_limit",
  "moderation_pending",
  "quiz_blocked",
  "memory_bus_with_workers",
  "memory_backend",
  "dev_key",
  "lagging"
] as const;

export type PreflightKey = (typeof PREFLIGHT_KEYS)[number] | "other";
export type PreflightDetail = (typeof PREFLIGHT_DETAILS)[number] | "ok" | "other";

export function preflightKey(check: Pick<LivePreflightCheck, "key">): PreflightKey {
  return (PREFLIGHT_KEYS as readonly string[]).includes(check.key) ? (check.key as PreflightKey) : "other";
}

/** i18n detail code: "ok" for an empty detail, "other" for codes this client does not know. */
export function preflightDetail(check: Pick<LivePreflightCheck, "detail">): PreflightDetail {
  if (!check.detail) {
    return "ok";
  }
  return (PREFLIGHT_DETAILS as readonly string[]).includes(check.detail) ? (check.detail as PreflightDetail) : "other";
}

/** Unknown statuses count as a warning (never silently "ok"). */
export function normalizePreflightStatus(status: unknown): LivePreflightStatus {
  return status === "ok" || status === "warn" || status === "fail" ? status : "warn";
}

const SEVERITY: Record<LivePreflightStatus, number> = { fail: 0, warn: 1, ok: 2 };

/** Failures first, then warnings, then the rest (stable within a group). */
export function sortPreflightChecks(checks: LivePreflightCheck[]): LivePreflightCheck[] {
  return checks
    .map((check, index) => ({ check, index }))
    .sort((a, b) => SEVERITY[normalizePreflightStatus(a.check.status)] - SEVERITY[normalizePreflightStatus(b.check.status)] || a.index - b.index)
    .map((entry) => entry.check);
}

/** "ready" only when the server says so AND no check failed or warned (defensive). */
export function preflightOverall(result: Pick<LivePreflight, "status" | "checks">): "ready" | "attention" {
  const clean = result.checks.every((check) => normalizePreflightStatus(check.status) === "ok");
  return result.status === "ready" && clean ? "ready" : "attention";
}

/** Numeric/text values for interpolation in the detail copy (`{participants}`, `{latency_ms}`...). */
export function preflightValues(check: Pick<LivePreflightCheck, "values">): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(check.values ?? {})) {
    if (typeof value === "number" || typeof value === "string") {
      values[key] = value;
    }
  }
  return values;
}
