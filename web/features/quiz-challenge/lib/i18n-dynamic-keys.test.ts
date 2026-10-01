import { describe, expect, it } from "vitest";

import { CHALLENGE_JOIN_ERROR_CODES, CHALLENGE_OWNER_ERROR_CODES } from "@/lib/api/live-challenge";
import { FEEDBACK_POLICIES, TIME_MODES } from "@/features/quiz-challenge/lib/challenge-form";
import { getMessageValue, getMessages } from "@/lib/i18n/core";

/** Keys built at runtime (`t(\`quizChallenge.x.${code}\`)`), which the static key scan cannot see. */
const DYNAMIC = [
  ...["scheduled", "open", "closed"].map((state) => `quizChallenge.states.${state}`),
  ...["completed", "time_up", "closed", "handed_in"].flatMap((reason) => [`quizChallenge.reasons.${reason}`, `quizChallenge.play.summary.reasons.${reason}`]),
  ...["opened", "joined", "started", "finished"].map((step) => `quizChallenge.funnel.${step}`),
  ...TIME_MODES.flatMap((mode) => [`quizChallenge.create.time.${mode}.name`, `quizChallenge.create.time.${mode}.description`]),
  ...FEEDBACK_POLICIES.flatMap((policy) => [`quizChallenge.create.feedback.${policy}.name`, `quizChallenge.create.feedback.${policy}.description`]),
  ...[...CHALLENGE_OWNER_ERROR_CODES, "offline", "generic"].map((code) => `quizChallenge.create.errors.${code}`),
  ...["opensRequired", "opensPast", "closesRequired", "closesPast", "closesBeforeOpens", "windowTooLong", "totalRange", "attemptsRange"].map(
    (code) => `quizChallenge.create.errors.${code}`
  ),
  ...[...CHALLENGE_JOIN_ERROR_CODES, "rate_limited", "offline", "generic"].map((code) => `quizChallenge.play.errors.${code}`),
  ...["attempts_exhausted", "challenge_not_open", "challenge_closed", "attempt_not_found", "challenge_empty", "banned", "token", "offline", "generic"].map(
    (code) => `quizChallenge.play.attemptErrors.${code}`
  ),
  ...["correct", "partial", "incorrect", "noAnswer", "notScored"].map((status) => `quizChallenge.play.summary.corrections.status.${status}`),
  ...["now", "later", "shortcut1", "shortcut3", "shortcut7"].map((key) => `quizChallenge.create.window.${key}`),
  ...["plus1", "plus3", "plus7"].map((key) => `quizChallenge.panel.postponeDialog.${key}`),
  "quizChallenge.panel.opensIn",
  "quizChallenge.panel.closesIn"
];

describe("challenge i18n: runtime keys", () => {
  it("exist in both locales", () => {
    for (const locale of ["pt-BR", "en-US"] as const) {
      const messages = getMessages(locale);
      const missing = DYNAMIC.filter((key) => typeof getMessageValue(messages, key) !== "string");
      expect(missing, locale).toEqual([]);
    }
  });
});
