/** Builds the per-request Content-Security-Policy (contract §7). Used by proxy.ts (Next 16 request proxy). */
export function buildContentSecurityPolicy(nonce: string, apiOrigin: string, isDev: boolean): string {
  const connectSources = ["'self'", apiOrigin, isDev ? "ws: wss:" : ""].filter(Boolean).join(" ");
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
