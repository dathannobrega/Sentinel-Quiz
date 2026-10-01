"use client";

import { useEffect, useState } from "react";
import { m } from "motion/react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { springs, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { TrophyIcon } from "@/components/quiz-kit/podium";
import { correctionStatus, describeKey, describeYourAnswer, type CorrectionStatus } from "@/features/quiz-challenge/lib/challenge-corrections";
import { formatDurationShort } from "@/features/quiz-challenge/lib/challenge-time";
import type { ChallengePlay } from "@/features/quiz-challenge/lib/use-challenge-play";
import { LqButton, LqError, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import type { ParticipantCredentials } from "@/features/quiz-live/lib/live-fetch";
import { ClaimCard } from "@/features/quiz-play/components/claim-card";
import { PhaseHeading } from "@/features/quiz-play/components/participant-phases";
import { getChallengeLeaderboard } from "@/lib/api/live-challenge";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveAttemptSummary, LiveChallengeInfo, LiveChallengeLeaderboard, LiveChallengeSummaryItem, LiveJoinResult } from "@/types/api";

function ordinal(locale: string, rank: number): string {
  return locale === "pt-BR" ? `${rank}º` : `#${rank}`;
}

const STATUS_BADGE: Record<CorrectionStatus, string> = {
  correct: "bg-lq-success text-lq-on-success",
  incorrect: "bg-lq-danger text-lq-on-danger",
  noAnswer: "bg-lq-danger text-lq-on-danger",
  partial: "bg-lq-warning text-lq-on-warning",
  notScored: "bg-lq-surface-2 text-lq-fg"
};
const STATUS_MARK: Record<CorrectionStatus, string> = { correct: "✓", incorrect: "✕", noAnswer: "–", partial: "½", notScored: "·" };

