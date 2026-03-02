export interface SentinelRuntimeConfig {
  apiOrigin: string;
}

declare global {
  interface Window {
    __SENTINEL_RUNTIME__?: SentinelRuntimeConfig;
  }
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function getRuntimeConfig(): SentinelRuntimeConfig {
  if (typeof window !== "undefined" && window.__SENTINEL_RUNTIME__) {
    return window.__SENTINEL_RUNTIME__;
  }

  return {
    apiOrigin: normalizeOrigin(process.env.NEXT_PUBLIC_API_ORIGIN || "")
  };
}
