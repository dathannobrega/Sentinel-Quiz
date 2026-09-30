// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearParticipantCredentials,
  getRoom,
  joinRoom,
  loadParticipantCredentials,
  loadReturnCode,
  saveParticipantCredentials,
  saveReturnCode,
  toJoinErrorCode
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
