// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, normalizeErrorResponse } from "@/lib/api/errors";
import { LiveLicenseRequiresLoginError, isModerationPending, isQuizBlocked } from "@/lib/api/live-authoring";
import {
  accessChallenge,
  advanceAttempt,
  createChallenge,
  finishAttempt,
  getChallengeInfo,
  getChallengeLeaderboard,
  getChallengeProgress,
  getCurrentAttempt,
  isRetryableError,
  isValidChallengeSlug,
  joinChallenge,
  normalizeChallengeSlug,
  startAttempt,
  submitChallengeAnswer,
  toChallengeAttemptErrorCode,
  toChallengeJoinErrorCode,
  toChallengeOwnerErrorCode,
  updateChallenge
} from "@/lib/api/live-challenge";

function errorFrom(status: number, body: unknown): ApiError {
  return normalizeErrorResponse({ status, body: JSON.stringify(body), contentType: "application/json" });
}

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : undefined };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeChallengeSlug", () => {
  it("follows the server's Crockford decoding", () => {
    expect(normalizeChallengeSlug("7k3qh2xn")).toBe("7K3QH2XN");
    expect(normalizeChallengeSlug("7K3O-H2IL")).toBe("7K30H211");
    expect(normalizeChallengeSlug("https://arena.example/q/7k3qh2xn?x=1")).toBe("7K3QH2XN");
    expect(isValidChallengeSlug(normalizeChallengeSlug("7k3qh2xn"))).toBe(true);
    expect(isValidChallengeSlug(normalizeChallengeSlug("abc"))).toBe(false);
  });
});

describe("owner calls", () => {
  it("creates a challenge with the cookie and the client key", async () => {
    const fetchMock = stubFetch(201, { id: "s1", mode: "self_paced", challenge: { slug: "7K3QH2XN" } });
    const session = await createChallenge({ quiz_id: "q1", closes_at: "2026-10-09T23:59:00.000Z", attempts: 2, feedback: null, leaderboard: true });
    expect(session.id).toBe("s1");
    const { url, init, headers, body } = call(fetchMock);
    expect(url).toContain("/api/live/challenges");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(headers.get("X-Client-Key")).toBeTruthy();
    expect(body).toEqual({ quiz_id: "q1", closes_at: "2026-10-09T23:59:00.000Z", attempts: 2, feedback: null, leaderboard: true });
  });

  it("maps the live session gates to the typed errors", async () => {
    stubFetch(422, { detail: "x", code: "license_requires_login", details: { items: [{ item_id: "i1", position: 0 }] } });
    const license = await createChallenge({ quiz_id: "q1", closes_at: "x" }).catch((caught: unknown) => caught);
    expect(license).toBeInstanceOf(LiveLicenseRequiresLoginError);
    expect((license as LiveLicenseRequiresLoginError).items[0]?.item_id).toBe("i1");

    stubFetch(422, { detail: "x", code: "moderation_pending", details: { findings: [] } });
    expect(isModerationPending(await createChallenge({ quiz_id: "q1", closes_at: "x" }).catch((caught: unknown) => caught))).toBe(true);

    stubFetch(403, { detail: "x", code: "quiz_blocked" });
    expect(isQuizBlocked(await createChallenge({ quiz_id: "q1", closes_at: "x" }).catch((caught: unknown) => caught))).toBe(true);

    stubFetch(422, { detail: "x", code: "invalid_window" });
    expect(toChallengeOwnerErrorCode(await createChallenge({ quiz_id: "q1", closes_at: "x" }).catch((caught: unknown) => caught))).toBe("invalid_window");
  });

  it("reads and patches the panel", async () => {
    const fetchMock = stubFetch(200, { funnel: { opened: 1, joined: 1, started: 1, finished: 1 } });
    await getChallengeProgress("s/1");
    expect(call(fetchMock).url).toContain("/api/live/sessions/s%2F1/challenge");
    await updateChallenge("s1", { close_now: true });
    const patch = call(fetchMock, 1);
    expect(patch.init.method).toBe("PATCH");
    expect(patch.body).toEqual({ close_now: true });
  });

  it("maps owner error codes", () => {
    expect(toChallengeOwnerErrorCode(errorFrom(409, { detail: "x", code: "challenge_closed" }))).toBe("challenge_closed");
    expect(toChallengeOwnerErrorCode(errorFrom(422, { detail: "x", code: "invalid_total_time" }))).toBe("invalid_total_time");
    expect(toChallengeOwnerErrorCode(new ApiError({ code: "offline", message: "x", status: 0 }))).toBe("offline");
    expect(toChallengeOwnerErrorCode(errorFrom(500, { detail: "x", code: "boom" }))).toBe("generic");
  });
});

