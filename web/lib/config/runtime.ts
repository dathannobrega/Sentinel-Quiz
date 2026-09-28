export interface SentinelRuntimeConfig {
  apiOrigin: string;
}

declare global {
  interface Window {
    __SENTINEL_RUNTIME__?: SentinelRuntimeConfig;
  }
}

export function normalizeOrigin(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

/**
 * Client-side runtime config. The server injects `window.__SENTINEL_RUNTIME__` per request
 * (see app/layout.tsx), so the API origin can change without rebuilding the image.
 * NEXT_PUBLIC_API_ORIGIN (inlined at build time) remains a fallback.
 */
export function getRuntimeConfig(): SentinelRuntimeConfig {
  if (typeof window !== "undefined" && window.__SENTINEL_RUNTIME__) {
    return window.__SENTINEL_RUNTIME__;
  }

  return {
    apiOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_API_ORIGIN)
  };
}
