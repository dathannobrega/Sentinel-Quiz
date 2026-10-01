/**
 * Pure helpers for the host's waiting room (CONTRATO-INCREMENTO-7.md §4): the protocol commands,
 * the cap input and the "waiting for" time. No React here, so the rules are unit tested.
 */
import type { ClientMessage, WaitingPerson, WaitingRoomState } from "@/features/quiz-live/lib/protocol";

/** The server admits at most 500 listed requests per command. */
export const ADMIT_BATCH_MAX = 500;
/** Step of the cap stepper (−/+). */
export const CAPACITY_STEP = 10;

/** `host.admit`: everyone awaiting approval (`"all"`) or the listed requests. */
export function admitCommand(target: "all" | readonly string[]): ClientMessage {
  if (target === "all") {
    return { type: "host.admit", data: { all: true } };
  }
  return { type: "host.admit", data: { request_ids: Array.from(new Set(target)).slice(0, ADMIT_BATCH_MAX) } };
}

export function rejectCommand(requestId: string): ClientMessage {
  return { type: "host.reject", data: { request_id: requestId } };
}

export function approvalCommand(required: boolean): ClientMessage {
  return { type: "host.set_approval", data: { required } };
}

/** `host.set_capacity`, clamped to 1..platform max (the server clamps too). */
export function capacityCommand(maxParticipants: number, platformMax: number): ClientMessage {
  return { type: "host.set_capacity", data: { max_participants: clampCapacity(maxParticipants, platformMax) } };
}

export function clampCapacity(value: number, platformMax: number): number {
  const ceiling = Number.isFinite(platformMax) && platformMax >= 1 ? Math.floor(platformMax) : 1;
  if (!Number.isFinite(value)) {
    return ceiling;
  }
  return Math.min(ceiling, Math.max(1, Math.round(value)));
}

/** The cap typed by the host: a whole number in 1..platform max, else null (invalid). */
export function parseCapacity(input: string, platformMax: number): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value >= 1 && value <= platformMax ? value : null;
}

/** People awaiting approval not yet decided locally (the next snapshot confirms the decision). */
export function visibleApproval(room: Pick<WaitingRoomState, "approval"> | null | undefined, decided: ReadonlySet<string>): WaitingPerson[] {
  return (room?.approval ?? []).filter((person) => !decided.has(person.request_id));
}

export type WaitedFor = { unit: "now" } | { unit: "minute" | "hour"; value: number };

/** How long someone has been waiting: "now" under a minute, then whole minutes, then hours. */
export function waitedFor(createdAt: string, now: number): WaitedFor {
  const since = Date.parse(createdAt);
  if (!Number.isFinite(since)) {
    return { unit: "now" };
  }
  const minutes = Math.floor(Math.max(0, now - since) / 60_000);
  if (minutes < 1) {
    return { unit: "now" };
  }
  if (minutes < 60) {
    return { unit: "minute", value: minutes };
  }
  return { unit: "hour", value: Math.floor(minutes / 60) };
}
