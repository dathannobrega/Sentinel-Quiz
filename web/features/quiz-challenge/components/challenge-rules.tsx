"use client";

import type { ReactNode } from "react";

import type { ChallengePlay } from "@/features/quiz-challenge/lib/use-challenge-play";
import { LqButton, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import { PhaseHeading } from "@/features/quiz-play/components/participant-phases";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveChallengeFeedback, LiveChallengeInfo, LiveChallengeTimeMode } from "@/types/api";

/** "4 perguntas · 20 minutos no total · 2 tentativas · correção ao terminar · com ranking". */
export function ruleLines(
  t: (key: string, values?: Record<string, string | number>) => string,
  info: Pick<LiveChallengeInfo, "item_count" | "time_mode" | "total_time_s" | "attempts" | "feedback" | "leaderboard" | "closes_at">,
  closesAt: string,
  attemptsLeft: number = info.attempts
): Array<{ id: string; text: string }> {
  const minutes = Math.max(1, Math.round((info.total_time_s ?? 0) / 60));
  const time: Record<LiveChallengeTimeMode, string> = {
    per_item: t("quizChallenge.play.rules.time.per_item"),
    total: t("quizChallenge.play.rules.time.total", { minutes }),
    none: t("quizChallenge.play.rules.time.none")
  };
  const feedback: Record<LiveChallengeFeedback, string> = {
    each: t("quizChallenge.play.rules.feedback.each"),
    end: t("quizChallenge.play.rules.feedback.end"),
    after_close: t("quizChallenge.play.rules.feedback.after_close", { date: closesAt }),
    never: t("quizChallenge.play.rules.feedback.never")
  };
  return [
    {
      id: "questions",
      text: info.item_count === 1 ? t("quizChallenge.play.rules.questionsOne") : t("quizChallenge.play.rules.questions", { count: info.item_count })
    },
    { id: "time", text: time[info.time_mode] },
    {
      id: "attempts",
      text: attemptsLeft === 1 ? t("quizChallenge.play.rules.attemptsOne") : t("quizChallenge.play.rules.attempts", { count: attemptsLeft })
    },
    { id: "feedback", text: feedback[info.feedback] },
    { id: "leaderboard", text: info.leaderboard ? t("quizChallenge.play.rules.leaderboard") : t("quizChallenge.play.rules.noLeaderboard") }
  ];
}

const ICONS: Record<string, ReactNode> = {
  questions: <path d="M4 5h12M4 10h12M4 15h8" />,
  time: (
    <>
      <circle cx="10" cy="11" r="6" />
      <path d="M10 8v3l2 1.5M8 2.5h4" />
    </>
  ),
  attempts: <path d="M15.5 8A6 6 0 1 0 16 12M16 4v4h-4" />,
  feedback: <path d="M4.5 10.5l3.5 3.5 7.5-8" />,
  leaderboard: <path d="M5 16V10M10 16V5M15 16v-4" />
};

/** Before the first attempt: what to expect, then "Começar". */
export function ChallengeRules({ info, play }: { info: LiveChallengeInfo; play: ChallengePlay }) {
  const { t, locale } = useI18n();
  const closesAt = info.closes_at ? new Date(info.closes_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "–";
  // `attempts_used` counts every attempt this person has (after a reload or on another device).
  const attemptsLeft = Math.max(0, info.attempts - (play.attempt?.attempts_used ?? 0));
  const lines = ruleLines(t, info, closesAt, attemptsLeft);
  const open = info.state === "open";
  return (
    <div className="flex flex-1 flex-col gap-5">
      <section className={cn(lqCardClass, "flex flex-col gap-4 px-5 py-6")} aria-labelledby="challenge-rules-title">
        <div>
          <p className="font-lq-mono text-xs font-medium tracking-[0.2em] text-lq-accent uppercase">{t("quizChallenge.play.rules.kicker")}</p>
          <PhaseHeading className="text-2xl">
            <span id="challenge-rules-title">{t("quizChallenge.play.rules.title")}</span>
          </PhaseHeading>
        </div>
        <ul className="flex flex-col gap-3">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start gap-3 text-lq-fg">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-5 shrink-0 text-lq-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {ICONS[line.id]}
              </svg>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
        {info.leaderboard ? <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.rules.bestCounts")}</p> : null}
      </section>
      {open ? (
        <LqButton size="lg" onClick={() => void play.start()} busy={play.busy === "start"} busyLabel={t("quizChallenge.play.rules.starting")}>
          {t("quizChallenge.play.rules.start")}
        </LqButton>
      ) : (
        <p role="status" className="text-center text-lq-fg-muted">
          {info.state === "closed" ? t("quizChallenge.play.rules.noAttempt") : t("quizChallenge.play.attemptErrors.challenge_not_open")}
        </p>
      )}
    </div>
  );
}
