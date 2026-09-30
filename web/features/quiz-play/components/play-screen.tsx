"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";

import { Avatar } from "@/components/quiz-kit/avatar";
import { CountdownBar } from "@/components/quiz-kit/countdown-ring";
import { LiveMotionProvider, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectionBanner, LiveAnnouncer, LiveThemeRoot, TransportBadge } from "@/features/quiz-live/components/live-chrome";
import { LiveToast, useLiveToast } from "@/features/quiz-live/components/live-toast";
import { LqButton, LqError, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import {
  credentialsFromJoin,
  loadReturnCode,
  saveParticipantCredentials,
  type ParticipantCredentials
} from "@/features/quiz-live/lib/live-fetch";
import { selectCanAnswer, selectMyTimer, type LiveState } from "@/features/quiz-live/lib/live-store";
import { formatJoinCode, isAnswerableType } from "@/features/quiz-live/lib/protocol";
import { LiveProvider, useCountdown, useLive, useLiveConnection, useLiveState } from "@/features/quiz-live/lib/use-live-session";
import { AnswerPad } from "@/features/quiz-play/components/answer-pad";
import { MyDataDialog } from "@/features/quiz-play/components/my-data-panel";
import { ParticipantMenu } from "@/features/quiz-play/components/participant-menu";
import {
  ContentView,
  ExtendedTimeBadge,
  FinalView,
  LockedView,
  PausedView,
  PhaseHeading,
  ReadingView,
  RemovedView,
  RevealFeedback,
  StandingView,
  SubmittedView,
  WaitingLobby
} from "@/features/quiz-play/components/participant-phases";
import { ReportDialog } from "@/features/quiz-play/components/report-dialog";
import { useI18n } from "@/lib/i18n";
import type { LiveJoinResult } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

const selectView = (state: LiveState) => ({
  hydrated: state.hydrated,
  themeKey: state.themeKey,
  title: state.title,
  phase: state.phase,
  status: state.status,
  qi: state.qi,
  total: state.total,
  question: state.question,
  /** The participant's OWN timer (extended time applied, RF-622); paused with the room. */
  timer: selectMyTimer(state),
  paused: state.phase === "question" && Boolean(state.timer?.paused),
  timeMultiplier: state.myTimeMultiplier,
  submission: state.submission,
  reveal: state.reveal,
  leaderboard: state.leaderboard,
  podium: state.podium,
  my: state.my,
  me: state.me,
  settings: state.settings,
  answered: state.answered,
  answerTotal: state.answerTotal,
  participantCount: state.participantCount,
  lobbyCount: state.lobby?.count ?? state.participantCount,
  connection: state.connection,
  kicked: state.kicked
});

type View = ReturnType<typeof selectView>;

export interface PlayScreenProps {
  code: string;
  credentials: ParticipantCredentials;
  onTokenLost: () => void;
  onLeave: () => void;
  /** "Excluir meus dados" finished (RF-650): the caller forgets the credentials. */
  onErased?: () => void;
  /**
   * Host phone preview (RF-514): the same client inside a phone frame. Fills its container
   * instead of the viewport and never writes participant credentials to this tab's storage.
   */
  embedded?: boolean;
}

/** Participant live screen: connects with the stored token and renders the current phase. */
export function PlayScreen(props: PlayScreenProps) {
  const { credentials } = props;
  const liveCredentials = useMemo(() => ({ kind: "participant" as const, token: credentials.token }), [credentials.token]);
  const connection = useLiveConnection("participant", liveCredentials);
  return (
    <LiveProvider value={connection}>
      <LiveMotionProvider>
        <PlayInner {...props} />
      </LiveMotionProvider>
    </LiveProvider>
  );
}

function PlayInner({ code, credentials, onTokenLost, onLeave, onErased, embedded = false }: PlayScreenProps) {
  const { t } = useI18n();
  const live = useLive();
  const view = useLiveState(selectView);
  const reduced = useLqReducedMotion();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showCode, setShowCode] = useState(false);
  // PlayScreen only mounts on the client (after the join flow read sessionStorage).
  const [returnCode] = useState<string | null>(() => (embedded ? null : loadReturnCode(code)));
  const [reportOpen, setReportOpen] = useState(false);
  const [myDataOpen, setMyDataOpen] = useState(false);
  const { toast, show: showToast, dismiss: dismissToast } = useLiveToast();

  // A token refreshed with the return code (inside "Meus dados" or the claim) replaces the stored one.
  const onTokenRefreshed = useCallback(
    (result: LiveJoinResult) => {
      if (!embedded) {
        saveParticipantCredentials(code, credentialsFromJoin(result));
      }
    },
    [code, embedded]
  );
  const onDataErased = useCallback(() => {
    setMyDataOpen(false);
    (onErased ?? onLeave)();
  }, [onErased, onLeave]);

  const closed = view.connection.status === "closed" ? view.connection.reason : null;
  useEffect(() => {
    if (closed === "auth" || closed === "token_expired") {
      onTokenLost();
    }
  }, [closed, onTokenLost]);

  const name = view.me?.display_name ?? credentials.displayName;
  // The item on screen can be reported on its own (not a removed placeholder).
  const reportableQi =
    view.question && !view.question.removed && view.qi !== null && ["question", "locked", "reveal", "content"].includes(view.phase) ? view.qi : null;
  const seed = view.me?.avatar_seed ?? credentials.avatarSeed;
  const score = view.my?.score ?? 0;
  const current = (view.qi ?? 0) + 1;

  const announcement = useMemo(() => {
    switch (view.phase) {
      case "lobby":
        return t("quizPlay.announce.lobby");
      case "question":
        if (view.paused) {
          return t("quizPlay.announce.paused");
        }
        return view.question ? t("quizPlay.announce.question", { current, total: view.total, prompt: view.question.prompt }) : "";
      case "locked":
        return t("quizPlay.announce.locked");
      case "reveal":
        return t("quizPlay.announce.reveal");
      case "leaderboard":
        return t("quizPlay.announce.leaderboard");
      case "podium":
        return t("quizPlay.announce.podium");
      case "finished":
        return t("quizPlay.announce.finished");
      default:
        return "";
    }
  }, [view.phase, view.paused, view.question, view.total, current, t]);

  let body: ReactNode;
  let key: string;
  if (view.kicked || closed === "kicked" || closed === "banned") {
    key = "kicked";
    const banned = view.kicked?.banned || closed === "banned";
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <PhaseHeading className="text-3xl">{t("quizPlay.kicked.title")}</PhaseHeading>
        <p className="text-lq-fg-muted">{t(banned ? "quizPlay.connection.closed.banned" : "quizPlay.connection.closed.kicked")}</p>
        <LqButton onClick={onLeave}>{t("quizPlay.kicked.back")}</LqButton>
      </div>
    );
  } else if (closed && closed !== "manual" && closed !== "session_ended" && closed !== "auth" && closed !== "token_expired") {
    key = `closed:${closed}`;
    const reasonKey = ["room_full", "protocol", "policy"].includes(closed) ? closed : "generic";
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <LqError>{t(`quizPlay.connection.closed.${reasonKey}`)}</LqError>
        <LqButton onClick={live.reconnect}>{t("quizPlay.connection.retry")}</LqButton>
      </div>
    );
  } else if (!view.hydrated) {
    key = "loading";
    body = (
      <p role="status" className="m-auto text-lq-fg-muted">
        {closed === "session_ended" ? t("quizPlay.connection.closed.session_ended") : t("quizPlay.connection.connecting")}
      </p>
    );
    if (closed === "session_ended") {
      key = "ended-early";
      body = (
        <FinalView
          rank={null}
          total={0}
          score={0}
          podiumPhase={false}
          token={credentials.token}
          rights={{ code, sessionId: credentials.sessionId, displayName: name, finished: !embedded, onOpenMyData: () => setMyDataOpen(true), onTokenRefreshed }}
        />
      );
    }
  } else {
    switch (view.phase) {
      case "lobby":
        key = "lobby";
        body = <WaitingLobby name={name} seed={seed} count={view.lobbyCount} />;
        break;
      case "question":
        key = `question:${view.qi}`;
        body = <QuestionPhase view={view} />;
        break;
      case "content":
        key = `content:${view.qi}`;
        body = <ContentView question={view.question} />;
        break;
      case "locked":
        key = `locked:${view.qi}`;
        body = <LockedView question={view.question} submission={view.submission} />;
        break;
      case "reveal":
        key = `reveal:${view.qi}`;
        body = view.reveal ? (
          <RevealFeedback
            question={view.question}
            reveal={view.reveal}
            showCorrect={view.settings?.show_correct_on_device ?? true}
            showExplanation={view.settings?.show_explanation ?? true}
            submission={view.submission}
          />
        ) : (
          <LockedView question={view.question} submission={view.submission} />
        );
        break;
      case "leaderboard":
        key = `leaderboard:${view.qi}`;
        body = <StandingView leaderboard={view.leaderboard} meId={view.me?.participant_id ?? credentials.participantId} />;
        break;
      case "podium":
      case "finished":
        key = view.phase;
        body = (
          <FinalView
            rank={view.podium?.my?.rank ?? view.my?.rank ?? null}
            total={view.podium?.stats.participants ?? view.participantCount}
            score={view.podium?.my?.score ?? score}
            podiumPhase={view.phase === "podium"}
            token={credentials.token}
            rights={{
              code,
              sessionId: credentials.sessionId,
              displayName: name,
              // The host preview never offers the claim (it would link the preview to the host's account).
              finished: !embedded && (view.phase === "finished" || view.status === "finished"),
              onOpenMyData: () => setMyDataOpen(true),
              onTokenRefreshed
            }}
          />
        );
        break;
      default:
        key = "unknown";
        body = null;
    }
  }

  return (
    <LiveThemeRoot theme={view.themeKey} className={embedded ? "h-full min-h-full" : "min-h-dvh"} particles={view.phase === "lobby"}>
      <ConnectionBanner connection={view.connection} labels={{ connecting: t("quizPlay.connection.connecting"), reconnecting: t("quizPlay.connection.reconnecting"), offline: t("quizPlay.connection.offline") }} />
      <header className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 pt-4">
        <Avatar seed={seed} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-lq font-bold text-lq-fg">{name}</p>
          <p className="truncate font-lq-mono text-xs text-lq-fg-muted">
            {t("quizPlay.room.pin", { code: formatJoinCode(code) })}
            {view.phase !== "lobby" && view.total ? ` · ${t("quizPlay.question.counter", { current, total: view.total })}` : ""}
          </p>
        </div>
        <TransportBadge transport={view.connection.transport} label={t("quizPlay.connection.transportSse")} hint={t("quizPlay.connection.transportSseHint")} />
        {view.phase !== "lobby" ? (
          <span className="rounded-full bg-lq-surface-2 px-3 py-1.5 font-lq-mono text-sm font-medium text-lq-fg tabular-nums">{new Intl.NumberFormat().format(score)}</span>
        ) : null}
        {view.hydrated && !view.kicked ? (
          <ParticipantMenu
            label={t("quizPlay.menu.label")}
            className="-mr-2"
            items={[
              { id: "report", label: reportableQi !== null ? t("quizPlay.menu.reportQuestion") : t("quizPlay.menu.report"), onSelect: () => setReportOpen(true) },
              { id: "data", label: t("quizPlay.menu.myData"), onSelect: () => setMyDataOpen(true) }
            ]}
          />
        ) : null}
      </header>
      {view.phase === "question" && view.timer ? (
        <div className="mx-auto w-full max-w-xl px-4 pt-3">
          <CountdownBar timer={view.timer} clock={live.clock} />
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-4 py-5">
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

      {view.phase === "lobby" ? (
        <footer className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 px-4 pb-6">
          {returnCode ? (
            <div className="flex flex-col items-center gap-1">
              <button type="button" className="focus-ring min-h-11 rounded-md px-2 text-sm font-semibold text-lq-accent underline-offset-4 hover:underline" aria-expanded={showCode} onClick={() => setShowCode((value) => !value)}>
                {showCode ? t("quizPlay.returnCode.hide") : t("quizPlay.returnCode.showAgain")}
              </button>
              {showCode ? <span className={cn(lqCardClass, "px-4 py-2 font-lq-mono text-2xl tracking-[0.18em] text-lq-fg")}>{returnCode}</span> : null}
            </div>
          ) : null}
          <button type="button" onClick={() => setConfirmLeave(true)} className="focus-ring min-h-11 rounded-md px-2 text-sm text-lq-fg-muted underline-offset-4 hover:text-lq-fg hover:underline">
            {t("quizPlay.lobby.notYou")}
          </button>
        </footer>
      ) : null}

      <LiveAnnouncer message={announcement} />
      <LiveToast toast={toast} onDismiss={dismissToast} dismissLabel={t("quizPlay.toast.dismiss")} contained={embedded} />
      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        token={credentials.token}
        itemQi={reportableQi}
        onSent={() => {
          setReportOpen(false);
          showToast(t("quizPlay.report.success"), "success");
        }}
      />
      <MyDataDialog
        open={myDataOpen}
        onClose={() => setMyDataOpen(false)}
        token={credentials.token}
        sessionId={credentials.sessionId}
        defaultName={name}
        onTokenRefreshed={onTokenRefreshed}
        onErased={onDataErased}
      />
      <ConfirmDialog
        open={confirmLeave}
        title={t("quizPlay.leave.confirmTitle")}
        message={t("quizPlay.leave.confirmText")}
        confirmLabel={t("quizPlay.leave.confirm")}
        cancelLabel={t("quizPlay.leave.cancel")}
        tone="danger"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => {
          setConfirmLeave(false);
          onLeave();
        }}
      />
    </LiveThemeRoot>
  );
}

