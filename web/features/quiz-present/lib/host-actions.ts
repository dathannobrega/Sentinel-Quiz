import type { ClientMessage } from "@/features/quiz-live/lib/protocol";
import type { LivePhase } from "@/types/api/live";

export type HostAction = "start" | "lock" | "reveal" | "next" | "leaderboard" | "podium" | "end";

export interface HostContext {
  phase: LivePhase;
  qi: number | null;
  total: number;
  /** Whether the current item takes answers (not content/leaderboard). */
  answerable: boolean;
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
