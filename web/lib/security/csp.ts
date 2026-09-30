/**
 * WebSocket origins for the live quiz socket (`/api/live/ws`): the page's own host (`'self'` does
 * not cover ws/wss in every browser) and the ws(s) form of a cross-origin API.
 */
export function webSocketSources(apiOrigin: string, pageOrigin: string): string[] {
  const sources = new Set<string>();
  for (const origin of [pageOrigin, apiOrigin]) {
    if (!origin) {
      continue;
    }
    try {
      const url = new URL(origin);
      // Host comes from request headers: accept only plain host[:port] (no directive injection).
      if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(url.host)) {
        continue;
      }
      if (url.protocol === "https:") {
        sources.add(`wss://${url.host}`);
      } else if (url.protocol === "http:") {
        sources.add(`ws://${url.host}`);
      }
    } catch {
      // Ignore malformed origins.
    }
  }
  return Array.from(sources);
}

/** Builds the per-request Content-Security-Policy (contract §7). Used by proxy.ts (Next 16 request proxy). */
export function buildContentSecurityPolicy(nonce: string, apiOrigin: string, isDev: boolean, extraConnectSources: string[] = []): string {
  const connectSources = ["'self'", apiOrigin, ...extraConnectSources, isDev ? "ws: wss:" : ""].filter(Boolean).join(" ");
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce'd Next.js bootstrap scripts load their chunks. React dev tooling
    // needs eval, production never gets 'unsafe-eval'.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // React `style` props and the Google Fonts stylesheet need inline/remote styles.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connectSources}`,
    `frame-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ];
  return directives.join("; ");
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}
