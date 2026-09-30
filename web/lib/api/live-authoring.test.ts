import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, normalizeErrorResponse } from "@/lib/api/errors";
import {
  LiveLicenseRequiresLoginError,
  LiveQuizInvalidError,
  LiveVersionConflictError,
  buildBankSearchQuery,
  deleteLiveItem,
  isLicenseRequiresLogin,
  isQuizInvalid,
  isQuizNotPublished,
  isVersionConflict,
  parseLicenseItems,
  publishLiveQuiz,
  toLiveError,
  updateLiveItem
} from "@/lib/api/live-authoring";

function errorFrom(status: number, body: unknown): ApiError {
  return normalizeErrorResponse({ status, body: JSON.stringify(body), contentType: "application/json" });
}

describe("toLiveError", () => {
  it("maps 409 version_conflict", () => {
    const mapped = toLiveError(errorFrom(409, { detail: "stale", code: "version_conflict", request_id: "r1" }));
    expect(mapped).toBeInstanceOf(LiveVersionConflictError);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(isVersionConflict(mapped)).toBe(true);
    const error = mapped as LiveVersionConflictError;
    expect(error.status).toBe(409);
    expect(error.message).toBe("stale");
    expect(error.requestId).toBe("r1");
  });

  it("maps 422 quiz_invalid with details.issues", () => {
    const mapped = toLiveError(
      errorFrom(422, {
        detail: "Quiz inválido",
        code: "quiz_invalid",
        details: {
          issues: [
            { item_id: "i1", position: 2, field: "options", code: "no_correct", message: "Marque uma correta" },
            { item_id: null, position: null, field: "items", code: "empty", message: "Sem itens" },
            "garbage"
          ]
        }
      })
    );
    expect(isQuizInvalid(mapped)).toBe(true);
    const issues = (mapped as LiveQuizInvalidError).issues;
    expect(issues).toHaveLength(2);
    expect(issues[0]).toEqual({ item_id: "i1", position: 2, field: "options", code: "no_correct", message: "Marque uma correta" });
    expect(issues[1]?.item_id).toBeNull();
  });

  it("maps 422 license_requires_login with details.items (objects or ids)", () => {
    const mapped = toLiveError(
      errorFrom(422, {
        detail: "Login required",
        code: "license_requires_login",
        details: { items: [{ item_id: "i9", position: 4, license_scope: "platform", prompt: "Q?" }, "i10"] }
      })
    );
    expect(mapped).toBeInstanceOf(LiveLicenseRequiresLoginError);
    expect(isLicenseRequiresLogin(mapped)).toBe(true);
    expect((mapped as LiveLicenseRequiresLoginError).items).toEqual([
      { item_id: "i9", position: 4, prompt: "Q?", license_scope: "platform", reason: null },
      { item_id: "i10", position: null, prompt: null, license_scope: null, reason: null }
    ]);
  });

  it("tolerates missing details", () => {
    const mapped = toLiveError(errorFrom(422, { detail: "bad", code: "quiz_invalid" })) as LiveQuizInvalidError;
    expect(mapped.issues).toEqual([]);
  });

  it("leaves other errors untouched", () => {
    const other = errorFrom(409, { detail: "x", code: "quiz_not_published" });
    expect(toLiveError(other)).toBe(other);
    expect(isQuizNotPublished(other)).toBe(true);
    const generic = new Error("boom");
    expect(toLiveError(generic)).toBe(generic);
    // Same code on a different status is not remapped.
    const wrongStatus = errorFrom(400, { detail: "x", code: "version_conflict" });
    expect(isVersionConflict(toLiveError(wrongStatus))).toBe(false);
  });

  it("is idempotent", () => {
    const once = toLiveError(errorFrom(409, { detail: "x", code: "version_conflict" }));
    expect(toLiveError(once)).toBe(once);
  });

  it("parseLicenseItems ignores non-arrays", () => {
    expect(parseLicenseItems(undefined)).toEqual([]);
  });
});

describe("request helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends expected_version on item PATCH and maps a 409", async () => {
    const fetchMock = stubFetch(409, { detail: "stale", code: "version_conflict" });
    await expect(updateLiveItem("q1", "i1", 7, { prompt: "Hi" })).rejects.toBeInstanceOf(LiveVersionConflictError);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/live/quizzes/q1/items/i1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "Hi", expected_version: 7 });
    expect(init.credentials).toBe("include");
  });

  it("puts expected_version in the query string on DELETE", async () => {
    const fetchMock = stubFetch(200, { id: "q1", version: 8, items: [] });
    await deleteLiveItem("q1", "i/1", 7);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/live/quizzes/q1/items/i%2F1?expected_version=7");
    expect(init.method).toBe("DELETE");
  });

  it("maps publish 422 quiz_invalid", async () => {
    stubFetch(422, { detail: "invalid", code: "quiz_invalid", details: { issues: [{ item_id: "a", position: 1, field: "prompt", code: "required", message: "m" }] } });
    const error = await publishLiveQuiz("q1", 3).catch((caught: unknown) => caught);
    expect(isQuizInvalid(error)).toBe(true);
    expect((error as LiveQuizInvalidError).issues[0]?.item_id).toBe("a");
  });
});

describe("buildBankSearchQuery", () => {
  it("omits empty filters and always paginates", () => {
    expect(buildBankSearchQuery({ q: "  ", onlyGuestEligible: false })).toBe("limit=20&offset=0");
    expect(
      buildBankSearchQuery({ q: "tls", certification: "secplus", domain: "3.0", difficulty: "hard", onlyGuestEligible: true, limit: 10, offset: 20 })
    ).toBe("q=tls&certification=secplus&domain=3.0&difficulty=hard&only_guest_eligible=true&limit=10&offset=20");
  });
});
