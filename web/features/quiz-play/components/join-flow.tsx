"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { m } from "motion/react";

import { LiveMotionProvider, springs } from "@/components/quiz-kit/motion";
import { LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { LqButton, LqError, lqButtonClass, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import {
  clearParticipantCredentials,
  clearWaitingTicket,
  credentialsFromJoin,
  forgetParticipant,
  getRoom,
  loadParticipantCredentials,
  loadParticipantIdentity,
  loadWaitingTicket,
  saveParticipantCredentials,
  saveReturnCode,
  saveWaitingTicket,
  ticketFromJoin,
  toJoinErrorCode,
  type ParticipantCredentials,
  type ParticipantIdentity,
  type WaitingTicket
} from "@/features/quiz-live/lib/live-fetch";
import { formatJoinCode, isValidJoinCode, normalizeJoinCode } from "@/features/quiz-live/lib/protocol";
import { AccessForm } from "@/features/quiz-play/components/access-form";
import { GuestJoinForm, RejoinForm, ReturnCodeCard } from "@/features/quiz-play/components/join-forms";
import { MyDataDialog } from "@/features/quiz-play/components/my-data-panel";
import { PlayScreen } from "@/features/quiz-play/components/play-screen";
import { WaitingRoomScreen } from "@/features/quiz-play/components/waiting-room";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import type { LiveJoinResult, LiveJoinWaiting, LiveRoomInfo } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

type Stage =
  | { kind: "boot" }
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: boolean; finished?: boolean }
  /** Name + return code after the token is gone (finished session, other tab): RF-606/RF-633. */
  | { kind: "access"; sessionId: string }
  /** "Excluir meus dados" done (RF-650). */
  | { kind: "erased" }
  | { kind: "form" }
  | { kind: "rejoin"; notice: string | null }
  /** Incremento 7: waiting for the host's approval or a seat. `resumed`: ticket from this tab's storage. */
  | { kind: "waiting"; ticket: WaitingTicket; resumed: boolean }
  | { kind: "returnCode"; returnCode: string; credentials: ParticipantCredentials }
  | { kind: "play"; credentials: ParticipantCredentials };

/**
 * `/j/{code}`: room lookup → join (guest/logged/rejoin) → return code once → live play screen.
 * Incremento 4: "Meus dados" from the consent area, access with the return code once the token is
 * gone (finished sessions: results, data and the claim), and the "data deleted" end state.
 * Incremento 7: a 202 leads to the waiting room; its ticket is kept in this tab, so a reload
 * resumes the wait, and admission continues exactly like a normal join.
 */
export function JoinFlow({ rawCode }: { rawCode: string }) {
  const { t } = useI18n();
  const code = normalizeJoinCode(rawCode);
  const [stage, setStage] = useState<Stage>({ kind: "boot" });
  const [room, setRoom] = useState<LiveRoomInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [myDataOpen, setMyDataOpen] = useState(false);
  // Who joined from this tab (kept even after the token expires); read after mount.
  const [identity, setIdentity] = useState<ParticipantIdentity | null>(null);
  // Admission is announced from a region that survives the switch to the play screen.
  const [announcement, setAnnouncement] = useState("");
  const userQuery = useCurrentUser({ enabled: Boolean(room?.requires_login) });

  // Credentials live in sessionStorage (client only), so the first decision happens after mount.
  useEffect(() => {
    if (!isValidJoinCode(code)) {
      setStage({ kind: "error", message: t("quizPlay.errors.room_not_found"), retry: false });
      return;
    }
    const stored = loadParticipantCredentials(code);
    // A participant token wins over a leftover ticket (admitted in this tab already).
    const ticket = stored ? null : loadWaitingTicket(code);
    setIdentity(loadParticipantIdentity(code));
    if (stored) {
      clearWaitingTicket(code);
      setStage({ kind: "play", credentials: stored });
    } else if (ticket) {
      setStage({ kind: "waiting", ticket, resumed: true });
    } else {
      setStage({ kind: "loading" });
    }
    // Room info is still useful with a stored token (theme); failures only matter without one.
    const controller = new AbortController();
    getRoom(code, controller.signal)
      .then((info) => {
        setRoom(info);
        if (!stored && !ticket) {
          if (info.status === "finished") {
            setStage({ kind: "error", message: t("quizPlay.errors.session_finished"), retry: false, finished: true });
          } else {
            setStage({ kind: "form" });
          }
        }
      })
      .catch((error) => {
        // While waiting, the poll is the source of truth (an ended room answers "expired").
        if (controller.signal.aborted || stored || ticket) {
          return;
        }
        const kind = toJoinErrorCode(error);
        setStage({
          kind: "error",
          message: t(`quizPlay.errors.${kind}`),
          retry: kind !== "room_not_found" && kind !== "session_finished",
          finished: kind === "session_finished"
        });
      });
    return () => controller.abort();
    // `t` changes with the locale only; the flow should not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, attempt]);

  const onJoined = useCallback(
    (result: LiveJoinResult) => {
      const credentials = credentialsFromJoin(result);
      saveParticipantCredentials(code, credentials);
      if (result.return_code) {
        saveReturnCode(code, result.return_code);
        setStage({ kind: "returnCode", returnCode: result.return_code, credentials });
      } else {
        setStage({ kind: "play", credentials });
      }
    },
    [code]
  );

  const onWaiting = useCallback(
    (result: LiveJoinWaiting) => {
      const ticket = ticketFromJoin(result);
      saveWaitingTicket(code, ticket);
      setStage({ kind: "waiting", ticket, resumed: false });
    },
    [code]
  );

  const onAdmitted = useCallback(
    (result: LiveJoinResult) => {
      setAnnouncement(t("quizPlay.waiting.admitted"));
      onJoined(result);
    },
    [onJoined, t]
  );

  /** Back to the join form with fresh room info (after leaving the queue or "Tentar de novo"). */
  const backToForm = useCallback(() => {
    clearWaitingTicket(code);
    setStage({ kind: "loading" });
    setAttempt((value) => value + 1);
  }, [code]);

  const onTokenLost = useCallback(() => {
    clearParticipantCredentials(code);
    setStage({ kind: "rejoin", notice: t("quizPlay.errors.tokenLost") });
  }, [code, t]);

  const onErased = useCallback(() => {
    forgetParticipant(code);
    setIdentity(null);
    setMyDataOpen(false);
    setStage({ kind: "erased" });
  }, [code]);

  const onLeave = useCallback(() => {
    clearParticipantCredentials(code);
    setStage({ kind: "form" });
    setAttempt((value) => value + 1);
  }, [code]);

  const liveRegion = (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );

  if (stage.kind === "play") {
    return (
      <>
        {liveRegion}
        <PlayScreen code={code} credentials={stage.credentials} onTokenLost={onTokenLost} onLeave={onLeave} onErased={onErased} />
      </>
    );
  }

  // The session this tab took part in; for a finished room the code still points at it.
  const knownSessionId = identity?.sessionId ?? (room ? room.session_id : null);

  const theme = room?.theme_key ?? "sentinel";
  const closedForJoins = room ? !room.accepting_joins : false;

  let content: ReactNode;
  switch (stage.kind) {
    case "boot":
    case "loading":
      content = (
        <p role="status" className="py-10 text-center text-lq-fg-muted">
          {t("quizPlay.room.loading")}
        </p>
      );
      break;
    case "error":
      content = (
        <div className="flex flex-col gap-4">
          <LqError>{stage.message}</LqError>
          {stage.retry ? (
            <LqButton variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
              {t("quizPlay.room.retry")}
            </LqButton>
          ) : null}
          {stage.finished && knownSessionId ? (
            <div className="flex flex-col gap-2 rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface-2 p-4">
              <p className="font-semibold text-lq-fg">{t("quizPlay.afterSession.title")}</p>
              <p className="text-sm text-lq-fg-muted">{t("quizPlay.afterSession.text")}</p>
              <LqButton className="mt-1" onClick={() => setStage({ kind: "access", sessionId: knownSessionId })}>
                {t("quizPlay.afterSession.cta")}
              </LqButton>
            </div>
          ) : null}
          <Link href="/j" className={lqButtonClass("primary")}>
            {t("quizPlay.room.changeCode")}
          </Link>
        </div>
      );
      break;
    case "form":
      content =
        room && closedForJoins ? (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizPlay.join.closedTitle")}</h2>
              <p className="text-sm text-lq-fg-muted">{t("quizPlay.join.closedText")}</p>
            </div>
            <RejoinForm code={code} onJoined={onJoined} />
          </div>
        ) : room ? (
          <div className="flex flex-col gap-4">
            {room.requires_approval || room.full ? (
              <p className="rounded-[calc(var(--lq-radius)*0.5)] border border-lq-line bg-lq-surface-2 px-3 py-2 text-sm text-lq-fg">
                {room.requires_approval ? t("quizPlay.join.approvalNotice") : t("quizPlay.join.fullNotice")}
              </p>
            ) : null}
            <GuestJoinForm
              key={userQuery.data?.display_name ?? "guest"}
              code={code}
              room={room}
              defaultName={userQuery.data?.display_name ?? ""}
              onJoined={onJoined}
              onWaiting={onWaiting}
              onWantRejoin={() => setStage({ kind: "rejoin", notice: null })}
              onOpenMyData={() => setMyDataOpen(true)}
            />
          </div>
        ) : null;
      break;
    case "waiting":
      content = (
        <WaitingRoomScreen
          key={stage.ticket.requestId}
          code={code}
          ticket={stage.ticket}
          resumed={stage.resumed}
          onAdmitted={onAdmitted}
          onLeft={backToForm}
          onRetry={backToForm}
        />
      );
      break;
    case "rejoin":
      content = <RejoinForm code={code} notice={stage.notice} onJoined={onJoined} onBack={() => setStage({ kind: "form" })} />;
      break;
    case "access":
      content = (
        <div className="flex flex-col gap-4">
          <AccessForm variant="live" sessionId={stage.sessionId} defaultName={identity?.displayName ?? ""} onAccess={onJoined} />
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="focus-ring min-h-11 self-center rounded-md px-2 text-sm font-semibold text-lq-accent underline-offset-4 hover:underline"
          >
            {t("quizPlay.afterSession.back")}
          </button>
        </div>
      );
      break;
    case "erased":
      content = <ErasedCard />;
      break;
    case "returnCode":
      content = <ReturnCodeCard returnCode={stage.returnCode} onContinue={() => setStage({ kind: "play", credentials: stage.credentials })} />;
      break;
    default:
      content = null;
  }

  return (
    <>
      {liveRegion}
      <LiveMotionProvider>
        <LiveThemeRoot theme={theme} className="min-h-dvh" particles>
          <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-8">
            <header className="mb-5 flex flex-col items-center gap-1 text-center">
              <p className="font-lq-mono text-xs font-medium tracking-[0.2em] text-lq-accent uppercase">{t("quizPlay.brand")}</p>
              <h1 className="font-lq text-2xl font-extrabold text-balance text-lq-fg sm:text-3xl">{room?.title || t("quizPlay.meta.roomTitle")}</h1>
              <p className="font-lq-mono text-sm text-lq-fg-muted">
                {t("quizPlay.room.pin", { code: formatJoinCode(code) })}
                {room ? ` · ${t("quizPlay.room.participants", { count: room.participant_count })}` : ""}
              </p>
            </header>
            <m.div key={stage.kind} initial={{ y: 16 }} animate={{ y: 0 }} transition={springs.gentle} className={cn(lqCardClass, "px-5 py-7 sm:px-8")}>
              {content}
            </m.div>
          </main>
          <MyDataDialog
            open={myDataOpen}
            onClose={() => setMyDataOpen(false)}
            intro={t("quizPlay.myData.rightsText")}
            token={null}
            sessionId={identity?.sessionId ?? null}
            defaultName={identity?.displayName}
            onTokenRefreshed={(result) => saveParticipantCredentials(code, credentialsFromJoin(result))}
            onErased={onErased}
          />
        </LiveThemeRoot>
      </LiveMotionProvider>
    </>
  );
}

/** End state after "Excluir meus dados": focus lands on the confirmation. */
function ErasedCard() {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-lq-success text-2xl font-black text-lq-on-success">
        ✓
      </span>
      <h2 ref={headingRef} tabIndex={-1} className="font-lq text-2xl font-extrabold text-lq-fg outline-none">
        {t("quizPlay.erased.title")}
      </h2>
      <p role="status" className="text-sm text-lq-fg-muted">
        {t("quizPlay.erased.text")}
      </p>
      <Link href="/j" className={cn(lqButtonClass("primary"), "w-full")}>
        {t("quizPlay.erased.back")}
      </Link>
    </div>
  );
}
