import { NextResponse, type NextRequest } from "next/server";

import { buildContentSecurityPolicy, createNonce, webSocketSources } from "@/lib/security/csp";

/**
 * 1. Per-request CSP with a nonce (contract §7). Next.js reads the CSP request header and applies
 *    the nonce to its own scripts; app/layout.tsx applies it to the inline runtime-config script.
 * 2. Coarse /admin, /quizzes and /present guard: without the session cookie we redirect to /login?next=... before
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

/** Authenticated-only areas: /admin and the Sentinel Arena authoring/reports (/quizzes). */
const GUARDED_PREFIXES = ["/admin", "/quizzes", "/present"];

function isGuardedPath(pathname: string): boolean {
  return GUARDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * The display-only projector window (`/present/{id}?view=display`, token in the URL fragment) may
 * run on a machine without the host's login; the display token authenticates its WebSocket.
 * Participant routes (/j) are public and never guarded.
 */
function isDisplayOnly(request: NextRequest): boolean {
  const params = request.nextUrl.searchParams;
  return request.nextUrl.pathname.startsWith("/present/") && (params.get("view") === "display" || params.has("display"));
}

/** Public origin of this request (behind nginx the forwarded headers carry it). */
function readPageOrigin(request: NextRequest): string {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  const proto = (request.headers.get("x-forwarded-proto") || request.nextUrl.protocol.replace(/:$/, "")).split(",")[0].trim();
  return host ? `${proto}://${host.split(",")[0].trim()}` : "";
}

export function proxy(request: NextRequest) {
  const apiOrigin = readApiOrigin();
  const { pathname, search } = request.nextUrl;

  if (isGuardedPath(pathname) && !isDisplayOnly(request) && isAdminGuardEnabled(request, apiOrigin)) {
    const cookieName = process.env["AUTH_COOKIE_NAME"] || DEFAULT_SESSION_COOKIE;
    if (!request.cookies.get(cookieName)?.value) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
      return NextResponse.redirect(loginUrl);
    }
  }

  const nonce = createNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    apiOrigin,
    process.env.NODE_ENV !== "production",
    webSocketSources(apiOrigin, readPageOrigin(request))
  );

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
