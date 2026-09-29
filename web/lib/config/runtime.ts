export interface SentinelRuntimeConfig {
  apiOrigin: string;
  /**
   * Browser-side timeout (ms) for AI tutor requests, from TUTOR_CLIENT_TIMEOUT_MS on the server.
   * Absent/null means "use the default" (DEFAULT_TUTOR_TIMEOUT_MS).
   */
  tutorTimeoutMs?: number | null;
}

declare global {
  interface Window {
    __SENTINEL_RUNTIME__?: SentinelRuntimeConfig;
  }
}

/** Default tutor timeout: comfortably above the backend's GEMINI_TIMEOUT_SECONDS (20s) + retry. */
export const DEFAULT_TUTOR_TIMEOUT_MS = 45_000;
/** Accepted range for TUTOR_CLIENT_TIMEOUT_MS (5s .. 5min); anything else falls back to the default. */
export const TUTOR_TIMEOUT_BOUNDS = { min: 5_000, max: 300_000 } as const;

export function normalizeOrigin(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

/** Parses a timeout in ms; returns null when missing, non-numeric or out of bounds. */
export function parseTutorTimeoutMs(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const rounded = Math.round(parsed);
  if (rounded < TUTOR_TIMEOUT_BOUNDS.min || rounded > TUTOR_TIMEOUT_BOUNDS.max) {
    return null;
  }
  return rounded;
}

/**
 * Client-side runtime config. The server injects `window.__SENTINEL_RUNTIME__` per request
 * (see app/layout.tsx), so the API origin and tutor timeout can change without rebuilding the
 * image. NEXT_PUBLIC_API_ORIGIN (inlined at build time) remains a fallback for the origin.
 */
export function getRuntimeConfig(): SentinelRuntimeConfig {
  if (typeof window !== "undefined" && window.__SENTINEL_RUNTIME__) {
    const injected = window.__SENTINEL_RUNTIME__;
    return {
      apiOrigin: normalizeOrigin(injected.apiOrigin),
      tutorTimeoutMs: parseTutorTimeoutMs(injected.tutorTimeoutMs)
    };
  }

  return {
    apiOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_API_ORIGIN),
    tutorTimeoutMs: null
  };
}
