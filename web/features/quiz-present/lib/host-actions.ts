import type { ClientMessage, TimeMultiplier } from "@/features/quiz-live/lib/protocol";
import type { LivePhase } from "@/types/api/live";

export type HostAction = "start" | "lock" | "reveal" | "next" | "leaderboard" | "podium" | "end";

export interface HostContext {
  phase: LivePhase;
  qi: number | null;
  total: number;
  /** Whether the current item takes answers (not content/leaderboard). */
  answerable: boolean;
  /** The open question is paused by the host (Incremento 3). */
  paused?: boolean;
  /** The open question has a deadline (extend needs one). */
  timed?: boolean;
}

/** Whether the current item is the last one (host.next then goes to the podium). */
export function isLastItem(context: Pick<HostContext, "qi" | "total">): boolean {
  return context.qi !== null && context.total > 0 && context.qi >= context.total - 1;
}

/**
 * The single "advance" action for Space / → / clicker PageDown, per phase:
 * lobby → start · question → lock · locked → reveal · reveal/leaderboard/content → next (podium on
 * the last item) · podium → end · finished → nothing.
 */
export function contextualAction(context: HostContext): HostAction | null {
  switch (context.phase) {
    case "lobby":
      return "start";
    case "question":
      return context.answerable ? "lock" : isLastItem(context) ? "podium" : "next";
    case "locked":
      return "reveal";
    case "reveal":
    case "leaderboard":
    case "content":
      return isLastItem(context) ? "podium" : "next";
    case "podium":
      return "end";
    default:
      return null;
  }
}

/** Which explicit actions make sense right now (buttons are disabled otherwise). */
export function availableActions(context: HostContext): Record<HostAction, boolean> {
  const live = context.phase !== "lobby" && context.phase !== "finished" && context.phase !== "podium";
  return {
    start: context.phase === "lobby",
    lock: context.phase === "question" && context.answerable,
    reveal: (context.phase === "question" || context.phase === "locked") && context.answerable,
    next: live && context.phase !== "question",
    podium: live && isLastItem(context) && context.phase !== "question",
    leaderboard: context.phase === "reveal" || context.phase === "content",
    end: context.phase !== "finished"
  };
}

/** Builds the protocol command for an action (expected_qi guards against double clicks/stale UIs). */
export function hostCommand(action: HostAction, qi: number | null): ClientMessage {
  switch (action) {
    case "start":
      return { type: "host.start", data: {} };
    case "lock":
      return { type: "host.lock", data: { expected_qi: qi ?? 0 } };
    case "reveal":
      return { type: "host.reveal", data: { expected_qi: qi ?? 0 } };
    case "next":
    case "podium":
      return { type: "host.next", data: { expected_qi: qi } };
    case "leaderboard":
      return { type: "host.leaderboard", data: {} };
    case "end":
      return { type: "host.end", data: {} };
  }
}

// ----------------------------------------------------------------------------- time controls (RF-622)

/** "+N s" steps offered to the host (server accepts 5..300). */
export const EXTEND_STEPS_S = [15, 30] as const;
export const DEFAULT_EXTEND_S = EXTEND_STEPS_S[0];

/** Which time controls apply: pause/resume only on an open question, extend only when timed and running. */
export function timeControls(context: HostContext): { pause: boolean; resume: boolean; extend: boolean } {
  const open = context.phase === "question" && context.qi !== null;
  const paused = Boolean(context.paused);
  return {
    pause: open && !paused,
    resume: open && paused,
    extend: open && !paused && Boolean(context.timed)
  };
}

/** `host.pause` / `host.resume` for the current state (toggle). */
export function pauseToggleCommand(context: Pick<HostContext, "qi" | "paused">): ClientMessage {
  const expected = context.qi ?? 0;
  return context.paused ? { type: "host.resume", data: { expected_qi: expected } } : { type: "host.pause", data: { expected_qi: expected } };
}

export function extendCommand(qi: number | null, seconds: number): ClientMessage {
  return { type: "host.extend", data: { expected_qi: qi ?? 0, seconds: Math.max(5, Math.min(300, Math.round(seconds))) } };
}

export function setTimeCommand(participantId: string, multiplier: TimeMultiplier): ClientMessage {
  return { type: "host.set_time", data: { participant_id: participantId, multiplier } };
}
