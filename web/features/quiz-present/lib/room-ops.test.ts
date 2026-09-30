import { describe, expect, it } from "vitest";

import {
  capacityLevel,
  capacityPercent,
  normalizePreflightStatus,
  preflightDetail,
  preflightKey,
  preflightOverall,
  preflightValues,
  shouldAutoRunPreflight,
  sortPreflightChecks
} from "@/features/quiz-present/lib/room-ops";
import type { LivePreflightCheck } from "@/types/api/live";

describe("capacity warning (RF-1205)", () => {
  it("warns from 80% of the limit and flags the limit itself", () => {
    expect(capacityLevel(79, 100)).toBe("ok");
    expect(capacityLevel(80, 100)).toBe("near");
    expect(capacityLevel(99, 100)).toBe("near");
    expect(capacityLevel(100, 100)).toBe("full");
    expect(capacityLevel(140, 100)).toBe("full");
  });

  it("rounds the threshold up for small rooms (4 of 5 is 80%)", () => {
    expect(capacityLevel(3, 5)).toBe("ok");
    expect(capacityLevel(4, 5)).toBe("near");
    expect(capacityLevel(7, 9)).toBe("ok");
    expect(capacityLevel(8, 9)).toBe("near");
  });

  it("never warns without a valid limit (older servers)", () => {
    expect(capacityLevel(500, null)).toBe("ok");
    expect(capacityLevel(500, undefined)).toBe("ok");
    expect(capacityLevel(5, 0)).toBe("ok");
    expect(capacityLevel(Number.NaN, 10)).toBe("ok");
  });

  it("percent is whole and capped", () => {
    expect(capacityPercent(81, 100)).toBe(81);
    expect(capacityPercent(2, 3)).toBe(67);
    expect(capacityPercent(150, 100)).toBe(100);
    expect(capacityPercent(0, 100)).toBe(0);
    expect(capacityPercent(5, null)).toBe(0);
  });
});

describe("pre-event check (RF-1115)", () => {
  const check = (overrides: Partial<LivePreflightCheck>): LivePreflightCheck => ({ key: "database", status: "ok", detail: "", ...overrides });

  it("auto-runs for rooms of 300 seats or more", () => {
    expect(shouldAutoRunPreflight(299)).toBe(false);
    expect(shouldAutoRunPreflight(300)).toBe(true);
    expect(shouldAutoRunPreflight(null)).toBe(false);
  });

  it("maps keys and details to known copy, with fallbacks", () => {
    expect(preflightKey(check({ key: "realtime_bus" }))).toBe("realtime_bus");
    expect(preflightKey(check({ key: "disk" }))).toBe("other");
    expect(preflightDetail(check({ detail: "" }))).toBe("ok");
    expect(preflightDetail(check({ detail: "moderation_pending" }))).toBe("moderation_pending");
    expect(preflightDetail(check({ detail: "brand_new_code" }))).toBe("other");
  });

  it("treats unknown statuses as warnings, never as ok", () => {
    expect(normalizePreflightStatus("ok")).toBe("ok");
    expect(normalizePreflightStatus("fail")).toBe("fail");
    expect(normalizePreflightStatus("mystery")).toBe("warn");
  });

  it("lists failures first, then warnings, keeping the server order inside a group", () => {
    const sorted = sortPreflightChecks([
      check({ key: "database" }),
      check({ key: "capacity", status: "warn" }),
      check({ key: "content", status: "fail" }),
      check({ key: "rate_limit", status: "warn" }),
      check({ key: "token_keys", status: "fail" })
    ]);
    expect(sorted.map((item) => item.key)).toEqual(["content", "token_keys", "capacity", "rate_limit", "database"]);
  });

  it("is only ready when the server says so and every check is ok", () => {
    expect(preflightOverall({ status: "ready", checks: [check({})] })).toBe("ready");
    expect(preflightOverall({ status: "ready", checks: [check({ status: "warn" })] })).toBe("attention");
    expect(preflightOverall({ status: "attention", checks: [check({})] })).toBe("attention");
  });

  it("keeps only printable values", () => {
    expect(preflightValues(check({ values: { latency_ms: 3.2, backend: "redis", p95_ms: null, flag: true } }))).toEqual({ latency_ms: 3.2, backend: "redis" });
    expect(preflightValues(check({}))).toEqual({});
  });
});
