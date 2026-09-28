import { describe, expect, it } from "vitest";

import { normalizeErrorResponse, parseRetryAfter, setApiErrorLocale } from "@/lib/api/errors";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { queryRetryDelay, shouldRetryQuery } from "@/lib/query/retry";
import { sanitizeNextPath } from "@/lib/auth/session";

setApiErrorLocale("en-US");

describe("normalizeErrorResponse", () => {
  it("reads the contract envelope (detail string + code)", () => {
    const error = normalizeErrorResponse({ status: 404, body: JSON.stringify({ detail: "Session not found.", code: "http_404" }) });
    expect(error.message).toBe("Session not found.");
    expect(error.code).toBe("http_404");
    expect(error.status).toBe(404);
  });

  it("never renders [object Object] for legacy FastAPI 422 detail arrays", () => {
    const body = JSON.stringify({
      detail: [
        { loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" },
        { loc: ["body", "password"], msg: "String should have at least 8 characters", type: "string_too_short" }
      ]
    });
    const error = normalizeErrorResponse({ status: 422, body });
    expect(error.message).toBe("email: value is not a valid email address; password: String should have at least 8 characters");
    expect(error.message).not.toContain("[object Object]");
    expect(error.code).toBe("validation_error");
    expect(error.fieldErrors.map((item) => item.field)).toEqual(["email", "password"]);
  });

  it("keeps the readable 422 detail and exposes structured errors from the new envelope", () => {
    const body = JSON.stringify({
      detail: "email: invalid",
      code: "validation_error",
      errors: [{ loc: ["body", "email"], msg: "invalid", type: "value_error" }]
    });
    const error = normalizeErrorResponse({ status: 422, body });
    expect(error.message).toBe("email: invalid");
    expect(error.fieldErrors).toEqual([{ field: "email", message: "invalid", type: "value_error" }]);
  });

  it("unwraps dict details ({code, message})", () => {
    const body = JSON.stringify({ detail: { code: "tutor_quota_exceeded", message: "Daily tutor quota reached." } });
    const error = normalizeErrorResponse({ status: 429, body, retryAfter: "120" });
    expect(error.code).toBe("tutor_quota_exceeded");
    expect(error.message).toBe("Daily tutor quota reached.");
    expect(error.retryAfterSeconds).toBe(120);
  });

  it("falls back to `message` and to localized status copy", () => {
    expect(normalizeErrorResponse({ status: 429, body: JSON.stringify({ message: "Slow down", code: "rate_limited" }) }).message).toBe(
      "Slow down"
    );
    const empty = normalizeErrorResponse({ status: 503, body: "" });
    expect(empty.message).toMatch(/temporarily unavailable/i);
    expect(empty.code).toBe("http_503");
  });

  it("does not leak HTML error pages", () => {
    const error = normalizeErrorResponse({
      status: 502,
      body: "<html><body><h1>502 Bad Gateway</h1></body></html>",
      contentType: "text/html"
    });
    expect(error.message).not.toContain("<");
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("5")).toBe(5);
    expect(parseRetryAfter(null)).toBeNull();
    const future = new Date(Date.now() + 10_000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThanOrEqual(8);
  });
});

describe("query retry policy", () => {
  it("never retries 4xx except a single 429", () => {
    const notFound = normalizeErrorResponse({ status: 404, body: "" });
    const rateLimited = normalizeErrorResponse({ status: 429, body: "", retryAfter: "2" });
    const server = normalizeErrorResponse({ status: 500, body: "" });
    expect(shouldRetryQuery(0, notFound)).toBe(false);
    expect(shouldRetryQuery(0, rateLimited)).toBe(true);
    expect(shouldRetryQuery(1, rateLimited)).toBe(false);
    expect(queryRetryDelay(0, rateLimited)).toBe(2000);
    expect(shouldRetryQuery(0, server)).toBe(true);
    expect(shouldRetryQuery(1, server)).toBe(false);
  });
});

describe("security helpers", () => {
  it("builds a nonce CSP without unsafe-eval in production", () => {
    const csp = buildContentSecurityPolicy("abc", "https://api.example.com", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(buildContentSecurityPolicy("abc", "", true)).toContain("'unsafe-eval'");
  });

  it("only accepts relative next paths after login", () => {
    expect(sanitizeNextPath("/admin?tab=users")).toBe("/admin?tab=users");
    expect(sanitizeNextPath("https://evil.example")).toBeNull();
    expect(sanitizeNextPath("//evil.example")).toBeNull();
    expect(sanitizeNextPath("/login")).toBeNull();
  });
});
