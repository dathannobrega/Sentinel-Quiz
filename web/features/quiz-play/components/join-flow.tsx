"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { m } from "motion/react";

import { LiveMotionProvider, springs } from "@/components/quiz-kit/motion";
import { LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { LqButton, LqError, lqButtonClass, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import {
  clearParticipantCredentials,
  credentialsFromJoin,
  getRoom,
  loadParticipantCredentials,
  saveParticipantCredentials,
  saveReturnCode,
  toJoinErrorCode,
  type ParticipantCredentials
} from "@/features/quiz-live/lib/live-fetch";
import { formatJoinCode, isValidJoinCode, normalizeJoinCode } from "@/features/quiz-live/lib/protocol";
import { GuestJoinForm, RejoinForm, ReturnCodeCard } from "@/features/quiz-play/components/join-forms";
import { PlayScreen } from "@/features/quiz-play/components/play-screen";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import type { LiveJoinResult, LiveRoomInfo } from "@/types/api/live";
import { cn } from "@/lib/utils/cn";

type Stage =
  | { kind: "boot" }
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: boolean }
  | { kind: "form" }
  | { kind: "rejoin"; notice: string | null }
  | { kind: "returnCode"; returnCode: string; credentials: ParticipantCredentials }
  | { kind: "play"; credentials: ParticipantCredentials };

/** `/j/{code}`: room lookup → join (guest/logged/rejoin) → return code once → live play screen. */
export function JoinFlow({ rawCode }: { rawCode: string }) {
  const { t } = useI18n();
  const code = normalizeJoinCode(rawCode);
  const [stage, setStage] = useState<Stage>({ kind: "boot" });
  const [room, setRoom] = useState<LiveRoomInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const userQuery = useCurrentUser({ enabled: Boolean(room?.requires_login) });

  // Credentials live in sessionStorage (client only), so the first decision happens after mount.
  useEffect(() => {
    if (!isValidJoinCode(code)) {
      setStage({ kind: "error", message: t("quizPlay.errors.room_not_found"), retry: false });
      return;
    }
    const stored = loadParticipantCredentials(code);
    if (stored) {
      setStage({ kind: "play", credentials: stored });
    } else {
      setStage({ kind: "loading" });
    }
    // Room info is still useful with a stored token (theme); failures only matter without one.
    const controller = new AbortController();
    getRoom(code, controller.signal)
      .then((info) => {
        setRoom(info);
        if (!stored) {
          if (info.status === "finished") {
            setStage({ kind: "error", message: t("quizPlay.errors.session_finished"), retry: false });
          } else {
            setStage({ kind: "form" });
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || stored) {
          return;
        }
        const kind = toJoinErrorCode(error);
        setStage({ kind: "error", message: t(`quizPlay.errors.${kind}`), retry: kind !== "room_not_found" && kind !== "session_finished" });
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

  const onTokenLost = useCallback(() => {
    clearParticipantCredentials(code);
    setStage({ kind: "rejoin", notice: t("quizPlay.errors.tokenLost") });
  }, [code, t]);

  const onLeave = useCallback(() => {
    clearParticipantCredentials(code);
    setStage({ kind: "form" });
    setAttempt((value) => value + 1);
  }, [code]);

  if (stage.kind === "play") {
    return <PlayScreen code={code} credentials={stage.credentials} onTokenLost={onTokenLost} onLeave={onLeave} />;
  }

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
          <GuestJoinForm
            key={userQuery.data?.display_name ?? "guest"}
            code={code}
            room={room}
            defaultName={userQuery.data?.display_name ?? ""}
            onJoined={onJoined}
            onWantRejoin={() => setStage({ kind: "rejoin", notice: null })}
          />
        ) : null;
      break;
    case "rejoin":
      content = <RejoinForm code={code} notice={stage.notice} onJoined={onJoined} onBack={() => setStage({ kind: "form" })} />;
      break;
    case "returnCode":
      content = <ReturnCodeCard returnCode={stage.returnCode} onContinue={() => setStage({ kind: "play", credentials: stage.credentials })} />;
      break;
    default:
      content = null;
  }

  return (
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
      </LiveThemeRoot>
    </LiveMotionProvider>
  );
}
