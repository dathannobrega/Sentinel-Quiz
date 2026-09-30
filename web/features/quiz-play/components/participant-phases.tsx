"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { m } from "motion/react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { Avatar } from "@/components/quiz-kit/avatar";
import { DrawnCheck } from "@/components/quiz-kit/bar-chart";
import { Leaderboard } from "@/components/quiz-kit/leaderboard";
import { springs, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { OptionBadge } from "@/components/quiz-kit/option-shape";
import { TrophyIcon } from "@/components/quiz-kit/podium";
import { PauseGlyph, vibrate } from "@/features/quiz-live/components/live-chrome";
import { LqButton, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import type { LiveLeaderboard, LiveSubmission } from "@/features/quiz-live/lib/live-store";
import { OPTION_SHAPE_GLYPHS, optionLetter, type MyReveal, type PublicQuestion, type Reveal } from "@/features/quiz-live/lib/protocol";
import { MyResultsPanel } from "@/features/quiz-play/components/my-results";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

function ordinal(locale: string, rank: number): string {
  return locale === "pt-BR" ? `${rank}º` : `#${rank}`;
}

/**
 * When a phase swap removes the focused control (focus falls back to <body>), move focus to the new
 * phase heading so keyboard/screen-reader users are not stranded. Never steals focus from a control
 * the person is using; the polite live region announces the change either way.
 */
function useFocusHeading<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      ref.current?.focus({ preventScroll: true });
    }
  }, []);
  return ref;
}

