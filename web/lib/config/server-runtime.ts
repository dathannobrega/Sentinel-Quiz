import { normalizeOrigin, parseTutorTimeoutMs, type SentinelRuntimeConfig } from "@/lib/config/runtime";

/**
 * Reads the API origin at request time on the server.
 * - API_ORIGIN (runtime, not inlined): preferred; change it without rebuilding.
 * - NEXT_PUBLIC_API_ORIGIN: legacy/build-time fallback.
 * Empty string means "same origin" (nginx or the dev rewrite proxies /api).
 */
export function getServerApiOrigin(): string {
  const env = process.env;
  return normalizeOrigin(env["API_ORIGIN"] || env["NEXT_PUBLIC_API_ORIGIN"] || "");
}

/**
 * TUTOR_CLIENT_TIMEOUT_MS (runtime, bracket access so it is never inlined at build time).
 * Invalid or out-of-range values (outside 5000..300000) are ignored -> client default (45s).
 */
export function getServerTutorTimeoutMs(): number | null {
  return parseTutorTimeoutMs(process.env["TUTOR_CLIENT_TIMEOUT_MS"]);
}

export function getServerRuntimeConfig(): SentinelRuntimeConfig {
  return { apiOrigin: getServerApiOrigin(), tutorTimeoutMs: getServerTutorTimeoutMs() };
}

/** Serializes the runtime config for an inline <script>, escaping `<` to avoid breaking out. */
export function serializeRuntimeConfig(config: SentinelRuntimeConfig): string {
  return `window.__SENTINEL_RUNTIME__ = ${JSON.stringify(config).replace(/</g, "\\u003c")};`;
}
