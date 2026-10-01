// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  accessWithReturnCode,
  clearParticipantCredentials,
  createPreview,
  eraseMyData,
  forgetParticipant,
  getMyData,
  getRoom,
  isTokenRejected,
  joinRoom,
  loadParticipantCredentials,
  loadParticipantIdentity,
  loadReturnCode,
  reportContent,
  saveParticipantCredentials,
  saveReturnCode,
  toAccessErrorCode,
  toJoinErrorCode,
  toReportErrorCode
} from "@/features/quiz-live/lib/live-fetch";
import { ApiError } from "@/lib/api/errors";

const credentials = {
  token: "secret-token",
  expiresAt: "2099-01-01T00:00:00Z",
  sessionId: "s1",
  participantId: "p1",
  displayName: "Ana",
  avatarSeed: "a"
};

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("participant credential storage", () => {
  it("keeps the token in sessionStorage per room code, never localStorage", () => {
    saveParticipantCredentials("482913", credentials);
    expect(loadParticipantCredentials("482913")).toEqual(credentials);
    expect(loadParticipantCredentials("111111")).toBeNull();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("secret-token");
    clearParticipantCredentials("482913");
    expect(loadParticipantCredentials("482913")).toBeNull();
  });

  it("drops expired tokens", () => {
    saveParticipantCredentials("482913", { ...credentials, expiresAt: "2000-01-01T00:00:00Z" });
    expect(loadParticipantCredentials("482913")).toBeNull();
  });

  it("remembers the return code for the tab", () => {
    saveReturnCode("482913", "K7Q2MX");
    expect(loadReturnCode("482913")).toBe("K7Q2MX");
  });
});