describe("participant calls", () => {
  it("info sends the token only when given (a stored token is not counted as an opening)", async () => {
    const fetchMock = stubFetch(200, { slug: "7K3QH2XN", state: "open" });
    await getChallengeInfo("7K3QH2XN");
    expect(call(fetchMock).url).toContain("/api/live/q/7K3QH2XN");
    expect(call(fetchMock).headers.get("Authorization")).toBeNull();
    await getChallengeInfo("7K3QH2XN", { token: "tok" });
    expect(call(fetchMock, 1).headers.get("Authorization")).toBe("Bearer tok");
    // The participant client never sends the app's client key (RNF-508).
    expect(call(fetchMock, 1).headers.get("X-Client-Key")).toBeNull();
  });

  it("joins and accesses with the live bodies", async () => {
    const fetchMock = stubFetch(201, { token: "t", return_code: "K7Q2MX" });
    await joinChallenge("7K3QH2XN", { display_name: "Ana", consent: true, dev_h: "abc" });
    const join = call(fetchMock);
    expect(join.url).toContain("/api/live/q/7K3QH2XN/join");
    expect(join.init.method).toBe("POST");
    expect(join.body).toEqual({ display_name: "Ana", consent: true, dev_h: "abc" });
    // Logged-in joins carry the account cookie.
    expect(join.init.credentials).toBe("include");

    await accessChallenge("7K3QH2XN", { display_name: "Ana", return_code: "K7Q2MX" });
    const access = call(fetchMock, 1);
    expect(access.url).toContain("/api/live/q/7K3QH2XN/access");
    expect(access.body).toEqual({ display_name: "Ana", return_code: "K7Q2MX" });
    expect(access.init.credentials).toBe("omit");
  });

  it("drives attempts with the Bearer token", async () => {
    const fetchMock = stubFetch(200, { attempt_id: "a1", status: "in_progress" });
    await startAttempt("SLUG0001", "tok");
    await getCurrentAttempt("SLUG0001", "tok");
    await submitChallengeAnswer("SLUG0001", "tok", "a1", { answer_id: "11111111-1111-4111-8111-111111111111", qi: 2, choice: ["o_1"] });
    await advanceAttempt("SLUG0001", "tok", "a1", 3);
    await finishAttempt("SLUG0001", "tok", "a1");
    await getChallengeLeaderboard("SLUG0001", "tok");
    const calls = fetchMock.mock.calls.map((_, index) => call(fetchMock, index));
    expect(calls.map((entry) => [entry.init.method, new URL(entry.url).pathname])).toEqual([
      ["POST", "/api/live/q/SLUG0001/attempts"],
      ["GET", "/api/live/q/SLUG0001/attempts/current"],
      ["POST", "/api/live/q/SLUG0001/attempts/a1/answers"],
      ["POST", "/api/live/q/SLUG0001/attempts/a1/advance"],
      ["POST", "/api/live/q/SLUG0001/attempts/a1/finish"],
      ["GET", "/api/live/q/SLUG0001/leaderboard"]
    ]);
    expect(calls.every((entry) => entry.headers.get("Authorization") === "Bearer tok")).toBe(true);
    expect(calls[2]?.body).toEqual({ answer_id: "11111111-1111-4111-8111-111111111111", qi: 2, choice: ["o_1"] });
    expect(calls[3]?.body).toEqual({ index: 3 });
  });

  it("maps join and attempt errors", () => {
    expect(toChallengeJoinErrorCode(errorFrom(409, { detail: "x", code: "challenge_not_open" }))).toBe("challenge_not_open");
    expect(toChallengeJoinErrorCode(errorFrom(410, { detail: "x", code: "challenge_closed" }))).toBe("challenge_closed");
    expect(toChallengeJoinErrorCode(errorFrom(409, { detail: "x", code: "name_taken" }))).toBe("name_taken");
    expect(toChallengeJoinErrorCode(errorFrom(404, { detail: "x" }))).toBe("challenge_not_found");
    expect(toChallengeJoinErrorCode(errorFrom(429, { detail: "x" }))).toBe("rate_limited");

    expect(toChallengeAttemptErrorCode(errorFrom(409, { detail: "x", code: "attempts_exhausted" }))).toBe("attempts_exhausted");
    expect(toChallengeAttemptErrorCode(errorFrom(404, { detail: "x", code: "attempt_not_found" }))).toBe("attempt_not_found");
    expect(toChallengeAttemptErrorCode(errorFrom(401, { detail: "x", code: "token_expired" }))).toBe("token");
    expect(toChallengeAttemptErrorCode(errorFrom(410, { detail: "x" }))).toBe("challenge_closed");
  });

  it("only network-ish failures are retried", () => {
    expect(isRetryableError(new ApiError({ code: "network_error", message: "x", status: 0 }))).toBe(true);
    expect(isRetryableError(new ApiError({ code: "timeout", message: "x", status: 408 }))).toBe(true);
    expect(isRetryableError(errorFrom(503, { detail: "x" }))).toBe(true);
    expect(isRetryableError(errorFrom(422, { detail: "x" }))).toBe(false);
    expect(isRetryableError(errorFrom(401, { detail: "x" }))).toBe(false);
    expect(isRetryableError(new Error("x"))).toBe(false);
  });
});
