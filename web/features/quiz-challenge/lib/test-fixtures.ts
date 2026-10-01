/** Test fixtures for the challenge screens (AttemptState and PublicQuestion in the server shapes). */
import type { PublicQuestion } from "@/features/quiz-live/lib/protocol";
import type { LiveAttemptState } from "@/types/api";

export function question(qi: number, overrides: Partial<PublicQuestion> = {}): PublicQuestion {
  return {
    qi,
    item_type: "single_choice",
    prompt: `Pergunta ${qi}`,
    options: [
      { id: `o_${qi}a`, text: "A", index: 0 },
      { id: `o_${qi}b`, text: "B", index: 1 }
    ],
    allow_multiple: false,
    body: null,
    time_limit_s: 20,
    points_multiplier: 1,
    scored: true,
    select_count: null,
    ...overrides
  };
}

export function attemptState(overrides: Partial<LiveAttemptState> = {}): LiveAttemptState {
  return {
    attempt_id: "a1",
    attempt_no: 1,
    attempts_allowed: 2,
    status: "in_progress",
    index: 0,
    total: 3,
    questions_total: 3,
    started_at: "2026-10-01T12:00:00+00:00",
    deadline_at: null,
    closes_at: "2026-10-08T12:00:00+00:00",
    server_now: "2026-10-01T12:00:00+00:00",
    feedback: "end",
    leaderboard: false,
    item: question(4),
    item_started_at: "2026-10-01T12:00:00+00:00",
    item_deadline_at: "2026-10-01T12:00:20+00:00",
    next_pending: false,
    score: null,
    attempts_used: 1,
    ...overrides
  };
}
