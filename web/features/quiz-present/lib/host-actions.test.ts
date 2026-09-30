import { describe, expect, it } from "vitest";

import {
  availableActions,
  contextualAction,
  extendCommand,
  hostCommand,
  isLastItem,
  pauseToggleCommand,
  setTimeCommand,
  timeControls
} from "@/features/quiz-present/lib/host-actions";

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

describe("time controls", () => {
  it("offers pause, resume and extend only where the server accepts them", () => {
    expect(timeControls({ ...base, phase: "question", timed: true })).toEqual({ pause: true, resume: false, extend: true });
    expect(timeControls({ ...base, phase: "question", timed: false })).toEqual({ pause: true, resume: false, extend: false });
    expect(timeControls({ ...base, phase: "question", timed: true, paused: true })).toEqual({ pause: false, resume: true, extend: false });
    expect(timeControls({ ...base, phase: "locked", timed: true })).toEqual({ pause: false, resume: false, extend: false });
  });

  it("builds the commands with expected_qi", () => {
    expect(pauseToggleCommand({ qi: 2, paused: false })).toEqual({ type: "host.pause", data: { expected_qi: 2 } });
    expect(pauseToggleCommand({ qi: 2, paused: true })).toEqual({ type: "host.resume", data: { expected_qi: 2 } });
    expect(extendCommand(2, 15)).toEqual({ type: "host.extend", data: { expected_qi: 2, seconds: 15 } });
    expect(extendCommand(2, 900)).toMatchObject({ data: { seconds: 300 } });
    expect(setTimeCommand("p1", 1.5)).toEqual({ type: "host.set_time", data: { participant_id: "p1", multiplier: 1.5 } });
  });
});
