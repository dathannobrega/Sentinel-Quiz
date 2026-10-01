"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { CountdownBar } from "@/components/quiz-kit/countdown-ring";
import { LiveMotionProvider, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ChallengeRules } from "@/features/quiz-challenge/components/challenge-rules";
import { ChallengeSummary } from "@/features/quiz-challenge/components/challenge-summary";
import { revealFromFeedback, submissionFromFeedback } from "@/features/quiz-challenge/lib/challenge-corrections";
import { progressOf } from "@/features/quiz-challenge/lib/challenge-play";
import { EXPIRY_REFRESH_DELAY_MS, formatClock, itemTimer, totalTimer } from "@/features/quiz-challenge/lib/challenge-time";
import { useChallengePlay, type ChallengePlay } from "@/features/quiz-challenge/lib/use-challenge-play";
import { LiveAnnouncer, LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { LiveToast, useLiveToast } from "@/features/quiz-live/components/live-toast";
import { LqButton, LqError } from "@/features/quiz-live/components/lq-ui";
import type { ParticipantCredentials } from "@/features/quiz-live/lib/live-fetch";
import { isAnswerableType } from "@/features/quiz-live/lib/protocol";
import { useCountdown } from "@/features/quiz-live/lib/use-live-session";
import { AnswerPad } from "@/features/quiz-play/components/answer-pad";
import { ContentView, LockGlyph, PhaseHeading, RemovedView, RevealFeedback } from "@/features/quiz-play/components/participant-phases";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveChallengeInfo, LiveJoinResult } from "@/types/api";

/** How many times a still-open item is re-polled after its deadline before giving up (server slack). */
const MAX_EXPIRY_POLLS = 3;

export interface ChallengeGameProps {
  slug: string;
  info: LiveChallengeInfo;
  credentials: ParticipantCredentials;
  onTokenLost: () => void;
  /** "Não é você?": forget this tab's token and go back to the join form. */
  onLeave: () => void;
  onTokenRefreshed?: (result: LiveJoinResult) => void;
}

/**
 * The participant's side of a challenge, after joining: rules → items one by one (progress bar,
 * per-item and total countdowns, the live answer pads, "Entregar") → per-item correction when the
 * policy is "each" → summary. Reopening the link resumes the open attempt (RF-808).
 */
export function ChallengeGame(props: ChallengeGameProps) {
  return (
    <LiveMotionProvider>
      <GameInner {...props} />
    </LiveMotionProvider>
  );
}

type Boot = "loading" | "ready" | "none";