export function PhaseHeading({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useFocusHeading<HTMLHeadingElement>();
  return (
    <h2 ref={ref} tabIndex={-1} className={cn("font-lq font-extrabold text-lq-fg outline-none", className)}>
      {children}
    </h2>
  );
}

// ----------------------------------------------------------------------------- lobby

export function WaitingLobby({ name, seed, count }: { name: string; seed: string; count: number }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="relative">
        {!reduced ? (
          <m.span
            aria-hidden="true"
            className="absolute inset-0 rounded-[30%] bg-lq-accent"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
          />
        ) : null}
        <m.span className="relative block" initial={{ scale: 0.3, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={springs.bouncy}>
          <Avatar seed={seed} size={112} />
        </m.span>
      </div>
      <div className="flex flex-col gap-1">
        <PhaseHeading className="text-3xl">{t("quizPlay.lobby.title")}</PhaseHeading>
        <p className="font-lq text-2xl font-bold break-words text-lq-accent">{name}</p>
      </div>
      <p className="text-lq-fg-muted">{t("quizPlay.lobby.findYourName")}</p>
      <div className="flex items-center gap-3 rounded-full border border-lq-line bg-lq-surface px-5 py-3">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <m.span
              key={dot}
              className="size-2 rounded-full bg-lq-accent"
              animate={reduced ? undefined : { y: [0, -6, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: dot * 0.15 }}
            />
          ))}
        </span>
        <span className="font-semibold text-lq-fg">{t("quizPlay.lobby.waiting")}</span>
      </div>
      <p className="text-sm text-lq-fg-muted">{t("quizPlay.lobby.count", { count })}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------- reading phase

export function ReadingView({ question, seconds }: { question: PublicQuestion; seconds: number }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <p className="font-lq-mono text-sm font-medium tracking-[0.2em] text-lq-accent uppercase">{t("quizPlay.question.getReady")}</p>
      <p className="font-lq-prompt text-2xl leading-snug font-bold text-balance text-lq-fg">{question.prompt}</p>
      <m.span
        key={seconds}
        aria-hidden="true"
        className="grid size-24 place-items-center rounded-full border-4 border-lq-accent font-lq-mono text-5xl text-lq-fg"
        initial={reduced ? false : { scale: 1.4 }}
        animate={{ scale: 1 }}
        transition={{ type: "tween", duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
      >
        {seconds}
      </m.span>
      <p className="sr-only">{t("quizPlay.question.readingSr", { seconds })}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------- paused (host pause)

/**
 * The host paused the open question: nothing can be answered and the timer is frozen. Shows the
 * time that will be left (the participant's own, extended time included) when the host resumes.
 */
export function PausedView({ question, secondsLeft }: { question: PublicQuestion | null; secondsLeft: number | null }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  useEffect(() => {
    vibrate([15, 60, 15]);
  }, []);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <m.div
        className="relative grid size-28 place-items-center rounded-full bg-lq-warning text-lq-on-warning"
        initial={reduced ? false : { scale: 0.6, rotate: -12 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springs.bouncy}
      >
        {!reduced ? (
          <m.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-4 border-lq-warning"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.6, opacity: 0 }}
            transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity, repeatDelay: 0.6 }}
          />
        ) : null}
        <PauseGlyph className="lq-paused-breathe size-12" />
      </m.div>
      <div className="flex flex-col gap-2">
        <PhaseHeading className="text-3xl">{t("quizPlay.paused.title")}</PhaseHeading>
        <p className="text-lq-fg-muted">{t("quizPlay.paused.subtitle")}</p>
      </div>
      {typeof secondsLeft === "number" ? (
        <p className="rounded-full bg-lq-surface-2 px-4 py-1.5 font-lq-mono text-sm text-lq-fg tabular-nums">{t("quizPlay.paused.timeLeft", { seconds: secondsLeft })}</p>
      ) : null}
      {question ? <p className="line-clamp-3 max-w-md font-lq-prompt text-lg leading-snug font-semibold text-balance text-lq-fg-muted">{question.prompt}</p> : null}
    </div>
  );
}

/** Personal extended-time badge (RF-622): "Tempo estendido: 1,5×" or "Sem limite de tempo". */
export function ExtendedTimeBadge({ multiplier, className }: { multiplier: number; className?: string }) {
  const { t, locale } = useI18n();
  if (multiplier === 1) {
    return null;
  }
  const untimed = multiplier === 0;
  return (
    <span
      title={untimed ? t("quizPlay.question.untimedHint") : undefined}
      className={cn("inline-flex items-center gap-1.5 rounded-full border border-lq-line bg-lq-surface px-3 py-1 text-xs font-semibold text-lq-fg", className)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 fill-none stroke-current" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="8" cy="9" r="5.5" />
        <path d="M8 6.2V9l1.8 1.2M6.5 1.8h3" />
      </svg>
      {untimed ? t("quizPlay.question.untimed") : t("quizPlay.question.extendedTime", { multiplier: new Intl.NumberFormat(locale).format(multiplier) })}
    </span>
  );
}

// ----------------------------------------------------------------------------- submitted / locked

function ChosenAnswer({ question, submission }: { question: PublicQuestion | null; submission: LiveSubmission | null }) {
  const { t } = useI18n();
  if (!submission) {
    return null;
  }
  if (submission.answer.text) {
    return <p className="rounded-[calc(var(--lq-radius)*0.6)] bg-lq-surface-2 px-4 py-3 font-lq text-xl font-bold break-words text-lq-fg">“{submission.answer.text}”</p>;
  }
  const chosen = (question?.options ?? []).filter((option) => submission.answer.choice?.includes(option.id));
  if (!chosen.length) {
    return null;
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs font-semibold tracking-[0.14em] text-lq-fg-muted uppercase">{t("quizPlay.submitted.yourChoice")}</span>
      <ul className="flex flex-wrap justify-center gap-2">
        {chosen.map((option) => (
          <li key={option.id} className={cn("lq-tile flex max-w-full items-center gap-2 px-3 py-2", `lq-slot-${option.index % 6}`)}>
            <OptionBadge index={option.index} size="sm" />
            <span className="line-clamp-2 font-semibold">{option.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SubmittedView({
  question,
  submission,
  answered,
  total,
  onRetry
}: {
  question: PublicQuestion | null;
  submission: LiveSubmission;
  answered: number | null;
  total: number | null;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  if (submission.status === "rejected") {
    const key = submission.ack === "late" || submission.ack === "closed" || submission.ack === "paused" ? submission.ack : "invalid";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <PhaseHeading className="text-2xl">{t(`quizPlay.submitted.rejected.${key}`)}</PhaseHeading>
        {key === "invalid" && onRetry ? <LqButton onClick={onRetry}>{t("quizPlay.room.retry")}</LqButton> : null}
      </div>
    );
  }
  const sending = submission.status === "sending";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <m.div
        className="relative grid size-28 place-items-center rounded-full bg-lq-accent text-lq-on-accent"
        initial={reduced ? false : { scale: 0.2, rotate: -45 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springs.bouncy}
      >
        {!reduced ? (
          <m.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-4 border-lq-accent"
            initial={{ scale: 1, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut", repeat: sending ? Infinity : 0 }}
          />
        ) : null}
        {sending ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" className="size-12 animate-spin [animation-duration:1.4s]">
            <path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        ) : (
          <DrawnCheck className="size-14" delay={120} />
        )}
      </m.div>
      <div className="flex flex-col gap-1">
        <PhaseHeading className="text-3xl">{sending ? t("quizPlay.submitted.sending") : t("quizPlay.submitted.title")}</PhaseHeading>
        <p className="text-lq-fg-muted">{t("quizPlay.submitted.waiting")}</p>
      </div>
      <ChosenAnswer question={question} submission={submission} />
      {typeof answered === "number" && total ? (
        <p className="font-lq-mono text-sm text-lq-fg-muted">{t("quizPlay.submitted.progress", { answered, total })}</p>
      ) : null}
    </div>
  );
}

export function LockedView({ question, submission }: { question: PublicQuestion | null; submission: LiveSubmission | null }) {
  const { t } = useI18n();
  useEffect(() => {
    vibrate(20);
  }, []);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
      <LockGlyph />
      <PhaseHeading className="text-3xl">{t("quizPlay.locked.title")}</PhaseHeading>
      <p className="text-lq-fg-muted">{submission ? t("quizPlay.locked.subtitle") : t("quizPlay.locked.missed")}</p>
      <ChosenAnswer question={question} submission={submission} />
    </div>
  );
}

/** Padlock whose shackle drops shut (translateY). */
export function LockGlyph({ className }: { className?: string }) {
  const reduced = useLqReducedMotion();
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={cn("size-20 text-lq-accent", className)}>
      <m.path
        d="M15 22v-6a9 9 0 0 1 18 0v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        initial={reduced ? false : { y: -7 }}
        animate={{ y: 0 }}
        transition={{ type: "tween", duration: 0.3, ease: [0.3, 0, 0.8, 0.15], delay: 0.15 }}
      />
      <rect x="10" y="21" width="28" height="21" rx="5" fill="currentColor" />
      <circle cx="24" cy="31" r="3" fill="var(--lq-bg)" />
    </svg>
  );
}

// ----------------------------------------------------------------------------- reveal

type Verdict = "correct" | "partial" | "incorrect" | "none" | "poll" | "recorded";

export function verdictFor(question: PublicQuestion | null, reveal: Reveal, my: MyReveal | undefined): Verdict {
  const type = reveal.item_type;
  if (type === "poll") {
    return "poll";
  }
  if (!my || !my.answered) {
    return my ? "none" : "recorded";
  }
  if (question && !question.scored && my.correct === null) {
    return "recorded";
  }
  if (my.correct === true) {
    return "correct";
  }
  if (my.fraction !== null && my.fraction > 0 && my.fraction < 1) {
    return "partial";
  }
  if (my.correct === false) {
    return "incorrect";
  }
  return "recorded";
}

export function RevealFeedback({
  question,
  reveal,
  showCorrect,
  showExplanation
}: {
  question: PublicQuestion | null;
  reveal: Reveal;
  showCorrect: boolean;
  showExplanation: boolean;
}) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  const my = reveal.my;
  const verdict = verdictFor(question, reveal, my);

  useEffect(() => {
    if (verdict === "correct") {
      vibrate([30, 40, 30]);
    } else if (verdict === "incorrect") {
      vibrate(80);
    }
  }, [verdict]);

  const correctOptions = (question?.options ?? []).filter((option) => reveal.correct_option_ids.includes(option.id));
  const tone =
    verdict === "correct"
      ? "bg-lq-success text-lq-on-success"
      : verdict === "incorrect" || verdict === "none"
        ? "bg-lq-danger text-lq-on-danger"
        : verdict === "partial"
          ? "bg-lq-warning text-lq-on-warning"
          : "bg-lq-accent text-lq-on-accent";
  const title = {
    correct: t("quizPlay.reveal.correct"),
    partial: t("quizPlay.reveal.partial"),
    incorrect: t("quizPlay.reveal.incorrect"),
    none: t("quizPlay.reveal.noAnswer"),
    poll: t("quizPlay.reveal.pollDone"),
    recorded: t("quizPlay.reveal.recorded")
  }[verdict];
  const streakMilestone = my && my.streak >= 3 ? (my.streak >= 7 ? 3 : my.streak >= 5 ? 2 : 1) : 0;

  return (
    <div className="flex flex-1 flex-col gap-5">
      <m.section
        className={cn("relative flex flex-col items-center gap-3 overflow-hidden rounded-[var(--lq-radius)] px-5 py-7 text-center", tone, verdict === "incorrect" && !reduced && "lq-shake")}
        initial={reduced ? false : { scale: 0.9 }}
        animate={{ scale: 1 }}
        transition={springs.bouncy}
      >
        <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-[color-mix(in_srgb,currentColor_16%,transparent)]">
          {verdict === "correct" ? (
            <DrawnCheck className="size-10" delay={150} />
          ) : verdict === "incorrect" ? (
            <svg viewBox="0 0 24 24" className="size-9">
              <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          ) : verdict === "none" ? (
            <svg viewBox="0 0 24 24" className="size-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2M9.5 2.5h5" />
            </svg>
          ) : verdict === "partial" ? (
            <svg viewBox="0 0 24 24" className="size-9">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
            </svg>
          ) : (
            <DrawnCheck className="size-10" />
          )}
        </span>
        <PhaseHeading className="text-3xl text-current">{title}</PhaseHeading>
        {my && my.answered && question?.scored && reveal.item_type !== "poll" ? (
          <p className="flex flex-col items-center">
            <AnimatedNumber value={my.points} prefix="+" from={0} delay={0.25} className="font-lq text-5xl font-black" />
            <span className="text-sm font-semibold">{t("quizPlay.reveal.pointsLabel")}</span>
          </p>
        ) : null}
        {verdict === "incorrect" || verdict === "none" ? <p className="text-sm font-semibold">{t("quizPlay.reveal.encouragement")}</p> : null}
      </m.section>

      {my && (streakMilestone > 0 || my.rank) ? (
        <div className="flex flex-wrap items-stretch justify-center gap-3">
          {streakMilestone > 0 ? (
            <m.span
              className="flex items-center gap-2 rounded-full bg-lq-warning px-4 py-2 font-lq font-bold text-lq-on-warning"
              initial={reduced ? false : { scale: 0.5 }}
              animate={{ scale: 1 + streakMilestone * 0.06 }}
              transition={{ ...springs.bouncy, delay: 0.5 }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
                <path d="M8.6 1c.4 2.2-1.6 3.4-2.5 5.1C5.2 7.9 5.6 10 7 10.6c-.4-1.4.3-2.6 1.3-3.3.2 1.6 1.7 2.1 1.7 3.8 0 1.3-.9 2.4-2.2 2.9 2.9.2 5-1.8 5-4.6C12.8 6 9.9 4.3 8.6 1Z" />
              </svg>
              {t("quizPlay.reveal.streak", { count: my.streak })}
            </m.span>
          ) : null}
          {my.rank ? (
            <span className="flex items-center gap-2 rounded-full border border-lq-line bg-lq-surface px-4 py-2 font-lq font-bold text-lq-fg">
              {t("quizPlay.reveal.rank", { rank: my.rank })}
              {my.rank_delta ? (
                <span className={cn("font-lq-mono text-sm", my.rank_delta > 0 ? "text-lq-success" : "text-lq-fg-muted")}>
                  <span aria-hidden="true">{my.rank_delta > 0 ? "▲" : "▼"}</span>
                  {my.rank_delta > 0 ? t("quizPlay.reveal.rankUp", { n: my.rank_delta }) : t("quizPlay.reveal.rankDown", { n: Math.abs(my.rank_delta) })}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {showCorrect && verdict !== "correct" && verdict !== "poll" && correctOptions.length ? (
        <div className={cn(lqCardClass, "flex flex-col gap-2 p-4")}>
          <p className="text-sm font-semibold text-lq-fg-muted">{t("quizPlay.reveal.correctWas", { answer: correctOptions.map((option) => optionLabel(option.index)).join(", ") })}</p>
          <ul className="flex flex-col gap-2">
            {correctOptions.map((option) => (
              <li key={option.id} className={cn("lq-tile flex items-center gap-3 px-3 py-2", `lq-slot-${option.index % 6}`)}>
                <OptionBadge index={option.index} size="sm" />
                <span className="font-semibold">{option.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showCorrect && reveal.item_type === "type_answer" && reveal.accepted_answers.length && verdict !== "correct" ? (
        <p className={cn(lqCardClass, "p-4 text-lq-fg")}>{t("quizPlay.reveal.acceptedWere", { answer: reveal.accepted_answers.join(" · ") })}</p>
      ) : null}

      {my ? <p className="text-center font-lq-mono text-sm text-lq-fg-muted">{t("quizPlay.reveal.total", { score: new Intl.NumberFormat(locale).format(my.total_score) })}</p> : null}

      {showExplanation && reveal.explanation ? (
        <details className={cn(lqCardClass, "group p-4")}>
          <summary className="focus-ring flex min-h-11 cursor-pointer items-center font-semibold text-lq-fg">{t("quizPlay.reveal.explanation")}</summary>
          <p className="mt-2 font-serif leading-relaxed whitespace-pre-line text-lq-fg">{reveal.explanation}</p>
        </details>
      ) : null}
    </div>
  );
}

function optionLabel(index: number): string {
  return `${OPTION_SHAPE_GLYPHS[index % OPTION_SHAPE_GLYPHS.length]} ${optionLetter(index)}`;
}

// ----------------------------------------------------------------------------- leaderboard

export function StandingView({ leaderboard, meId }: { leaderboard: LiveLeaderboard | null; meId: string | null }) {
  const { t, locale } = useI18n();
  const my = leaderboard?.my;
  const top = leaderboard?.top.slice(0, 5) ?? [];
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className={cn(lqCardClass, "flex flex-col items-center gap-2 px-5 py-6 text-center")}>
        <PhaseHeading className="text-sm tracking-[0.14em] text-lq-fg-muted uppercase">{t("quizPlay.leaderboard.yourPosition")}</PhaseHeading>
        {my?.rank ? (
          <>
            <m.p className="font-lq text-6xl font-black text-lq-fg" initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={springs.bouncy}>
              {ordinal(locale, my.rank)}
            </m.p>
            <p className="font-lq-mono text-lq-fg-muted">{t("quizPlay.leaderboard.score", { score: new Intl.NumberFormat(locale).format(my.score) })}</p>
            <p className="font-semibold text-lq-accent">
              {my.rank === 1
                ? t("quizPlay.leaderboard.leading")
                : my.behind_by !== null
                  ? t("quizPlay.leaderboard.behind", { points: new Intl.NumberFormat(locale).format(my.behind_by), rank: my.rank - 1 })
                  : null}
            </p>
          </>
        ) : (
          <p className="text-lq-fg-muted">{t("quizPlay.leaderboard.notRanked")}</p>
        )}
      </div>
      {top.length ? (
        <Leaderboard
          standings={top}
          size="compact"
          highlightId={meId}
          labels={{
            points: t("quizPresent.leaderboard.points"),
            up: (n) => t("quizPresent.leaderboard.up", { n }),
            down: (n) => t("quizPresent.leaderboard.down", { n }),
            same: t("quizPresent.leaderboard.same"),
            biggestClimb: t("quizPresent.leaderboard.biggestClimb"),
            rankOrdinal: (rank) => t("quizPresent.leaderboard.rank", { rank })
          }}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- final

export function FinalView({
  rank,
  total,
  score,
  podiumPhase,
  token
}: {
  rank: number | null;
  total: number;
  score: number;
  podiumPhase: boolean;
  token: string | null;
}) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  const [showResults, setShowResults] = useState(false);
  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className={cn(lqCardClass, "flex flex-col items-center gap-3 px-5 py-8 text-center")}>
        <m.span
          className="grid size-20 place-items-center rounded-full bg-lq-accent text-lq-on-accent"
          initial={reduced ? false : { scale: 0.3, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={springs.bouncy}
        >
          <TrophyIcon className="size-11" />
        </m.span>
        <PhaseHeading className="text-3xl">{t("quizPlay.final.title")}</PhaseHeading>
        {rank ? <p className="font-lq text-xl font-bold text-lq-fg">{t("quizPlay.final.place", { rank, total })}</p> : null}
        <p className="font-lq-mono text-lq-fg-muted">{t("quizPlay.final.score", { score: new Intl.NumberFormat(locale).format(score) })}</p>
        <p className="text-lq-fg-muted">{podiumPhase ? t("quizPlay.final.podiumWait") : t("quizPlay.final.thanks")}</p>
      </div>
      {token ? (
        <>
          <LqButton variant="secondary" size="lg" aria-expanded={showResults} onClick={() => setShowResults((value) => !value)}>
            {showResults ? t("quizPlay.final.hideResults") : t("quizPlay.final.viewResults")}
          </LqButton>
          {showResults ? <MyResultsPanel token={token} /> : null}
        </>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- content

export function ContentView({ question }: { question: PublicQuestion | null }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <PhaseHeading className="text-sm tracking-[0.14em] text-lq-fg-muted uppercase">{t("quizPlay.content.title")}</PhaseHeading>
      {question?.prompt ? <p className="font-lq-prompt text-2xl font-bold text-balance text-lq-fg">{question.prompt}</p> : null}
      {question?.body ? <p className="max-w-prose font-serif leading-relaxed whitespace-pre-line text-lq-fg">{question.body}</p> : null}
    </div>
  );
}
