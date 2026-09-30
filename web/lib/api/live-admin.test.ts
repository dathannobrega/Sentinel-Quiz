import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, normalizeErrorResponse } from "@/lib/api/errors";
import {
  addLiveTerm,
  buildCasesQuery,
  caseActionsFor,
  isCaseNoteValid,
  listLiveAudit,
  listLiveCases,
  resolveLiveCase,
  toLiveAdminErrorCode
} from "@/lib/api/live-admin";

function errorFrom(status: number, body: unknown): ApiError {
  return normalizeErrorResponse({ status, body: JSON.stringify(body), contentType: "application/json" });
}

const openCase = { status: "open", session_id: "s1", position: 2, quiz_id: "q1", quiz_version_id: "v1" };

describe("case actions by role", () => {
  it("reviewers never get end_session / block_quiz", () => {
    expect(caseActionsFor(openCase, false)).toEqual(["dismiss", "approve", "remove_item"]);
    expect(caseActionsFor(openCase, true)).toEqual(["dismiss", "approve", "remove_item", "end_session", "block_quiz"]);
  });

  it("offers only what the case points at, and nothing once closed", () => {
    expect(caseActionsFor({ ...openCase, position: null, session_id: null }, true)).toEqual(["dismiss", "approve", "block_quiz"]);
    expect(caseActionsFor({ ...openCase, quiz_version_id: null }, false)).toEqual(["dismiss"]);
    expect(caseActionsFor({ ...openCase, status: "actioned" }, true)).toEqual([]);
  });

  it("destructive actions need a note of at least 5 characters", () => {
    expect(isCaseNoteValid("remove_item", "  abcd ")).toBe(false);
    expect(isCaseNoteValid("remove_item", "abcde")).toBe(true);
    expect(isCaseNoteValid("dismiss", "")).toBe(true);
    expect(isCaseNoteValid("block_quiz", "x".repeat(501))).toBe(false);
  });
});

describe("toLiveAdminErrorCode", () => {
  it("maps the contract codes", () => {
    expect(toLiveAdminErrorCode(errorFrom(403, { detail: "no", code: "admin_required" }))).toBe("forbidden");
    expect(toLiveAdminErrorCode(errorFrom(403, { detail: "Forbidden" }))).toBe("forbidden");
    expect(toLiveAdminErrorCode(errorFrom(422, { detail: "why", code: "reason_required" }))).toBe("reason_required");
    expect(toLiveAdminErrorCode(errorFrom(409, { detail: "done", code: "case_closed" }))).toBe("case_closed");
    expect(toLiveAdminErrorCode(errorFrom(409, { detail: "x", code: "session_not_active" }))).toBe("session_not_active");
    expect(toLiveAdminErrorCode(errorFrom(409, { detail: "dup", code: "term_exists" }))).toBe("term_exists");
    expect(toLiveAdminErrorCode(errorFrom(404, { detail: "x", code: "case_not_found" }))).toBe("not_found");
    expect(toLiveAdminErrorCode(errorFrom(401, { detail: "x" }))).toBe("unauthorized");
    expect(
      toLiveAdminErrorCode(errorFrom(422, { detail: [{ loc: ["body", "reason"], msg: "too short", type: "string_too_short" }] }))
    ).toBe("reason_required");
    expect(toLiveAdminErrorCode(new Error("boom"))).toBe("generic");
  });
});

describe("admin requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("builds the queue query and normalizes the page", async () => {
    expect(buildCasesQuery({ status: "all", limit: 20, offset: 40 })).toBe("status=all&limit=20&offset=40");
    const fetchMock = stubFetch(200, { items: null, total: undefined });
    await expect(listLiveCases({ status: "open" })).resolves.toEqual({ items: [], total: 0 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/admin/live/cases?status=open&limit=50&offset=0");
  });

  it("resolves a case with a trimmed note and omits an empty one", async () => {
    const fetchMock = stubFetch(200, { resolved: true, sessions_affected: ["s1"] });
    await resolveLiveCase("c/1", "remove_item", "  ofensivo  ");
    await resolveLiveCase("c2", "dismiss", "   ");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/admin/live/cases/c%2F1/resolve");
    expect(JSON.parse(String(init.body))).toEqual({ action: "remove_item", note: "ofensivo" });
    expect(JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({ action: "dismiss" });
  });

  it("adds terms and filters the audit by session", async () => {
    const fetchMock = stubFetch(201, { id: "t1", term: "abc" });
    await addLiveTerm({ term: " abc ", match: "token", kind: "block", scope: "all", note: "" });
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ term: "abc", match: "token", kind: "block", scope: "all" });
    const auditFetch = stubFetch(200, { items: [{ id: 1 }] });
    await expect(listLiveAudit({ sessionId: " s1 " })).resolves.toHaveLength(1);
    expect((auditFetch.mock.calls[0] as [string])[0]).toContain("/api/admin/live/audit?session_id=s1&limit=100");
  });
});
