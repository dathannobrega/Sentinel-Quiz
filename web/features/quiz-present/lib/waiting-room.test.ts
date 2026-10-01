import { describe, expect, it } from "vitest";

import {
  ADMIT_BATCH_MAX,
  admitCommand,
  approvalCommand,
  capacityCommand,
  clampCapacity,
  parseCapacity,
  rejectCommand,
  visibleApproval,
  waitedFor
} from "@/features/quiz-present/lib/waiting-room";

describe("waiting room host helpers", () => {
  it("builds the host commands of the contract", () => {
    expect(admitCommand("all")).toEqual({ type: "host.admit", data: { all: true } });
    expect(admitCommand(["r1", "r2", "r1"])).toEqual({ type: "host.admit", data: { request_ids: ["r1", "r2"] } });
    const many = Array.from({ length: ADMIT_BATCH_MAX + 20 }, (_, index) => `r${index}`);
    const big = admitCommand(many);
    expect(big.type === "host.admit" && "request_ids" in big.data ? big.data.request_ids?.length : 0).toBe(ADMIT_BATCH_MAX);
    expect(rejectCommand("r9")).toEqual({ type: "host.reject", data: { request_id: "r9" } });
    expect(approvalCommand(false)).toEqual({ type: "host.set_approval", data: { required: false } });
    expect(capacityCommand(5000, 2000)).toEqual({ type: "host.set_capacity", data: { max_participants: 2000 } });
  });

  it("clamps and parses the room cap within 1..platform max", () => {
    expect(clampCapacity(0, 2000)).toBe(1);
    expect(clampCapacity(1234.6, 2000)).toBe(1235);
    expect(clampCapacity(Number.NaN, 2000)).toBe(2000);
    expect(parseCapacity(" 1500 ", 2000)).toBe(1500);
    expect(parseCapacity("2001", 2000)).toBeNull();
    expect(parseCapacity("1.500", 2000)).toBeNull();
    expect(parseCapacity("0", 2000)).toBeNull();
  });

  it("hides people decided locally until the next snapshot", () => {
    const person = (id: string) => ({ request_id: id, display_name: id, avatar_seed: "a", signed_in: false, created_at: "2026-10-01T10:00:00Z", connected: true });
    const room = { approval: [person("a"), person("b"), person("c")] };
    expect(visibleApproval(room, new Set(["b"])).map((p) => p.request_id)).toEqual(["a", "c"]);
    expect(visibleApproval(null, new Set())).toEqual([]);
  });

  it("formats how long someone has waited", () => {
    const start = Date.parse("2026-10-01T10:00:00Z");
    expect(waitedFor("2026-10-01T10:00:00Z", start + 30_000)).toEqual({ unit: "now" });
    expect(waitedFor("2026-10-01T10:00:00Z", start + 5 * 60_000)).toEqual({ unit: "minute", value: 5 });
    expect(waitedFor("2026-10-01T10:00:00Z", start + 125 * 60_000)).toEqual({ unit: "hour", value: 2 });
    expect(waitedFor("garbage", start)).toEqual({ unit: "now" });
  });
});