/** End of an attempt: score, position, corrections per policy, "Tentar de novo", ranking and claim. */
export function ChallengeSummary({
  slug,
  info,
  play,
  credentials,
  onTokenRefreshed
}: {
  slug: string;
  info: LiveChallengeInfo;
  play: ChallengePlay;
  credentials: ParticipantCredentials;
  onTokenRefreshed?: (result: LiveJoinResult) => void;
}) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  const attempt = play.attempt;
  const summary = attempt?.summary;
  if (!attempt || !summary) {
    return null;
  }
  const number = new Intl.NumberFormat(locale);
  const closed = info.state === "closed" || summary.finish_reason === "closed";
  return (
    <div className="flex flex-1 flex-col gap-5">
      <section className={cn(lqCardClass, "flex flex-col items-center gap-3 px-5 py-7 text-center")}>
        <m.span
          className="grid size-20 place-items-center rounded-full bg-lq-accent text-lq-on-accent"
          initial={reduced ? false : { scale: 0.3, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={springs.bouncy}
        >
          <TrophyIcon className="size-11" />
        </m.span>
        <PhaseHeading className="text-3xl">{t("quizChallenge.play.summary.title")}</PhaseHeading>
        {summary.finish_reason ? <p className="text-lq-fg-muted">{t(`quizChallenge.play.summary.reasons.${summary.finish_reason}`)}</p> : null}
        <p className="font-lq text-4xl font-black text-lq-fg">{t("quizChallenge.play.summary.score", { score: number.format(summary.score) })}</p>
        <dl className="grid w-full grid-cols-2 gap-2 text-left text-sm">
          <SummaryStat label={t("quizChallenge.play.summary.correctLabel")} value={t("quizChallenge.play.summary.correct", { correct: summary.correct, total: summary.scored_questions })} />
          <SummaryStat label={t("quizChallenge.play.summary.answeredLabel")} value={t("quizChallenge.play.summary.answered", { answered: summary.answered, total: summary.questions })} />
          <SummaryStat label={t("quizChallenge.play.summary.durationLabel")} value={formatDurationShort(summary.duration_ms)} />
          {attempt.leaderboard && summary.rank ? (
            <SummaryStat label={t("quizChallenge.play.summary.rankLabel")} value={t("quizChallenge.play.summary.rank", { rank: ordinal(locale, summary.rank), total: summary.ranked })} />
          ) : (
            <SummaryStat
              label={t("quizChallenge.play.summary.attemptsUsedLabel")}
              value={t("quizChallenge.play.summary.attemptOf", { n: attempt.attempts_used ?? attempt.attempt_no, total: attempt.attempts_allowed })}
            />
          )}
        </dl>
        {attempt.attempt_no > 1 || summary.best_score !== summary.score ? (
          <p className="font-lq-mono text-sm text-lq-fg-muted">{t("quizChallenge.play.summary.best", { score: number.format(summary.best_score) })}</p>
        ) : null}
      </section>

      {summary.attempts_left > 0 ? (
        <div className="flex flex-col gap-2">
          <LqButton size="lg" onClick={() => void play.start()} busy={play.busy === "start"} busyLabel={t("quizChallenge.play.rules.starting")}>
            {t("quizChallenge.play.summary.tryAgain")}
          </LqButton>
          <p className="text-center text-sm text-lq-fg-muted">
            {summary.attempts_left === 1 ? t("quizChallenge.play.summary.attemptsLeftOne") : t("quizChallenge.play.summary.attemptsLeft", { count: summary.attempts_left })}
            {attempt.leaderboard ? ` ${t("quizChallenge.play.rules.bestCounts")}` : ""}
          </p>
        </div>
      ) : !closed ? (
        <p className="text-center text-sm text-lq-fg-muted">{t("quizChallenge.play.summary.noAttemptsLeft")}</p>
      ) : null}

      <Corrections summary={summary} feedback={attempt.feedback} />

      {attempt.leaderboard ? <ChallengeLeaderboardCard slug={slug} token={credentials.token} meId={credentials.participantId} /> : null}

      {closed ? (
        <ClaimCard
          code={slug}
          token={credentials.token}
          sessionId={credentials.sessionId}
          defaultName={credentials.displayName}
          onTokenRefreshed={onTokenRefreshed}
          returnTo={`/q/${encodeURIComponent(slug)}?claim=1`}
        />
      ) : null}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-[calc(var(--lq-radius)*0.5)] bg-lq-surface-2 px-3 py-2">
      <dt className="text-xs text-lq-fg-muted">{label}</dt>
      <dd className="font-lq font-bold text-lq-fg tabular-nums">{value}</dd>
    </div>
  );
}

/** The key per policy; when hidden, says when it will show (after the deadline) or that it never will. */
export function Corrections({ summary, feedback }: { summary: LiveAttemptSummary; feedback: string }) {
  const { t, locale } = useI18n();
  if (!summary.corrections_visible || !summary.items.length) {
    let text: string | null = null;
    if (feedback === "never") {
      text = t("quizChallenge.play.summary.corrections.hiddenNever");
    } else if (feedback === "after_close" || summary.corrections_at) {
      const date = summary.corrections_at ? new Date(summary.corrections_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "–";
      text = t("quizChallenge.play.summary.corrections.hiddenAfterClose", { date });
    }
    return text ? (
      <section className={cn(lqCardClass, "flex flex-col gap-1 px-5 py-4")}>
        <h3 className="font-lq text-lg font-extrabold text-lq-fg">{t("quizChallenge.play.summary.corrections.title")}</h3>
        <p className="text-sm text-lq-fg-muted">{text}</p>
      </section>
    ) : null;
  }
  return (
    <section aria-labelledby="challenge-corrections-title" className="flex flex-col gap-3">
      <h3 id="challenge-corrections-title" className="font-lq text-xl font-extrabold text-lq-fg">
        {t("quizChallenge.play.summary.corrections.title")}
      </h3>
      <ol className="flex flex-col gap-3">
        {summary.items.map((item, index) => (
          <CorrectionCard key={`${item.qi}-${index}`} item={item} index={index} locale={locale} />
        ))}
      </ol>
    </section>
  );
}

function CorrectionCard({ item, index, locale }: { item: LiveChallengeSummaryItem; index: number; locale: string }) {
  const { t } = useI18n();
  const status = correctionStatus(item);
  const yours = describeYourAnswer(item, item.question, locale);
  const key = describeKey(item, item.question, locale);
  return (
    <li className={cn(lqCardClass, "flex flex-col gap-2 p-4")}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-lq-mono text-xs text-lq-fg-muted">{t("quizChallenge.play.summary.corrections.item", { n: index + 1 })}</span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold", STATUS_BADGE[status])}>
          <span aria-hidden="true">{STATUS_MARK[status]}</span>
          {t(`quizChallenge.play.summary.corrections.status.${status}`)}
        </span>
      </div>
      <p className="font-semibold text-lq-fg">{item.prompt || item.question?.prompt}</p>
      <dl className="grid gap-1 text-sm">
        <div className="flex flex-wrap gap-x-2">
          <dt className="text-lq-fg-muted">{t("quizChallenge.play.summary.corrections.yourAnswer")}:</dt>
          <dd className="text-lq-fg">{yours ?? t("quizChallenge.play.summary.corrections.noAnswer")}</dd>
        </div>
        {key ? (
          <div className="flex flex-wrap gap-x-2">
            <dt className="text-lq-fg-muted">{t("quizChallenge.play.summary.corrections.correctAnswer")}:</dt>
            <dd className="font-semibold text-lq-fg">{key}</dd>
          </div>
        ) : null}
      </dl>
      {item.points ? <p className="font-lq-mono text-xs text-lq-fg-muted">{t("quizChallenge.play.summary.corrections.points", { points: new Intl.NumberFormat(locale).format(item.points) })}</p> : null}
      {item.explanation ? (
        <details className="group">
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center text-sm font-semibold text-lq-fg">{t("quizPlay.reveal.explanation")}</summary>
          <p className="mt-1 font-serif text-sm leading-relaxed whitespace-pre-line text-lq-fg">{item.explanation}</p>
        </details>
      ) : null}
    </li>
  );
}