describe("REST calls", () => {
  it("never sends X-Client-Key and normalizes backend error codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Sala trancada", code: "room_locked" }), { status: 423, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const error = await joinRoom("482913", { display_name: "Ana", consent: true }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("room_locked");
    expect(toJoinErrorCode(error)).toBe("room_locked");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/live\/rooms\/482913\/join$/);
    expect(new Headers(init.headers).has("X-Client-Key")).toBe(false);
    expect(init.method).toBe("POST");
  });

  it("maps unknown 404s to room_not_found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    const error = await getRoom("999999").catch((caught: unknown) => caught);
    expect(toJoinErrorCode(error)).toBe("room_not_found");
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function apiError(status: number, code: string): ApiError {
  return new ApiError({ code, message: code, status });
}

describe("participant identity (Incremento 4)", () => {
  it("survives the expired token so the return-code access still knows the session", () => {
    saveParticipantCredentials("482913", { ...credentials, expiresAt: "2000-01-01T00:00:00Z" });
    expect(loadParticipantCredentials("482913")).toBeNull();
    expect(loadParticipantIdentity("482913")).toEqual({ sessionId: "s1", displayName: "Ana" });
  });

  it("forgetParticipant clears token, return code and identity (after erasure)", () => {
    saveParticipantCredentials("482913", credentials);
    saveReturnCode("482913", "K7Q2MX");
    forgetParticipant("482913");
    expect(loadParticipantCredentials("482913")).toBeNull();
    expect(loadReturnCode("482913")).toBeNull();
    expect(loadParticipantIdentity("482913")).toBeNull();
  });
});

describe("participant rights calls", () => {
  it("GET and DELETE /me carry the participant Bearer and no cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { participant: {}, answers: [] })).mockResolvedValueOnce(jsonResponse(200, { erased: true }));
    vi.stubGlobal("fetch", fetchMock);
    await getMyData("tok-1");
    await eraseMyData("tok-1");
    const [getUrl, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, deleteInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(getUrl).toMatch(/\/api\/live\/me$/);
    expect(new Headers(getInit.headers).get("Authorization")).toBe("Bearer tok-1");
    expect(getInit.credentials).toBe("omit");
    expect(deleteInit.method).toBe("DELETE");
  });

  it("reports an item with qi and reason", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { report_id: "r1" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(reportContent("tok", { target: "item", qi: 2, reason: "offensive", note: "x" })).resolves.toEqual({ report_id: "r1" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/live\/me\/report$/);
    expect(JSON.parse(String(init.body))).toEqual({ target: "item", qi: 2, reason: "offensive", note: "x" });
  });

  it("maps 429 too_many_reports and token errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, { detail: "slow down", code: "too_many_reports" })));
    const error = await reportContent("tok", { target: "session", reason: "spam" }).catch((caught: unknown) => caught);
    expect(toReportErrorCode(error)).toBe("too_many_reports");
    expect(toReportErrorCode(apiError(401, "token_expired"))).toBe("token");
    expect(toReportErrorCode(apiError(422, "invalid_item"))).toBe("invalid_item");
    expect(toReportErrorCode(apiError(0, "offline"))).toBe("offline");
    expect(toReportErrorCode(new Error("x"))).toBe("generic");
  });

  it("accesses with the return code and maps its errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { detail: "no", code: "invalid_return_code" }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await accessWithReturnCode({ session_id: "s1", display_name: "Ana", return_code: "K7Q2MX" }).catch((caught: unknown) => caught);
    expect(toAccessErrorCode(error)).toBe("invalid_return_code");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/live\/me\/access$/);
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(toAccessErrorCode(apiError(429, "too_many_attempts"))).toBe("too_many_attempts");
    expect(toAccessErrorCode(apiError(429, "rate_limited"))).toBe("too_many_attempts");
    expect(toAccessErrorCode(apiError(403, "banned"))).toBe("banned");
    expect(toAccessErrorCode(apiError(500, "boom"))).toBe("generic");
  });

  it("recognizes a rejected participant token", () => {
    expect(isTokenRejected(apiError(401, "token_invalid"))).toBe(true);
    expect(isTokenRejected(apiError(401, "http_401"))).toBe(true);
    expect(isTokenRejected(apiError(403, "forbidden"))).toBe(false);
    expect(isTokenRejected(new Error("nope"))).toBe(false);
  });

  it("the host preview posts with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ...credentials, session_id: "s1", participant_id: "p", token: "t", expires_at: "2099-01-01", display_name: "Prévia", avatar_seed: "x" }));
    vi.stubGlobal("fetch", fetchMock);
    await createPreview("s/1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/live\/sessions\/s%2F1\/preview$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });
});

describe("participant identity (return-code flows)", () => {
  it("survives in localStorage and expires after 30 days", async () => {
    const { saveParticipantIdentity, loadParticipantIdentity, forgetParticipant } = await import("./live-fetch");
    const now = Date.UTC(2026, 9, 1);
    saveParticipantIdentity("123456", { sessionId: "s-1", displayName: "Ana" }, now);
    expect(window.sessionStorage.getItem("lq:who:123456")).toBeNull();
    expect(loadParticipantIdentity("123456", now + 7 * 86_400_000)).toEqual({ sessionId: "s-1", displayName: "Ana" });
    expect(loadParticipantIdentity("123456", now + 31 * 86_400_000)).toBeNull();
    expect(window.localStorage.getItem("lq:who:123456")).toBeNull();
    saveParticipantIdentity("123456", { sessionId: "s-1", displayName: "Ana" }, now);
    forgetParticipant("123456");
    expect(loadParticipantIdentity("123456", now)).toBeNull();
  });
});

describe("waiting room (Incremento 7)", () => {
  const waiting = {
    status: "waiting",
    reason: "capacity",
    request_id: "r1",
    wait_token: "wait-secret",
    session_id: "s1",
    display_name: "Ana",
    avatar_seed: "a",
    position: 3,
    waiting: 40,
    retry_after_ms: 3240
  };

  it("tells a 202 waiting join from a 201 joined one", async () => {
    const { isJoinWaiting } = await import("@/features/quiz-live/lib/live-fetch");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(202, waiting)).mockResolvedValueOnce(jsonResponse(201, { status: "joined", token: "t" })));
    const queued = await joinRoom("482913", { display_name: "Ana", consent: true });
    expect(isJoinWaiting(queued)).toBe(true);
    const joined = await joinRoom("482913", { display_name: "Ana", consent: true });
    expect(isJoinWaiting(joined)).toBe(false);
  });

  it("keeps the ticket in sessionStorage only and clears it", async () => {
    const { clearWaitingTicket, loadWaitingTicket, saveWaitingTicket, ticketFromJoin, updateTicket } = await import("@/features/quiz-live/lib/live-fetch");
    const ticket = ticketFromJoin(waiting as Parameters<typeof ticketFromJoin>[0]);
    expect(ticket).toMatchObject({ requestId: "r1", waitToken: "wait-secret", reason: "capacity", position: 3, retryAfterMs: 3240 });
    saveWaitingTicket("482913", ticket);
    expect(loadWaitingTicket("482913")).toEqual(ticket);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain("wait-secret");
    const moved = updateTicket(ticket, { ...waiting, position: 1, waiting: 12, retry_after_ms: 3000 } as Parameters<typeof updateTicket>[1]);
    expect(moved).toMatchObject({ position: 1, waiting: 12, retryAfterMs: 3000, waitToken: "wait-secret" });
    clearWaitingTicket("482913");
    expect(loadWaitingTicket("482913")).toBeNull();
    window.sessionStorage.setItem("lq:wait:482913", JSON.stringify({ requestId: "r1" }));
    expect(loadWaitingTicket("482913")).toBeNull(); // no token, no ticket
  });

  it("polls and leaves with the Bearer wait token and without cookies", async () => {
    const { getQueueStatus, leaveQueue } = await import("@/features/quiz-live/lib/live-fetch");
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, waiting)).mockResolvedValueOnce(jsonResponse(200, { status: "withdrawn", request_id: "r1" }));
    vi.stubGlobal("fetch", fetchMock);
    await getQueueStatus("r1", "wait-secret");
    await leaveQueue("r1", "wait-secret");
    const [[getUrl, getInit], [deleteUrl, deleteInit]] = fetchMock.mock.calls as [string, RequestInit][];
    expect(getUrl).toMatch(/\/api\/live\/queue\/r1$/);
    expect(deleteUrl).toMatch(/\/api\/live\/queue\/r1$/);
    expect(deleteInit.method).toBe("DELETE");
    for (const init of [getInit, deleteInit]) {
      expect(new Headers(init.headers).get("Authorization")).toBe("Bearer wait-secret");
      expect(init.credentials).toBe("omit");
    }
  });

  it("maps queue errors", async () => {
    const { toQueueErrorCode } = await import("@/features/quiz-live/lib/live-fetch");
    expect(toQueueErrorCode(apiError(403, "invalid_wait_token"))).toBe("invalid_wait_token");
    expect(toQueueErrorCode(apiError(401, "unauthorized"))).toBe("invalid_wait_token");
    expect(toQueueErrorCode(apiError(429, "rate_limited"))).toBe("rate_limited");
    expect(toQueueErrorCode(apiError(0, "offline"))).toBe("offline");
    expect(toQueueErrorCode(new Error("x"))).toBe("generic");
  });
});
