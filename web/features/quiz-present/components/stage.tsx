"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, m } from "motion/react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { Avatar } from "@/components/quiz-kit/avatar";
import { BarChart, DrawnCheck } from "@/components/quiz-kit/bar-chart";
import { CountdownRing } from "@/components/quiz-kit/countdown-ring";
import { FitText } from "@/components/quiz-kit/fit-text";
import { Leaderboard, type LeaderboardLabels } from "@/components/quiz-kit/leaderboard";
import { springs, staggerDelay, staggers, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { OptionBadge, OptionPattern } from "@/components/quiz-kit/option-shape";
import { QrCode } from "@/components/quiz-kit/qr-code";
import { LiveAnnouncer, LiveThemeRoot, PauseGlyph } from "@/features/quiz-live/components/live-chrome";
import type { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import type { StageView } from "@/features/quiz-live/lib/live-store";
import { formatJoinCode, isAnswerableType, isChoiceType, optionLetter, type PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { useCountdown } from "@/features/quiz-live/lib/use-live-session";
import { LockGlyph } from "@/features/quiz-play/components/participant-phases";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const PodiumScreen = dynamic(() => import("@/features/quiz-present/components/podium-screen").then((module) => module.PodiumScreen), {
  ssr: false
});

const LOBBY_VISIBLE_NAMES = 40;
const REVEAL_SUSPENSE_MS = 750;

type Translate = (key: string, values?: Record<string, string | number>) => string;

function joinHostLabel(joinUrl: string): string {
  try {
    const url = new URL(joinUrl);
    return `${url.host}${url.pathname.replace(/\/j\/\d+\/?$/, "/j")}`;
  } catch {
    return joinUrl;
  }
}

export function leaderboardLabels(t: Translate): LeaderboardLabels {
  return {
    points: t("quizPresent.leaderboard.points"),
    up: (n) => t("quizPresent.leaderboard.up", { n }),
    down: (n) => t("quizPresent.leaderboard.down", { n }),
    same: t("quizPresent.leaderboard.same"),
    biggestClimb: t("quizPresent.leaderboard.biggestClimb"),
    rankOrdinal: (rank) => t("quizPresent.leaderboard.rank", { rank })
  };
}

/**
 * Projector stage. It only ever receives `StageView` (public data): presenter notes, answer keys and
 * participant admin never reach it, so a mirrored projector cannot leak them.
 */
export function Stage({
  view,
  clock,
  calm = false,
  reportHref,
  libraryHref,
  className,
  bottomInset = 0
}: {
  view: StageView;
  clock: ClockSync;
  calm?: boolean;
  /** Host only: link to the session report on the finished screen. */
  reportHref?: string | null;
  libraryHref?: string | null;
  className?: string;
  /** Leave room for the host control bar. */
  /** Height in px of the host control bar overlaying the bottom of the stage (0 = none). */
  bottomInset?: number;
}) {
  const { t } = useI18n();
  // Stage-level precision: the tree re-renders on reading → open, not on every second.
  const countdown = useCountdown(view.phase === "question" ? view.timer : null, clock, undefined, "stage");
  const reading = view.phase === "question" && countdown.stage === "reading";
  const current = (view.qi ?? 0) + 1;

  const screenKey =
    view.phase === "question" ? `question:${view.qi}:${reading ? "intro" : "open"}` : view.phase === "locked" ? `question:${view.qi}:open` : `${view.phase}:${view.qi ?? ""}`;

  const announcement = useMemo(() => {
    if (view.phase === "question") {
      return view.paused ? t("quizPresent.announce.paused") : t("quizPresent.announce.question", { current, total: view.total });
    }
    return view.phase in { lobby: 1, locked: 1, reveal: 1, leaderboard: 1, podium: 1, finished: 1, content: 1 } ? t(`quizPresent.announce.${view.phase}`) : "";
  }, [view.phase, view.paused, current, view.total, t]);

  let screen: ReactNode;
  if (!view.hydrated) {
    screen = (
      <p role="status" className="m-auto font-lq text-[4cqmin] text-lq-fg-muted">
        {t("quizPresent.loading")}
      </p>
    );
  } else {
    switch (view.phase) {
      case "lobby":
        screen = <LobbyScreen view={view} />;
        break;
      case "question":
      case "locked":
        screen = view.question ? (
          reading ? (
            <IntroScreen question={view.question} current={current} total={view.total} timer={view.timer} clock={clock} />
          ) : (
            <QuestionScreen view={view} question={view.question} current={current} clock={clock} />
          )
        ) : null;
        break;
      case "content":
        screen = <ContentScreen question={view.question} />;
        break;
      case "reveal":
        screen = view.reveal ? <RevealScreen view={view} current={current} /> : null;
        break;
      case "leaderboard":
        screen = <LeaderboardScreen view={view} />;
        break;
      case "podium":
        screen = view.podium ? <PodiumScreen top={view.podium.top} stats={view.podium.stats} calm={calm} /> : null;
        break;
      case "finished":
        screen = <FinishedScreen reportHref={reportHref} libraryHref={libraryHref} />;
        break;
      default:
        screen = null;
    }
  }

  return (
    <LiveThemeRoot theme={view.themeKey} calm={calm} className={cn("h-dvh w-full", className)} particles={view.phase === "lobby"}>
      <div
        className="relative flex h-full min-h-0 flex-1 flex-col [container-type:size]"
        style={bottomInset > 0 ? { paddingBottom: bottomInset } : undefined}
      >
        {view.hydrated && view.phase !== "lobby" && view.joinCode ? (
          <p className="absolute top-[2cqmin] right-[2.5cqmin] z-10 rounded-full border border-lq-line bg-lq-surface px-[1.6cqmin] py-[0.6cqmin] font-lq-mono text-[max(0.8rem,1.7cqmin)] text-lq-fg-muted">
            {joinHostLabel(view.joinUrl)} · <span className="font-medium text-lq-fg">{formatJoinCode(view.joinCode)}</span>
          </p>
        ) : null}
        <AnimatePresence initial={false}>{view.hydrated && view.paused ? <PausedOverlay key="paused" /> : null}</AnimatePresence>
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={screenKey}
            className="flex min-h-0 flex-1 flex-col"
            initial={{ y: 24 }}
            animate={{ y: 0 }}
            exit={{ y: -16, opacity: 0, transition: { duration: 0.22, ease: [0.3, 0, 0.8, 0.15] } }}
            transition={{ type: "tween", duration: 0.42, ease: [0.05, 0.7, 0.1, 1] }}
          >
            {screen}
          </m.div>
        </AnimatePresence>
      </div>
      <LiveAnnouncer message={announcement} />
    </LiveThemeRoot>
  );
}

// ----------------------------------------------------------------------------- paused (host pause)

/**
 * Frozen-question overlay on the projector: a soft veil over the stage and a "Pausado" badge that
 * drops in from the top. The countdown underneath stays visible (frozen at the pause instant).
 */
function PausedOverlay() {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  return (
    <>
      <m.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] bg-[color-mix(in_srgb,var(--lq-bg)_38%,transparent)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.3 }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-[2cqmin] z-20 flex justify-center">
        <m.div
          role="status"
          className="flex items-center gap-[1.4cqmin] rounded-full bg-lq-warning px-[2.4cqmin] py-[1cqmin] text-lq-on-warning shadow-[0_18px_50px_-18px_rgb(0_0_0/0.7)]"
          initial={reduced ? { opacity: 0 } : { y: "-120%", scale: 0.9 }}
          animate={reduced ? { opacity: 1 } : { y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { y: "-120%", opacity: 0, transition: { duration: 0.2 } }}
          transition={springs.bouncy}
        >
          <PauseGlyph className="lq-paused-breathe size-[4cqmin]" />
          <span className="flex flex-col leading-tight">
            <span className="font-lq text-[max(1rem,3.2cqmin)] font-extrabold tracking-wide uppercase">{t("quizPresent.question.paused")}</span>
            <span className="text-[max(0.75rem,1.6cqmin)] font-semibold opacity-90">{t("quizPresent.question.pausedHint")}</span>
          </span>
        </m.div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------- lobby

function LobbyScreen({ view }: { view: StageView }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const people = view.lobby?.recent ?? [];
  const visible = people.slice(0, LOBBY_VISIBLE_NAMES);
  const hidden = Math.max(0, view.participantCount - visible.length);
  const count = view.participantCount;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-[4cqw] px-[5cqw] py-[5cqh]">
      <m.figure
        className="flex flex-col items-center gap-[1.5cqh] rounded-[3cqmin] bg-[#ffffff] p-[2.2cqmin] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.7)]"
        style={{ width: "min(64cqh, 42cqw)" }}
        initial={reduced ? false : { scale: 0.92, rotate: -2 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={springs.gentle}
      >
        {view.joinUrl ? <QrCode value={view.joinUrl} label={t("quizPresent.lobby.qrLabel", { url: view.joinUrl })} animate={!reduced} /> : null}
        <figcaption className="text-center font-lq text-[max(0.9rem,2cqmin)] font-bold text-[#0b1020]">{t("quizPresent.lobby.scanToJoin")}</figcaption>
      </m.figure>

      <div className="flex min-h-0 min-w-0 flex-col gap-[2.5cqh] self-stretch py-[1cqh]">
        <div className="flex flex-col gap-[0.6cqh]">
          <p className="font-lq text-[max(1rem,2.6cqmin)] font-semibold text-lq-fg-muted">
            {t("quizPresent.lobby.joinAt")} <span className="font-lq-mono font-medium text-lq-fg">{joinHostLabel(view.joinUrl)}</span>
          </p>
          <p className="font-lq text-[max(0.9rem,2cqmin)] font-semibold tracking-[0.3em] text-lq-accent uppercase">{t("quizPresent.lobby.pin")}</p>
          <p className="font-lq-mono text-[clamp(3rem,13cqmin,11rem)] leading-[0.9] font-medium tracking-[0.08em] text-lq-fg tabular-nums" aria-label={view.joinCode.split("").join(" ")}>
            {formatJoinCode(view.joinCode)}
          </p>
          <h1 className="mt-[1cqh] line-clamp-2 font-lq text-[max(1.1rem,3.4cqmin)] leading-tight font-extrabold text-lq-fg">{view.title}</h1>
        </div>

        <div className="flex items-center gap-[1.5cqw]">
          <span className="grid place-items-center rounded-full bg-lq-accent px-[2cqmin] py-[0.8cqmin] font-lq text-[max(1rem,3cqmin)] font-black text-lq-on-accent">
            <AnimatedNumber value={count} />
          </span>
          <span className="font-lq text-[max(1rem,2.6cqmin)] font-bold text-lq-fg">
            {count === 1 ? t("quizPresent.lobby.participantWord") : t("quizPresent.lobby.participantsWord")}
          </span>
          {view.roomLocked ? (
            <span className="ml-auto flex items-center gap-2 rounded-full bg-lq-warning px-[1.6cqmin] py-[0.6cqmin] text-[max(0.8rem,1.6cqmin)] font-bold text-lq-on-warning">
              <LockGlyph className="size-[1.2em] text-current" />
              {t("quizPresent.lobby.locked")}
            </span>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {visible.length === 0 ? (
            <m.p
              className="font-lq text-[max(1rem,2.4cqmin)] text-lq-fg-muted"
              animate={reduced ? undefined : { y: [0, -4, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            >
              {t("quizPresent.lobby.waitingFirst")}
            </m.p>
          ) : (
            <ul className="flex flex-wrap content-start gap-[1.2cqmin]" aria-live="off">
              <AnimatePresence initial={false}>
                {visible.map((person) => {
                  const tilt = ((person.participant_id.charCodeAt(0) + person.participant_id.length) % 5) - 2;
                  return (
                    <m.li
                      key={person.participant_id}
                      layout={reduced ? false : "position"}
                      initial={reduced ? false : { scale: 0, rotate: tilt * 3 }}
                      animate={{ scale: 1, rotate: tilt }}
                      exit={{ scale: 0 }}
                      transition={springs.bouncy}
                      className="flex max-w-full items-center gap-[0.8cqmin] rounded-full border border-lq-line bg-lq-surface py-[0.5cqmin] pr-[1.6cqmin] pl-[0.5cqmin]"
                    >
                      <Avatar seed={person.avatar_seed} size={40} className="size-[max(1.75rem,4cqmin)]" />
                      <span className="truncate font-lq text-[max(0.9rem,2.2cqmin)] font-bold text-lq-fg">{person.display_name}</span>
                    </m.li>
                  );
                })}
              </AnimatePresence>
              {hidden > 0 ? (
                <li className="flex items-center rounded-full bg-lq-surface-2 px-[1.6cqmin] py-[0.5cqmin] font-lq-mono text-[max(0.9rem,2cqmin)] text-lq-fg">
                  {t("quizPresent.lobby.more", { count: hidden })}
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- intro (reading phase)

function QuestionBadge({ question, current, total }: { question: PublicQuestion; current: number; total: number }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  return (
    <m.div
      className="flex flex-wrap items-center gap-[1cqmin]"
      initial={reduced ? false : { x: -40 }}
      animate={{ x: 0 }}
      transition={{ type: "tween", duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <span className="rounded-full bg-lq-accent px-[1.6cqmin] py-[0.6cqmin] font-lq-mono text-[max(0.85rem,1.9cqmin)] font-medium text-lq-on-accent">
        {t("quizPresent.intro.counter", { current, total })}
      </span>
      <span className="rounded-full border border-lq-line bg-lq-surface px-[1.6cqmin] py-[0.6cqmin] text-[max(0.85rem,1.9cqmin)] font-semibold text-lq-fg">
        {t(`quizPresent.intro.types.${question.item_type}`)}
      </span>
      {question.scored ? (
        question.points_multiplier !== 1 ? (
          <span className="rounded-full border border-lq-line bg-lq-surface px-[1.6cqmin] py-[0.6cqmin] text-[max(0.85rem,1.9cqmin)] font-semibold text-lq-fg">
            {question.points_multiplier === 0 ? t("quizPresent.intro.noPoints") : t("quizPresent.intro.points", { multiplier: question.points_multiplier })}
          </span>
        ) : null
      ) : null}
    </m.div>
  );
}

function IntroScreen({
  question,
  current,
  total,
  timer,
  clock
}: {
  question: PublicQuestion;
  current: number;
  total: number;
  timer: StageView["timer"];
  clock: ClockSync;
}) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const { seconds } = useCountdown(timer, clock);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[3cqh] px-[5cqw] pt-[4cqh] pb-[5cqh]">
      <QuestionBadge question={question} current={current} total={total} />
      <m.div
        className="flex min-h-0 flex-1"
        initial={reduced ? false : { y: 12 }}
        animate={{ y: 0 }}
        transition={{ type: "tween", duration: 0.42, ease: [0.05, 0.7, 0.1, 1] }}
      >
        <FitText contentKey={question.prompt} className="flex-1" innerClassName="font-lq-prompt font-extrabold text-lq-fg" maxHeightRatio={0.3}>
          {question.prompt}
        </FitText>
      </m.div>
      <div className="flex items-center justify-center gap-[3cqw]">
        <p className="font-lq text-[max(1.2rem,4cqmin)] font-extrabold text-lq-accent">{t("quizPresent.intro.getReady")}</p>
        <m.span
          key={seconds}
          aria-hidden="true"
          className="grid size-[14cqmin] place-items-center rounded-full border-[0.8cqmin] border-lq-accent font-lq-mono text-[7cqmin] text-lq-fg"
          initial={reduced ? false : { scale: 1.4 }}
          animate={{ scale: 1 }}
          transition={{ type: "tween", duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
        >
          {seconds}
        </m.span>
        <span className="sr-only">{t("quizPresent.question.readingLeft", { seconds })}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- open / locked question

function optionGrid(count: number): string {
  if (count <= 2) {
    return "grid-cols-2";
  }
  if (count <= 4) {
    return "grid-cols-2";
  }
  return "grid-cols-3";
}

function AnsweredMeter({ answered, total }: { answered: number | null; total: number | null }) {
  const { t } = useI18n();
  if (answered === null) {
    return null;
  }
  const denominator = total ?? 0;
  const fraction = denominator > 0 ? Math.min(1, answered / denominator) : 0;
  return (
    <div className="flex flex-col items-end gap-[0.6cqh]">
      <p className="font-lq text-[max(1rem,2.8cqmin)] font-extrabold text-lq-fg">
        <span aria-hidden="true">
          <AnimatedNumber value={answered} duration={0.35} />
          <span className="text-lq-fg-muted">/{denominator}</span>
        </span>
        <span className="sr-only">{t("quizPresent.question.answeredSr", { answered, total: denominator })}</span>
      </p>
      <div aria-hidden="true" className="h-[0.8cqmin] w-[18cqw] overflow-hidden rounded-full bg-lq-track">
        <m.div className="h-full origin-left rounded-full bg-lq-accent" animate={{ scaleX: fraction }} initial={{ scaleX: 0 }} transition={springs.gentle} />
      </div>
    </div>
  );
}

function OptionTiles({ question, dimmed = false }: { question: PublicQuestion; dimmed?: boolean }) {
  const reduced = useLqReducedMotion();
  const options = [...question.options].sort((a, b) => a.index - b.index);
  return (
    <ul className={cn("grid auto-rows-fr gap-[1.6cqmin]", optionGrid(options.length))}>
      {options.map((option, position) => (
        <m.li
          key={option.id}
          className={cn("lq-tile flex min-h-[10cqh] items-center gap-[1.6cqmin] overflow-hidden px-[2cqmin] py-[1.4cqmin]", `lq-slot-${option.index % 6}`)}
          initial={reduced ? false : { y: 16, scale: 0.92 }}
          animate={{ y: 0, scale: dimmed ? 0.98 : 1 }}
          transition={{ ...springs.snappy, delay: reduced ? 0 : staggerDelay(position, options.length, staggers.stage) }}
        >
          <OptionBadge index={option.index} size="xl" />
          <span className="line-clamp-3 font-lq text-[max(1rem,3cqmin)] leading-tight font-bold">
            <span className="sr-only">{optionLetter(option.index)}: </span>
            {option.text}
          </span>
          <OptionPattern className="inset-x-0 bottom-0 h-[0.8cqmin]" />
        </m.li>
      ))}
    </ul>
  );
}

function QuestionScreen({ view, question, current, clock }: { view: StageView; question: PublicQuestion; current: number; clock: ClockSync }) {
  const { t } = useI18n();
  const locked = view.phase === "locked";
  const reduced = useLqReducedMotion();
  const showLive = Boolean(view.liveCounts) && isChoiceType(question.item_type);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2.5cqh] px-[5cqw] pt-[4cqh] pb-[4cqh]">
      <div className="flex items-start justify-between gap-[2cqw] pr-[22cqw]">
        <QuestionBadge question={question} current={current} total={view.total} />
      </div>
      <div className="flex min-h-0 flex-[1.1] items-stretch gap-[3cqw]">
        <FitText contentKey={question.prompt} className="flex-1" innerClassName="font-lq-prompt font-extrabold text-lq-fg" maxHeightRatio={0.34}>
          {question.prompt}
        </FitText>
        <div className="flex shrink-0 flex-col items-end justify-between gap-[2cqh]">
          {locked ? (
            <m.div className="flex flex-col items-center gap-[1cqh]" initial={reduced ? false : { scale: 0.8 }} animate={{ scale: 1 }} transition={springs.bouncy}>
              <LockGlyph className="size-[12cqmin]" />
              <span className="font-lq text-[max(0.9rem,2.2cqmin)] font-bold text-lq-fg">{t("quizPresent.locked.title")}</span>
              {view.lockReason ? <span className="text-[max(0.8rem,1.8cqmin)] text-lq-fg-muted">{t(`quizPresent.locked.reasons.${view.lockReason}`)}</span> : null}
            </m.div>
          ) : view.timer?.deadline_ms !== null ? (
            <CountdownRing
              timer={view.timer}
              clock={clock}
              size="16cqmin"
              label={(value) => (value.paused ? t("quizPresent.question.pausedTime", { seconds: value.seconds }) : t("quizPresent.question.timeLeft", { seconds: value.seconds }))}
            />
          ) : (
            <span className="rounded-full border border-lq-line bg-lq-surface px-[1.6cqmin] py-[0.6cqmin] text-[max(0.8rem,1.8cqmin)] text-lq-fg-muted">{t("quizPresent.question.untimed")}</span>
          )}
          <AnsweredMeter answered={view.answered} total={view.answerTotal ?? view.participantCount} />
        </div>
      </div>
      <div className="flex min-h-0 flex-[1.3] flex-col justify-end">
        {question.item_type === "type_answer" ? (
          <p className="rounded-[var(--lq-radius)] border-2 border-dashed border-lq-line bg-lq-surface px-[3cqmin] py-[3cqh] text-center font-lq text-[max(1.1rem,3.4cqmin)] font-bold text-lq-fg">
            {t("quizPresent.question.typeHint")}
          </p>
        ) : !isAnswerableType(question.item_type) ? null : showLive && view.liveCounts ? (
          <BarChart
            className="h-full"
            bars={question.options.map((option) => ({ id: option.id, index: option.index, label: option.text, value: view.liveCounts?.[option.id] ?? 0 }))}
            total={view.answered ?? 0}
            labels={{ correct: t("quizPresent.reveal.correct"), summary: (letter, text, count, percent) => t("quizPresent.reveal.summary", { letter, text, count, percent }) }}
          />
        ) : (
          <OptionTiles question={question} dimmed={locked || view.paused} />
        )}
        {question.item_type === "multi_choice" && question.select_count ? (
          <p className="mt-[1.4cqh] text-center font-lq text-[max(0.9rem,2cqmin)] font-semibold text-lq-fg-muted">{t("quizPresent.question.selectN", { count: question.select_count })}</p>
        ) : null}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- reveal

function RevealScreen({ view, current }: { view: StageView; current: number }) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  const reveal = view.reveal;
  const question = view.question;
  const [suspenseDone, setSuspenseDone] = useState(false);
  const suspense = !reduced && !suspenseDone;

  useEffect(() => {
    // Honest suspense: the data is already here; only its presentation waits 600–900 ms.
    const timer = setTimeout(() => setSuspenseDone(true), REVEAL_SUSPENSE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!reveal) {
    return null;
  }
  const options = [...(question?.options ?? [])].sort((a, b) => a.index - b.index);
  const isPoll = reveal.item_type === "poll";
  const seconds = (ms: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(ms / 1000);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2cqh] px-[5cqw] pt-[4cqh] pb-[4cqh]">
      <div className="flex flex-col gap-[1.2cqh] pr-[22cqw]">
        {question ? <QuestionBadge question={question} current={current} total={view.total} /> : null}
        {question ? <p className="line-clamp-2 font-lq-prompt text-[max(1.1rem,3.2cqmin)] leading-tight font-extrabold text-lq-fg">{question.prompt}</p> : null}
      </div>

      <AnimatePresence mode="wait">
        {suspense ? (
          <m.div key="suspense" className="flex flex-1 items-center justify-center gap-[2cqmin]" exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.15 } }} aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <m.span
                key={dot}
                className="size-[3cqmin] rounded-full bg-lq-accent"
                animate={{ y: [0, -18, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: dot * 0.12 }}
              />
            ))}
          </m.div>
        ) : (
          <m.div key="result" className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-[3cqw]" initial={reduced ? false : { y: 12 }} animate={{ y: 0 }} transition={springs.gentle}>
            <div className="flex min-h-0 flex-col">
              {reveal.item_type === "type_answer" ? (
                <TopAnswers reveal={reveal} />
              ) : (
                <BarChart
                  className="h-full"
                  bars={options.map((option) => ({
                    id: option.id,
                    index: option.index,
                    label: option.text,
                    value: reveal.counts[option.id] ?? 0,
                    correct: isPoll ? undefined : reveal.correct_option_ids.includes(option.id)
                  }))}
                  total={reveal.answered}
                  revealed={!isPoll}
                  labels={{
                    correct: t("quizPresent.reveal.correct"),
                    summary: (letter, text, count, percent, correct) =>
                      t(correct ? "quizPresent.reveal.summaryCorrect" : "quizPresent.reveal.summary", { letter, text, count, percent })
                  }}
                />
              )}
            </div>
            <div className="flex min-h-0 flex-col gap-[1.6cqh] overflow-hidden">
              {reveal.item_type !== "type_answer" ? (
                <ul className="flex flex-col gap-[1cqh]">
                  {options.map((option, position) => {
                    const correct = !isPoll && reveal.correct_option_ids.includes(option.id);
                    const wrong = !isPoll && !correct;
                    return (
                      <m.li
                        key={option.id}
                        className={cn("lq-tile flex items-center gap-[1.2cqmin] px-[1.4cqmin] py-[0.9cqmin]", `lq-slot-${option.index % 6}`)}
                        data-dim={wrong || undefined}
                        data-glow={correct || undefined}
                        style={{ transformPerspective: 800 }}
                        initial={false}
                        animate={correct && !reduced ? { rotateY: [0, 90, 0], scale: [1, 1.02, 1] } : { scale: wrong && !reduced ? 0.96 : 1 }}
                        transition={{ duration: 0.5, delay: 0.25 + position * 0.08, ease: [0.2, 0.8, 0.2, 1] }}
                      >
                        <OptionBadge index={option.index} size="sm" />
                        <span className="line-clamp-2 min-w-0 flex-1 text-[max(0.85rem,2cqmin)] font-bold">{option.text}</span>
                        {correct ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-lq-success px-[1cqmin] py-[0.3cqmin] text-[max(0.75rem,1.6cqmin)] font-bold text-lq-on-success">
                            <DrawnCheck className="size-[1.2em]" delay={600} />
                            {t("quizPresent.reveal.correct")}
                          </span>
                        ) : null}
                      </m.li>
                    );
                  })}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-[1cqmin]">
                {reveal.answered === 0 ? <StatPill>{t("quizPresent.reveal.noAnswers")}</StatPill> : null}
                {reveal.pct_correct !== null && !isPoll ? <StatPill strong>{t("quizPresent.reveal.pctCorrect", { percent: Math.round(reveal.pct_correct) })}</StatPill> : null}
                {reveal.fastest ? (
                  <StatPill>
                    <span aria-hidden="true">⚡ </span>
                    {t("quizPresent.reveal.fastest", { name: reveal.fastest.display_name, seconds: seconds(reveal.fastest.ms) })}
                  </StatPill>
                ) : null}
                {reveal.avg_ms !== null && !isPoll ? <StatPill>{t("quizPresent.reveal.avg", { seconds: seconds(reveal.avg_ms) })}</StatPill> : null}
              </div>
              {view.showExplanation && reveal.explanation ? (
                <m.section
                  className="min-h-0 overflow-hidden rounded-[var(--lq-radius)] border border-lq-line bg-lq-surface p-[2cqmin]"
                  initial={reduced ? false : { y: 24 }}
                  animate={{ y: 0 }}
                  transition={{ ...springs.gentle, delay: reduced ? 0 : 0.9 }}
                >
                  <h2 className="font-lq text-[max(0.9rem,2cqmin)] font-extrabold tracking-[0.1em] text-lq-accent uppercase">{t("quizPresent.reveal.why")}</h2>
                  <p className="mt-[0.8cqh] line-clamp-6 font-serif text-[max(0.95rem,2.1cqmin)] leading-snug text-lq-fg">{reveal.explanation}</p>
                </m.section>
              ) : null}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatPill({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-[1.4cqmin] py-[0.6cqmin] text-[max(0.8rem,1.8cqmin)] font-bold",
        strong ? "bg-lq-accent text-lq-on-accent" : "border border-lq-line bg-lq-surface text-lq-fg"
      )}
    >
      {children}
    </span>
  );
}

function TopAnswers({ reveal }: { reveal: NonNullable<StageView["reveal"]> }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const answers = reveal.top_answers ?? [];
  const max = Math.max(1, ...answers.map((answer) => answer.n));
  return (
    <div className="flex min-h-0 flex-col gap-[1.4cqh]">
      <h2 className="font-lq text-[max(0.9rem,2cqmin)] font-extrabold tracking-[0.1em] text-lq-fg-muted uppercase">{t("quizPresent.reveal.topAnswers")}</h2>
      <ul className="flex min-h-0 flex-col gap-[1cqh] overflow-hidden">
        {answers.slice(0, 8).map((answer, position) => (
          <m.li
            key={answer.text}
            className={cn(
              "relative flex items-center gap-[1.4cqmin] overflow-hidden rounded-[var(--lq-radius)] border px-[1.6cqmin] py-[1cqmin]",
              answer.accepted ? "border-lq-success bg-lq-surface-2" : "border-lq-line bg-lq-surface"
            )}
            initial={reduced ? false : { x: -24 }}
            animate={{ x: 0 }}
            transition={{ ...springs.gentle, delay: reduced ? 0 : position * 0.08 }}
          >
            <m.span
              aria-hidden="true"
              className={cn("absolute inset-y-0 left-0 w-full origin-left", answer.accepted ? "bg-lq-success/20" : "bg-lq-track/60")}
              initial={reduced ? false : { scaleX: 0 }}
              animate={{ scaleX: answer.n / max }}
              transition={{ ...springs.gentle, delay: reduced ? 0 : 0.2 + position * 0.08 }}
            />
            <span
              className={cn(
                "relative grid size-[3.4cqmin] shrink-0 place-items-center rounded-full text-[max(0.8rem,1.8cqmin)] font-black",
                answer.accepted ? "bg-lq-success text-lq-on-success" : "bg-lq-surface-2 text-lq-fg-muted"
              )}
            >
              <span aria-hidden="true">{answer.accepted ? "✓" : "✕"}</span>
              <span className="sr-only">{answer.accepted ? t("quizPresent.reveal.acceptedMark") : t("quizPresent.reveal.notAcceptedMark")}</span>
            </span>
            <span className="relative min-w-0 flex-1 truncate font-lq text-[max(1rem,2.6cqmin)] font-bold text-lq-fg">{answer.text}</span>
            <span className="relative font-lq-mono text-[max(0.9rem,2.2cqmin)] text-lq-fg">{answer.n}</span>
          </m.li>
        ))}
      </ul>
      {reveal.accepted_answers.length ? (
        <p className="text-[max(0.85rem,1.9cqmin)] text-lq-fg-muted">
          <span className="font-bold text-lq-fg">{t("quizPresent.reveal.accepted")}:</span> {reveal.accepted_answers.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------- leaderboard / content / finished

function LeaderboardScreen({ view }: { view: StageView }) {
  const { t } = useI18n();
  const top = view.leaderboard?.top.slice(0, 5) ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center gap-[3cqh] px-[8cqw] pt-[5cqh] pb-[5cqh]">
      <h1 className="font-lq text-[max(1.5rem,6cqmin)] font-black text-lq-fg">{t("quizPresent.leaderboard.title")}</h1>
      {top.length ? (
        <Leaderboard standings={top} labels={leaderboardLabels(t)} className="max-w-[min(100%,70rem)]" />
      ) : (
        <p className="font-lq text-[max(1rem,2.6cqmin)] text-lq-fg-muted">{t("quizPresent.leaderboard.empty")}</p>
      )}
    </div>
  );
}

function ContentScreen({ question }: { question: PublicQuestion | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[3cqh] px-[7cqw] pt-[7cqh] pb-[6cqh]">
      {question?.prompt ? (
        <FitText contentKey={question.prompt} className="flex-[0.8]" innerClassName="font-lq font-black text-lq-fg" maxHeightRatio={0.5}>
          {question.prompt}
        </FitText>
      ) : null}
      {question?.body ? (
        <FitText contentKey={question.body} className="flex-1" innerClassName="font-serif leading-snug whitespace-pre-line text-lq-fg" maxHeightRatio={0.18} maxWidthRatio={0.04}>
          {question.body}
        </FitText>
      ) : null}
    </div>
  );
}

function FinishedScreen({ reportHref, libraryHref }: { reportHref?: string | null; libraryHref?: string | null }) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const title = t("quizPresent.finished.title");
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[3cqh] px-[6cqw] text-center">
      <h1 className="font-lq text-[max(2.5rem,14cqmin)] leading-none font-black text-lq-fg" aria-label={title}>
        {Array.from(title).map((letter, index) => (
          <m.span
            key={`${letter}-${index}`}
            aria-hidden="true"
            className="inline-block"
            initial={reduced ? false : { y: 40, rotate: -6 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ ...springs.bouncy, delay: reduced ? 0 : index * 0.05 }}
          >
            {letter === " " ? " " : letter}
          </m.span>
        ))}
      </h1>
      <p className="max-w-[60cqw] font-lq text-[max(1rem,2.6cqmin)] text-lq-fg-muted">{t("quizPresent.finished.subtitle")}</p>
      {reportHref || libraryHref ? (
        <div className="flex flex-wrap justify-center gap-3">
          {reportHref ? (
            <Link href={reportHref} className="focus-ring inline-flex min-h-12 items-center rounded-[calc(var(--lq-radius)*0.7)] bg-lq-accent px-6 font-lq text-lg font-bold text-lq-on-accent">
              {t("quizPresent.finished.report")}
            </Link>
          ) : null}
          {libraryHref ? (
            <Link href={libraryHref} className="focus-ring inline-flex min-h-12 items-center rounded-[calc(var(--lq-radius)*0.7)] border border-lq-line bg-lq-surface px-6 font-lq text-lg font-bold text-lq-fg">
              {t("quizPresent.finished.library")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
