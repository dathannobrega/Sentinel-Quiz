import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";

/**
 * 1. Per-request CSP with a nonce (contract §7). Next.js reads the CSP request header and applies
 *    the nonce to its own scripts; app/layout.tsx applies it to the inline runtime-config script.
 * 2. Coarse /admin guard: without the session cookie we redirect to /login?next=... before
 *    rendering. The real role check still happens via /api/auth/me (client) and the backend.
 */

const DEFAULT_SESSION_COOKIE = "sentinel_session";

function readApiOrigin(): string {
  const env = process.env;
  return String(env["API_ORIGIN"] || env["NEXT_PUBLIC_API_ORIGIN"] || "")
    .trim()
    .replace(/\/+$/, "");
}

function isAdminGuardEnabled(request: NextRequest, apiOrigin: string): boolean {
  const mode = String(process.env["ADMIN_ROUTE_GUARD"] || "auto").toLowerCase();
  if (mode === "off" || mode === "false") {
    return false;
  }
  if (mode === "on" || mode === "true") {
    return true;
  }
  // "auto": the session cookie is only visible here when the API shares our host
  // (same origin via nginx / dev rewrite). For a cross-site API rely on the client-side guard.
  if (!apiOrigin) {
    return true;
  }
  try {
    return new URL(apiOrigin).hostname === request.nextUrl.hostname;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest) {
  const apiOrigin = readApiOrigin();
  const { pathname, search } = request.nextUrl;

  if ((pathname === "/admin" || pathname.startsWith("/admin/")) && isAdminGuardEnabled(request, apiOrigin)) {
    const cookieName = process.env["AUTH_COOKIE_NAME"] || DEFAULT_SESSION_COOKIE;
    if (!request.cookies.get(cookieName)?.value) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
      return NextResponse.redirect(loginUrl);
    }
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(nonce, apiOrigin, process.env.NODE_ENV !== "production");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