/** Top 10 + me (provisional until the deadline). Hidden when the challenge has no leaderboard. */
export function ChallengeLeaderboardCard({ slug, token, meId }: { slug: string; token: string; meId: string }) {
  const { t, locale } = useI18n();
  const [board, setBoard] = useState<LiveChallengeLeaderboard | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getChallengeLeaderboard(slug, token, controller.signal)
      .then((data) => {
        setBoard(data);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, [slug, token, attempt]);

  if (failed) {
    return (
      <div className="flex flex-col gap-2">
        <LqError>{t("quizChallenge.play.leaderboard.error")}</LqError>
        <LqButton variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {t("quizPlay.room.retry")}
        </LqButton>
      </div>
    );
  }
  if (!board) {
    return null;
  }
  const number = new Intl.NumberFormat(locale);
  const meInTop = board.me ? board.top.some((row) => row.participant_id === board.me?.participant_id) : false;
  const rows = board.me && !meInTop ? [...board.top, board.me] : board.top;
  return (
    <section aria-labelledby="challenge-board-title" className={cn(lqCardClass, "flex flex-col gap-3 px-4 py-5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="challenge-board-title" className="font-lq text-xl font-extrabold text-lq-fg">
          {board.final ? t("quizChallenge.play.leaderboard.final") : t("quizChallenge.play.leaderboard.title")}
        </h3>
        {!board.final ? <span className="text-xs text-lq-fg-muted">{t("quizChallenge.play.leaderboard.provisional")}</span> : null}
      </div>
      {board.me ? (
        <p className="font-semibold text-lq-accent">{t("quizChallenge.play.leaderboard.yourPosition", { rank: ordinal(locale, board.me.rank), total: board.total })}</p>
      ) : (
        <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.leaderboard.notRanked")}</p>
      )}
      {rows.length ? (
        <ol className="flex flex-col gap-2">
          {rows.map((row, index) => {
            const isMe = row.participant_id === meId || row.participant_id === board.me?.participant_id;
            return (
              <li
                key={row.participant_id}
                className={cn(
                  "flex items-center gap-3 rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface px-3 py-2",
                  isMe && "border-lq-accent bg-lq-surface-2",
                  index === board.top.length && "mt-2"
                )}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-full font-lq-mono text-base tabular-nums", row.rank <= 3 ? "bg-lq-accent text-lq-on-accent" : "bg-lq-surface-2 text-lq-fg")}>
                  {row.rank}
                </span>
                <Avatar seed={row.avatar_seed} size={32} />
                <span className="min-w-0 flex-1 truncate font-lq font-bold text-lq-fg">
                  {row.display_name}
                  {isMe ? <span className="ml-2 text-xs font-semibold text-lq-accent">{t("quizChallenge.play.leaderboard.you")}</span> : null}
                </span>
                <span className="font-lq font-extrabold text-lq-fg tabular-nums">
                  {number.format(row.score)}
                  <span className="sr-only"> {t("quizChallenge.play.leaderboard.points")}</span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