/** Reading phase → answer pad → submitted, driven by the server clock. */
function QuestionPhase({ view }: { view: View }) {
  const { t } = useI18n();
  const live = useLive();
  const countdown = useCountdown(view.timer, live.clock);
  const question = view.question;
  if (!question) {
    return null;
  }
  if (question.removed) {
    return <RemovedView />;
  }
  if (countdown.stage === "reading" && !countdown.paused) {
    return <ReadingView question={question} seconds={countdown.seconds} />;
  }
  if (!isAnswerableType(question.item_type)) {
    return <ContentView question={question} />;
  }
  const submission = view.submission;
  // Rejections that leave the question answerable: a bad payload, or an answer sent while paused.
  const retryable = submission?.status === "rejected" && (submission.ack === "invalid" || submission.ack === "paused");
  if (submission && !retryable) {
    return <SubmittedView question={question} submission={submission} answered={view.answered} total={view.answerTotal} />;
  }
  if (countdown.paused) {
    return <PausedView question={question} secondsLeft={countdown.stage === "open" ? countdown.seconds : null} />;
  }
  if (countdown.stage === "expired") {
    return <LockedView question={question} submission={null} />;
  }
  const canAnswer = selectCanAnswer(live.store.getState(), live.clock.serverNow());
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-lq-prompt text-xl leading-snug font-bold text-lq-fg">{question.prompt}</p>
        {countdown.stage === "open" ? (
          <span role="timer" aria-label={t("quizPlay.question.timeLeft", { seconds: countdown.seconds })} className={cn("shrink-0 rounded-full px-3 py-1 font-lq-mono text-lg tabular-nums", countdown.warning ? "lq-warn-pulse bg-lq-warning text-lq-on-warning" : "bg-lq-surface-2 text-lq-fg")}>
            {countdown.seconds}
          </span>
        ) : null}
      </div>
      {view.timeMultiplier !== 1 ? <ExtendedTimeBadge multiplier={view.timeMultiplier} className="self-start" /> : null}
      {retryable ? <LqError>{t(submission?.ack === "paused" ? "quizPlay.submitted.rejected.paused" : "quizPlay.submitted.rejected.invalid")}</LqError> : null}
      <AnswerPad key={`${question.qi}:${submission?.answerId ?? "fresh"}`} question={question} disabled={!canAnswer} onSubmit={(answer) => live.submitAnswer(question.qi, answer)} />
    </div>
  );
}