function GameInner({ slug, info, credentials, onTokenLost, onLeave, onTokenRefreshed }: ChallengeGameProps) {
  const { t, locale } = useI18n();
  const reduced = useLqReducedMotion();
  const play = useChallengePlay({ slug, token: credentials.token, onTokenLost });
  const [boot, setBoot] = useState<Boot>("loading");
  const [confirmHandIn, setConfirmHandIn] = useState(false);
  const { toast, show: showToast, dismiss: dismissToast } = useLiveToast();
  const { load, notice, clearNotice } = play;

  useEffect(() => {
    let alive = true;
    void load().then((result) => {
      if (alive) {
        setBoot(result === "none" ? "none" : "ready");
      }
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Non-accepted answers: say it briefly and carry on with the state the server sent.
  useEffect(() => {
    if (!notice) {
      return;
    }
    if (notice.kind === "late") {
      showToast(t("quizChallenge.play.game.timeUp"), "warning");
    } else if (notice.kind === "stale") {
      showToast(t("quizChallenge.play.game.stale"), "neutral");
    } else if (notice.kind === "closed") {
      showToast(t("quizChallenge.play.game.closed"), "neutral");
    }
    if (notice.kind !== "invalid") {
      clearNotice();
    }
  }, [notice, showToast, clearNotice, t]);

  const attempt = play.attempt;
  const inProgress = attempt?.status === "in_progress";
  const progress = useMemo(() => progressOf(attempt), [attempt]);
  const name = credentials.displayName;

  let key: string;
  let body: ReactNode;
  if (boot === "loading" && !attempt) {
    key = "loading";
    body = (
      <p role="status" className="m-auto text-lq-fg-muted">
        {t("quizChallenge.play.loading")}
      </p>
    );
  } else if (play.feedback) {
    key = `feedback:${play.feedback.feedback.qi}`;
    body = <FeedbackStep play={play} finished={!inProgress} />;
  } else if (!attempt) {
    key = "rules";
    body = <ChallengeRules info={info} play={play} />;
  } else if (inProgress) {
    key = `item:${attempt.attempt_id}:${attempt.index}`;
    body = <ItemStep play={play} />;
  } else {
    key = `summary:${attempt.attempt_id}`;
    body = <ChallengeSummary slug={slug} info={info} play={play} credentials={credentials} onTokenRefreshed={onTokenRefreshed} />;
  }

  const announcement = useMemo(() => {
    if (!attempt || play.feedback) {
      return play.feedback ? t("quizChallenge.play.announce.feedback") : "";
    }
    if (attempt.status === "finished") {
      return t("quizChallenge.play.announce.finished");
    }
    return attempt.item ? t("quizChallenge.play.announce.item", { current: progress.current, total: progress.total, prompt: attempt.item.prompt }) : "";
  }, [attempt, play.feedback, progress, t]);

  return (
    <LiveThemeRoot theme={info.theme_key} className="min-h-dvh">
      <header className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 pt-4">
        <Avatar seed={credentials.avatarSeed} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-lq font-bold text-lq-fg">{name}</p>
          <p className="truncate font-lq-mono text-xs text-lq-fg-muted">
            {info.title}
            {inProgress ? ` · ${t("quizChallenge.play.game.progress", { current: progress.current, total: progress.total })}` : ""}
          </p>
        </div>
        {inProgress ? <TotalCountdown play={play} /> : null}
      </header>
      {inProgress ? (
        <div className="mx-auto w-full max-w-xl px-4 pt-3">
          <div
            role="progressbar"
            aria-label={t("quizChallenge.play.game.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={Math.max(0, progress.current - 1)}
            aria-valuetext={t("quizChallenge.play.game.progress", { current: progress.current, total: progress.total })}
            className="h-2 w-full overflow-hidden rounded-full bg-lq-track"
          >
            <div className="h-full origin-left rounded-full bg-lq-accent transition-transform duration-500" style={{ transform: `scaleX(${progress.fraction})` }} />
          </div>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-5">
        {play.error && play.error !== "attempt_not_found" ? (
          <LqError className="mb-4">{t(`quizChallenge.play.attemptErrors.${play.error}`)}</LqError>
        ) : null}
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={key}
            className="flex flex-1 flex-col"
            initial={reduced ? false : { y: 24 }}
            animate={{ y: 0 }}
            exit={reduced ? undefined : { y: -12, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: "spring", visualDuration: 0.3, bounce: 0.15 }}
          >
            {body}
          </m.div>
        </AnimatePresence>
      </main>

      <footer className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 px-4 pb-6">
        {inProgress && !play.feedback ? (
          <LqButton variant="secondary" onClick={() => setConfirmHandIn(true)} disabled={play.busy === "finish"}>
            {t("quizChallenge.play.game.handIn")}
          </LqButton>
        ) : null}
        {!attempt && boot !== "loading" ? (
          <button type="button" onClick={onLeave} className="focus-ring min-h-11 rounded-md px-2 text-sm text-lq-fg-muted underline-offset-4 hover:text-lq-fg hover:underline">
            {t("quizChallenge.play.open.notYou")}
          </button>
        ) : null}
        <p className="font-lq-mono text-xs text-lq-fg-muted">{t("quizChallenge.play.deadline", { date: formatDeadline(info.closes_at, locale) })}</p>
      </footer>

      <LiveAnnouncer message={announcement} />
      <LiveToast toast={toast} onDismiss={dismissToast} dismissLabel={t("quizPlay.toast.dismiss")} />
      <ConfirmDialog
        open={confirmHandIn}
        title={t("quizChallenge.play.game.handInTitle")}
        message={t("quizChallenge.play.game.handInText")}
        confirmLabel={t("quizChallenge.play.game.handInConfirm")}
        cancelLabel={t("quizChallenge.play.game.handInCancel")}
        tone="danger"
        busy={play.busy === "finish"}
        onCancel={() => setConfirmHandIn(false)}
        onConfirm={() => {
          void play.finish().finally(() => setConfirmHandIn(false));
        }}
      />
    </LiveThemeRoot>
  );
}

export function formatDeadline(value: string | null, locale: string): string {
  if (!value) {
    return "–";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "–" : date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
}

/** Whole-attempt clock (time mode "total"): visible mm:ss, announced politely in the last minute. */
function TotalCountdown({ play }: { play: ChallengePlay }) {
  const { t } = useI18n();
  const timer = useMemo(() => totalTimer(play.attempt), [play.attempt]);
  const value = useCountdown(timer, play.clock);
  const { refresh } = play;
  const expired = value.stage === "expired";
  useEffect(() => {
    if (!expired) {
      return undefined;
    }
    // The total deadline has no server slack: the next read finishes the attempt.
    const handle = setTimeout(() => void refresh(), 250);
    return () => clearTimeout(handle);
  }, [expired, refresh]);
  if (!timer || value.stage === "idle" || value.stage === "untimed") {
    return null;
  }
  const text = formatClock(value.remainingMs);
  const lastMinute = value.stage === "open" && value.remainingMs <= 60_000;
  return (
    <span
      role="timer"
      aria-label={t("quizChallenge.play.game.totalLeftSr", { time: text })}
      className={cn(
        "shrink-0 rounded-full px-3 py-1.5 font-lq-mono text-sm font-medium tabular-nums",
        lastMinute ? "bg-lq-warning text-lq-on-warning" : "bg-lq-surface-2 text-lq-fg"
      )}
    >
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

/** One item: a content slide ("Continuar") or a question with its pad and countdown. */
function ItemStep({ play }: { play: ChallengePlay }) {
  const { t } = useI18n();
  const attempt = play.attempt;
  const question = attempt?.item ?? null;
  const timer = useMemo(() => itemTimer(attempt), [attempt]);
  const countdown = useCountdown(timer, play.clock);
  const { refresh } = play;
  const expired = countdown.stage === "expired";
  const [polls, setPolls] = useState(0);

  // At zero: the server expires the item on its next read (after its 1.5 s slack).
  useEffect(() => {
    if (!expired || polls >= MAX_EXPIRY_POLLS) {
      return undefined;
    }
    const handle = setTimeout(() => {
      setPolls((value) => value + 1);
      void refresh();
    }, EXPIRY_REFRESH_DELAY_MS * (polls + 1));
    return () => clearTimeout(handle);
  }, [expired, polls, refresh]);

  // Polite announcement once, when 10 s are left (the visible timer is not read every second).
  const announceLow = countdown.stage === "open" && countdown.seconds <= 10 ? t("quizChallenge.play.game.timeWarn", { seconds: 10 }) : "";

  // A pending next item without its correction on screen (e.g. a duplicate reply): reveal it.
  const pendingNext = Boolean(attempt?.next_pending && !question);
  useEffect(() => {
    if (pendingNext) {
      void refresh();
    }
  }, [pendingNext, refresh]);

  if (pendingNext) {
    return (
      <p role="status" className="m-auto text-lq-fg-muted">
        {t("quizChallenge.play.game.loadingNext")}
      </p>
    );
  }
  if (!attempt || !question) {
    return null;
  }
  if (question.removed) {
    return <RemovedView />;
  }
  if (!isAnswerableType(question.item_type)) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <ContentView question={question} />
        <LqButton size="lg" onClick={() => void play.advance()} busy={play.busy === "advance"} busyLabel={t("quizChallenge.play.game.sending")}>
          {t("quizChallenge.play.game.contentContinue")}
        </LqButton>
      </div>
    );
  }
  if (expired) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 text-center">
        <LockGlyph />
        <PhaseHeading className="text-3xl">{t("quizChallenge.play.game.timeUp")}</PhaseHeading>
        <p role="status" className="text-lq-fg-muted">
          {polls >= MAX_EXPIRY_POLLS ? t("quizChallenge.play.game.timeUpStuck") : t("quizChallenge.play.game.timeUpWaiting")}
        </p>
        {polls >= MAX_EXPIRY_POLLS ? (
          <LqButton onClick={() => void refresh()} busy={play.busy === "refresh"}>
            {t("quizPlay.room.retry")}
          </LqButton>
        ) : null}
      </div>
    );
  }
  const pending = play.pending && play.pending.qi === question.qi ? play.pending : null;
  const sending = pending?.status === "sending";
  const failed = pending?.status === "failed";
  const invalid = play.notice?.kind === "invalid";
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <PhaseHeading className="font-lq-prompt text-xl leading-snug font-bold">{question.prompt}</PhaseHeading>
        {countdown.stage === "open" ? (
          <span
            role="timer"
            aria-label={t("quizPlay.question.timeLeft", { seconds: countdown.seconds })}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 font-lq-mono text-lg tabular-nums",
              countdown.warning ? "lq-warn-pulse bg-lq-warning text-lq-on-warning" : "bg-lq-surface-2 text-lq-fg"
            )}
          >
            <span aria-hidden="true">{countdown.seconds}</span>
          </span>
        ) : null}
      </div>
      {timer ? <CountdownBar timer={timer} clock={play.clock} /> : null}
      {invalid ? <LqError>{t("quizChallenge.play.game.invalid")}</LqError> : null}
      {failed ? (
        <div className="flex flex-col gap-2">
          <LqError>{t("quizChallenge.play.game.sendFailed")}</LqError>
          <LqButton onClick={play.retrySubmit}>{t("quizChallenge.play.game.resend")}</LqButton>
        </div>
      ) : null}
      {sending ? (
        <p role="status" className="text-center font-semibold text-lq-fg-muted">
          {t("quizChallenge.play.game.sending")}
        </p>
      ) : null}
      <AnswerPad
        key={`${attempt.attempt_id}:${question.qi}:${play.notice?.id ?? 0}`}
        question={question}
        disabled={sending || failed}
        onSubmit={(answer) => {
          play.clearNotice();
          void play.submit(answer);
        }}
      />
      <LiveAnnouncer message={announceLow} />
    </div>
  );
}

/** Policy "each": the correction right after the answer, then "Próxima" (or "Ver resultado"). */
function FeedbackStep({ play, finished }: { play: ChallengePlay; finished: boolean }) {
  const { t } = useI18n();
  const shown = play.feedback;
  if (!shown) {
    return null;
  }
  // Policy "each" sends the running score (null under the other policies).
  const score = play.attempt?.score ?? null;
  const reveal = revealFromFeedback(shown.feedback, shown.question, score);
  return (
    <div className="flex flex-1 flex-col gap-5">
      <RevealFeedback
        question={shown.question}
        reveal={reveal}
        showCorrect
        showExplanation
        showTotal={score !== null}
        submission={submissionFromFeedback(shown.feedback, shown.answer)}
      />
      {/* The next item (and its clock) is only revealed by "Próxima": reading the correction is free. */}
      <LqButton size="lg" onClick={() => void play.next()} busy={play.busy === "refresh"} busyLabel={t("quizChallenge.play.game.loadingNext")}>
        {finished ? t("quizChallenge.play.game.seeResult") : t("quizChallenge.play.game.next")}
      </LqButton>
    </div>
  );
}
