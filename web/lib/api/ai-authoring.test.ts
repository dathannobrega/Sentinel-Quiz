import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiAlreadyAppliedError,
  AiDisabledError,
  AiDraftBlockedError,
  AiJobNotFoundError,
  AiJobNotReadyError,
  AiQuotaExceededError,
  AiTooManyJobsError,
  applyAiJob,
  createGenerateJob,
  createImproveJob,
  isAiQuotaExceeded,
  isConfirmKeyRequired,
  isJobActive,
  isVersionConflict,
  jobRefetchInterval,
  listAiJobs,
  markDraftsApplied,
  sampleBank,
  suggestItemFormat,
  toAiError
} from "@/lib/api/ai-authoring";
import { ApiError, normalizeErrorResponse } from "@/lib/api/errors";
import { LiveConfirmKeyRequiredError, LiveVersionConflictError, reviewLiveItem } from "@/lib/api/live-authoring";
import type { AiJob } from "@/types/api";

function errorFrom(status: number, body: unknown): ApiError {
  return normalizeErrorResponse({ status, body: JSON.stringify(body), contentType: "application/json" });
}

describe("toAiError", () => {
  it("maps 429 ai_quota_exceeded with details.remaining", () => {
    const mapped = toAiError(errorFrom(429, { detail: "Sem créditos", code: "ai_quota_exceeded", details: { remaining: 3.5 }, request_id: "r1" }));
    expect(mapped).toBeInstanceOf(AiQuotaExceededError);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(isAiQuotaExceeded(mapped)).toBe(true);
    const error = mapped as AiQuotaExceededError;
    expect(error.remaining).toBe(3.5);
    expect(error.status).toBe(429);
    expect(error.message).toBe("Sem créditos");
    expect(error.requestId).toBe("r1");
  });

  it("keeps remaining null when details are missing", () => {
    const mapped = toAiError(errorFrom(429, { detail: "x", code: "ai_quota_exceeded" })) as AiQuotaExceededError;
    expect(mapped.remaining).toBeNull();
  });

  it.each([
    [429, "ai_too_many_jobs", AiTooManyJobsError],
    [422, "ai_draft_blocked", AiDraftBlockedError],
    [409, "ai_already_applied", AiAlreadyAppliedError],
    [409, "ai_job_not_ready", AiJobNotReadyError],
    [404, "ai_disabled", AiDisabledError],
    [404, "ai_job_not_found", AiJobNotFoundError]
  ] as const)("maps %i %s", (status, code, ErrorClass) => {
    const mapped = toAiError(errorFrom(status, { detail: "x", code }));
    expect(mapped).toBeInstanceOf(ErrorClass);
    expect((mapped as ApiError).code).toBe(code);
  });

  it("delegates version_conflict and confirm_key_required to the live error classes", () => {
    const conflict = toAiError(errorFrom(409, { detail: "stale", code: "version_conflict" }));
    expect(conflict).toBeInstanceOf(LiveVersionConflictError);
    expect(isVersionConflict(conflict)).toBe(true);
    const confirm = toAiError(errorFrom(422, { detail: "confirm", code: "confirm_key_required" }));
    expect(confirm).toBeInstanceOf(LiveConfirmKeyRequiredError);
    expect(isConfirmKeyRequired(confirm)).toBe(true);
  });

  it("does not remap a known code on another status, and is idempotent", () => {
    const wrong = toAiError(errorFrom(400, { detail: "x", code: "ai_quota_exceeded" }));
    expect(wrong).not.toBeInstanceOf(AiQuotaExceededError);
    const once = toAiError(errorFrom(429, { detail: "x", code: "ai_too_many_jobs" }));
    expect(toAiError(once)).toBe(once);
    const generic = new Error("boom");
    expect(toAiError(generic)).toBe(generic);
  });
});

describe("AI request helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function call(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
    const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
    return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined };
  }

  it("creates a generate job and maps a 429 quota error", async () => {
    const fetchMock = stubFetch(429, { detail: "quota", code: "ai_quota_exceeded", details: { remaining: 2 } });
    const input = { quiz_id: "q1", topic: "IAM", level: "mixed" as const, n: 5, types: ["single_choice" as const], language: "pt-BR" as const };
    const error = await createGenerateJob(input).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiQuotaExceededError);
    expect((error as AiQuotaExceededError).remaining).toBe(2);
    const request = call(fetchMock);
    expect(request.url).toContain("/api/ai/quiz-drafts/generate");
    expect(request.method).toBe("POST");
    expect(request.body).toEqual(input);
  });

  it("posts improve, apply, suggest-format and bank sample to the contract paths", async () => {
    const fetchMock = stubFetch(200, {});
    await createImproveJob("item 1", { quiz_id: "q1", action: "rewrite" });
    await applyAiJob("j1", { quiz_id: "q1", expected_version: 4, indexes: [0, 2], force: true });
    await suggestItemFormat({ item_type: "single_choice", prompt: "P?", options: ["a", "b"] });
    await sampleBank({ n: 10, strategy: "coverage", only_guest_eligible: true });
    expect(call(fetchMock, 0).url).toContain("/api/ai/items/item%201/improve");
    expect(call(fetchMock, 1).url).toContain("/api/ai/jobs/j1/apply");
    expect(call(fetchMock, 1).body).toEqual({ quiz_id: "q1", expected_version: 4, indexes: [0, 2], force: true });
    expect(call(fetchMock, 2).url).toContain("/api/ai/items/suggest-format");
    expect(call(fetchMock, 3).url).toContain("/api/live/bank/sample");
  });

  it("lists jobs for a quiz", async () => {
    const fetchMock = stubFetch(200, { items: [{ id: "j1" }] });
    await expect(listAiJobs("q 1")).resolves.toEqual([{ id: "j1" }]);
    expect(call(fetchMock).url).toContain("/api/ai/jobs?quiz_id=q+1&limit=20");
  });

  it("sends confirm_key only when requested and maps confirm_key_required", async () => {
    const fetchMock = stubFetch(422, { detail: "confirm", code: "confirm_key_required" });
    await expect(reviewLiveItem("q1", "i1", 3)).rejects.toBeInstanceOf(LiveConfirmKeyRequiredError);
    expect(call(fetchMock, 0).body).toEqual({ expected_version: 3 });
    await expect(reviewLiveItem("q1", "i1", 3, { confirmKey: true })).rejects.toBeInstanceOf(LiveConfirmKeyRequiredError);
    expect(call(fetchMock, 1).body).toEqual({ expected_version: 3, confirm_key: true });
  });
});

describe("job helpers", () => {
  it("polls every 1.5 s only while queued or running", () => {
    expect(isJobActive("queued")).toBe(true);
    expect(isJobActive("running")).toBe(true);
    expect(jobRefetchInterval({ status: "running" })).toBe(1500);
    expect(jobRefetchInterval({ status: "succeeded" })).toBe(false);
    expect(jobRefetchInterval({ status: "failed" })).toBe(false);
    expect(jobRefetchInterval({ status: "degraded" })).toBe(false);
  });

  it("marks applied drafts", () => {
    const job = {
      id: "j1",
      result: {
        type: "drafts",
        items: [{ index: 0, applied: false }, { index: 1, applied: false }],
        summary: { requested: 2, produced: 2, blocked: 0, warnings: 0 }
      }
    } as unknown as AiJob;
    const next = markDraftsApplied(job, [1]);
    expect(next.result?.type === "drafts" && next.result.items.map((item) => item.applied)).toEqual([false, true]);
  });
});
