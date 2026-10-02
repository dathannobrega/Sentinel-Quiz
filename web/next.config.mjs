import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Single source for the Next.js responses. Behind nginx these are NOT re-added by the proxy for
// the app locations (only HSTS is); nginx sets the same values for /api via
// docker/nginx/api-security-headers.conf — keep both lists in sync.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" }
];

function readApiOrigin() {
  return String(process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_ORIGIN || "").trim();
}

/** @type {(phase: string) => import('next').NextConfig} */
export default function nextConfig(phase) {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  // When no API origin is configured the browser calls same-origin /api. In production nginx
  // proxies it; in `next dev` (or when BACKEND_ORIGIN is set explicitly) Next rewrites it.
  const backendOrigin = String(process.env.BACKEND_ORIGIN || (isDev ? "http://127.0.0.1:8000" : ""))
    .trim()
    .replace(/\/+$/, "");
  const enableApiRewrite = !readApiOrigin() && Boolean(backendOrigin);

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    output: "standalone",
    async headers() {
      return [
        { source: "/:path*", headers: securityHeaders },
        // Service worker (PWA): always revalidated so a new deploy reaches installed apps.
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
            { key: "Content-Type", value: "application/javascript; charset=utf-8" }
          ]
        }
      ];
    },
    async rewrites() {
      if (!enableApiRewrite) {
        return [];
      }
      return [{ source: "/api/:path*", destination: `${backendOrigin}/api/:path*` }];
    }
  };
}
