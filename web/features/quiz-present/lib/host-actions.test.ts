import { describe, expect, it } from "vitest";

import { availableActions, contextualAction, hostCommand, isLastItem } from "@/features/quiz-present/lib/host-actions";

const base = { qi: 1, total: 5, answerable: true };

describe("contextualAction", () => {
  it("follows the session phases", () => {
    expect(contextualAction({ ...base, phase: "lobby", qi: null })).toBe("start");
    expect(contextualAction({ ...base, phase: "question" })).toBe("lock");
    expect(contextualAction({ ...base, phase: "locked" })).toBe("reveal");
    expect(contextualAction({ ...base, phase: "reveal" })).toBe("next");
    expect(contextualAction({ ...base, phase: "leaderboard" })).toBe("next");
    expect(contextualAction({ ...base, phase: "content", answerable: false })).toBe("next");
    expect(contextualAction({ ...base, phase: "podium" })).toBe("end");
    expect(contextualAction({ ...base, phase: "finished" })).toBeNull();
  });

  it("goes to the podium after the last item", () => {
    expect(isLastItem({ qi: 4, total: 5 })).toBe(true);
    expect(contextualAction({ ...base, qi: 4, phase: "reveal" })).toBe("podium");
    expect(contextualAction({ ...base, qi: 4, phase: "question", answerable: false })).toBe("podium");
  });
});

describe("availableActions", () => {
  it("enables only sensible buttons", () => {
    expect(availableActions({ ...base, phase: "lobby", qi: null })).toMatchObject({ start: true, lock: false, reveal: false, next: false });
    expect(availableActions({ ...base, phase: "question" })).toMatchObject({ lock: true, reveal: true, next: false, leaderboard: false });
    expect(availableActions({ ...base, phase: "reveal" })).toMatchObject({ next: true, leaderboard: true, lock: false });
    expect(availableActions({ ...base, phase: "finished" }).end).toBe(false);
  });
});

describe("hostCommand", () => {
  it("adds expected_qi where the contract asks for it", () => {
    expect(hostCommand("lock", 3)).toEqual({ type: "host.lock", data: { expected_qi: 3 } });
    expect(hostCommand("reveal", 3)).toEqual({ type: "host.reveal", data: { expected_qi: 3 } });
    expect(hostCommand("next", 3)).toEqual({ type: "host.next", data: { expected_qi: 3 } });
    expect(hostCommand("podium", 4)).toEqual({ type: "host.next", data: { expected_qi: 4 } });
    expect(hostCommand("start", null)).toEqual({ type: "host.start", data: {} });
    expect(hostCommand("end", 1)).toEqual({ type: "host.end", data: {} });
  });
});
