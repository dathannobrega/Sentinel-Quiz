import { describe, expect, it } from "vitest";

import {
  buildChallengePayload,
  defaultFeedback,
  effectiveFeedback,
  hasErrors,
  initialChallengeForm,
  parseLocalInput,
  shortcutDeadline,
  toLocalInputValue,
  validateChallengeForm
} from "@/features/quiz-challenge/lib/challenge-form";

const NOW = new Date(2026, 9, 1, 10, 0).getTime();
const DAY = 86_400_000;
const local = (offsetMs: number) => toLocalInputValue(new Date(NOW + offsetMs));

describe("challenge form defaults", () => {
  it("opens now, closes in a week, 1 attempt, per-item time, shuffled, guests allowed", () => {
    const form = initialChallengeForm(NOW);
    expect(form.opensMode).toBe("now");
    expect(parseLocalInput(form.closesAt)).toBe(NOW + 7 * DAY);
    expect(form).toMatchObject({ attempts: 1, timeMode: "per_item", feedback: null, leaderboard: false, shuffleItems: true, requireLogin: false });
    expect(hasErrors(validateChallengeForm(form, NOW))).toBe(false);
  });

  it("the correction default follows the leaderboard like the server (RF-813)", () => {
    expect(defaultFeedback(false)).toBe("end");
    expect(defaultFeedback(true)).toBe("after_close");
    const form = initialChallengeForm(NOW);
    expect(effectiveFeedback(form)).toBe("end");
    expect(effectiveFeedback({ ...form, leaderboard: true })).toBe("after_close");
    // An explicit choice wins over the default.
    expect(effectiveFeedback({ ...form, leaderboard: true, feedback: "each" })).toBe("each");
  });
});

describe("validation", () => {
  const base = initialChallengeForm(NOW);

  it("rejects past, inverted and too long windows", () => {
    expect(validateChallengeForm({ ...base, closesAt: local(30_000) }, NOW).closesAt).toBe("closesPast");
    expect(validateChallengeForm({ ...base, closesAt: "" }, NOW).closesAt).toBe("closesRequired");
    const later = { ...base, opensMode: "later" as const, opensAt: local(2 * DAY) };
    expect(validateChallengeForm({ ...later, closesAt: local(DAY) }, NOW).closesAt).toBe("closesBeforeOpens");
    expect(validateChallengeForm({ ...later, closesAt: local(93 * DAY) }, NOW).closesAt).toBe("windowTooLong");
    expect(validateChallengeForm({ ...later, opensAt: local(-DAY) }, NOW).opensAt).toBe("opensPast");
    expect(validateChallengeForm({ ...later, opensAt: "" }, NOW).opensAt).toBe("opensRequired");
  });

  it("checks the total time only in total mode", () => {
    expect(validateChallengeForm({ ...base, timeMode: "total", totalMinutes: "0" }, NOW).totalMinutes).toBe("totalRange");
    expect(validateChallengeForm({ ...base, timeMode: "total", totalMinutes: "241" }, NOW).totalMinutes).toBe("totalRange");
    expect(validateChallengeForm({ ...base, timeMode: "total", totalMinutes: "12.5" }, NOW).totalMinutes).toBe("totalRange");
    expect(validateChallengeForm({ ...base, timeMode: "none", totalMinutes: "0" }, NOW).totalMinutes).toBeUndefined();
    expect(validateChallengeForm({ ...base, attempts: 6 }, NOW).attempts).toBe("attemptsRange");
  });
});

describe("shortcuts and payload", () => {
  it("deadline shortcuts count from the opening (or now)", () => {
    const base = initialChallengeForm(NOW);
    expect(parseLocalInput(shortcutDeadline(base, 1, NOW))).toBe(NOW + DAY);
    const later = { ...base, opensMode: "later" as const, opensAt: local(DAY) };
    expect(parseLocalInput(shortcutDeadline(later, 7, NOW))).toBe(NOW + 8 * DAY);
  });

  it("builds the request body", () => {
    const form = { ...initialChallengeForm(NOW), attempts: 3, timeMode: "total" as const, totalMinutes: "20", leaderboard: true, requireLogin: true };
    const body = buildChallengePayload("q1", form);
    expect(body).toEqual({
      quiz_id: "q1",
      opens_at: null,
      closes_at: new Date(NOW + 7 * DAY).toISOString(),
      attempts: 3,
      time_mode: "total",
      total_time_s: 1200,
      // Untouched: the server applies the leaderboard default.
      feedback: null,
      leaderboard: true,
      shuffle_items: true,
      allow_guests: false
    });
    const scheduled = buildChallengePayload("q1", { ...form, opensMode: "later", opensAt: local(DAY), timeMode: "per_item", feedback: "each" });
    expect(scheduled.opens_at).toBe(new Date(NOW + DAY).toISOString());
    expect(scheduled.total_time_s).toBeNull();
    expect(scheduled.feedback).toBe("each");
  });
});
