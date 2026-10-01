"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { m } from "motion/react";

import { LiveMotionProvider, springs } from "@/components/quiz-kit/motion";
import { ChallengeGame, formatDeadline } from "@/features/quiz-challenge/components/challenge-game";
import { remainingMs, syncClock, createChallengeClock, formatClock, formatDurationShort } from "@/features/quiz-challenge/lib/challenge-time";
import { LiveAnnouncer, LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { LqButton, LqError, lqCardClass } from "@/features/quiz-live/components/lq-ui";
import {
  clearParticipantCredentials,
  credentialsFromJoin,
  loadParticipantCredentials,
  loadParticipantIdentity,
  saveParticipantCredentials,
  saveReturnCode,
  type ParticipantCredentials,
  type ParticipantIdentity
} from "@/features/quiz-live/lib/live-fetch";
import { AccessForm } from "@/features/quiz-play/components/access-form";
import { GuestJoinForm, ReturnCodeCard } from "@/features/quiz-play/components/join-forms";
import {
  accessChallenge,
  getChallengeInfo,
  isValidChallengeSlug,
  joinChallenge,
  normalizeChallengeSlug,
  toChallengeJoinErrorCode
} from "@/lib/api/live-challenge";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser } from "@/lib/query/hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveChallengeInfo, LiveJoinResult } from "@/types/api";

const DAY_MS = 86_400_000;

/**
 * Storage key of a participation: one per challenge link. The token stays in sessionStorage
 * (PLANO §13.5, like the live rooms); only the identity (session id + name) lives in localStorage
 * for 30 days, so "Continuar" after closing the tab asks for the return code.
 */
export function challengeStorageKey(slug: string): string {
  return `q:${slug}`;
}

type Stage =
  | { kind: "loading" }
  | { kind: "error"; message: string; retry: boolean }
  | { kind: "scheduled" }
  | { kind: "form" }
  /** A known identity on this device: "Continuar" asks for the return code. */
  | { kind: "continue" }
  | { kind: "access"; reason: "continue" | "results" | "rejoin" | "tokenLost" }
  | { kind: "closed" }
  | { kind: "returnCode"; returnCode: string; credentials: ParticipantCredentials }
  | { kind: "play"; credentials: ParticipantCredentials };

/**
 * `/q/{slug}`: link lookup → scheduled (countdown) / open (join or continue) / closed (results with
 * the return code) → the attempt screens. Same lightweight layout as `/j/{code}`.
 */
export function ChallengeFlow({ rawSlug }: { rawSlug: string }) {
  const { t, locale } = useI18n();
  const slug = normalizeChallengeSlug(rawSlug);
  const storageKey = challengeStorageKey(slug);
  const [stage, setStage] = useState<Stage>(() =>
    isValidChallengeSlug(slug) ? { kind: "loading" } : { kind: "error", message: t("quizChallenge.play.errors.challenge_not_found"), retry: false }
  );
  const [info, setInfo] = useState<LiveChallengeInfo | null>(null);
  const [identity, setIdentity] = useState<ParticipantIdentity | null>(null);
  const [reload, setReload] = useState(0);
  const [clock] = useState(() => createChallengeClock());
  const userQuery = useCurrentUser({ enabled: Boolean(info?.requires_login) });

  // Credentials live in browser storage (client only): the first decision happens after mount.
  useEffect(() => {
    if (!isValidChallengeSlug(slug)) {
      return undefined;
    }
    const stored = loadParticipantCredentials(storageKey);
    const known = loadParticipantIdentity(storageKey);
    const controller = new AbortController();
    // With a token the visit is not counted again as "opened" (funnel).
    getChallengeInfo(slug, { token: stored?.token, signal: controller.signal })
      .then((data) => {
        syncClock(clock, data.server_now);
        setInfo(data);
        setIdentity(known);
        if (data.state === "scheduled") {
          setStage({ kind: "scheduled" });
        } else if (stored && stored.sessionId === data.session_id) {
          setStage({ kind: "play", credentials: stored });
        } else if (data.state === "closed") {
          setStage({ kind: "closed" });
        } else {
          setStage(known && known.sessionId === data.session_id ? { kind: "continue" } : { kind: "form" });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        const kind = toChallengeJoinErrorCode(error);
        setStage({ kind: "error", message: t(`quizChallenge.play.errors.${kind}`), retry: kind !== "challenge_not_found" });
      });
    return () => controller.abort();
    // `t` changes with the locale only; the flow should not restart for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reload]);

  const onJoined = useCallback(
    (result: LiveJoinResult) => {
      const credentials = credentialsFromJoin(result);
      saveParticipantCredentials(storageKey, credentials);
      setIdentity({ sessionId: credentials.sessionId, displayName: credentials.displayName });
      if (result.return_code) {
        saveReturnCode(storageKey, result.return_code);
        setStage({ kind: "returnCode", returnCode: result.return_code, credentials });
      } else {
        setStage({ kind: "play", credentials });
      }
    },
    [storageKey]
  );

  const onTokenRefreshed = useCallback(
    (result: LiveJoinResult) => saveParticipantCredentials(storageKey, credentialsFromJoin(result)),
    [storageKey]
  );

  const onTokenLost = useCallback(() => {
    clearParticipantCredentials(storageKey);
    setStage({ kind: "access", reason: "tokenLost" });
  }, [storageKey]);

  const onLeave = useCallback(() => {
    clearParticipantCredentials(storageKey);
    setStage({ kind: "form" });
  }, [storageKey]);

  const reloadInfo = useCallback(() => setReload((value) => value + 1), []);
  const access = useCallback((body: { display_name: string; return_code: string }) => accessChallenge(slug, body), [slug]);
  const join = useCallback((body: Parameters<typeof joinChallenge>[1]) => joinChallenge(slug, body), [slug]);
  const mapError = useCallback(
    (error: unknown) => {
      const kind = toChallengeJoinErrorCode(error);
      const field: "name" | "consent" | "form" = kind === "name_taken" || kind === "name_rejected" ? "name" : kind === "consent_required" ? "consent" : "form";
      return { message: t(`quizChallenge.play.errors.${kind}`), field, code: kind };
    },
    [t]
  );

  if (stage.kind === "play" && info) {
    return (
      <ChallengeGame
        key={stage.credentials.token}
        slug={slug}
        info={info}
        credentials={stage.credentials}
        onTokenLost={onTokenLost}
        onLeave={onLeave}
        onTokenRefreshed={onTokenRefreshed}
      />
    );
  }

  const sessionId = info?.session_id ?? identity?.sessionId ?? "";
  let content: ReactNode;
  switch (stage.kind) {
    case "loading":
    case "play":
      content = (
        <p role="status" className="py-10 text-center text-lq-fg-muted">
          {t("quizChallenge.play.loading")}
        </p>
      );
      break;
    case "error":
      content = (
        <div className="flex flex-col gap-4">
          <LqError>{stage.message}</LqError>
          {stage.retry ? (
            <LqButton variant="secondary" onClick={() => setReload((value) => value + 1)}>
              {t("quizPlay.room.retry")}
            </LqButton>
          ) : null}
        </div>
      );
      break;
    case "scheduled":
      content = info ? <ScheduledCard info={info} clock={clock} onOpened={reloadInfo} /> : null;
      break;
    case "form":
      content = info ? (
        <GuestJoinForm
          key={userQuery.data?.display_name ?? "guest"}
          code={slug}
          room={info}
          defaultName={userQuery.data?.display_name ?? ""}
          onJoined={onJoined}
          onWantRejoin={() => setStage({ kind: "access", reason: "rejoin" })}
          join={join}
          returnTo={`/q/${slug}`}
          mapError={mapError}
          labels={{ subtitle: t("quizChallenge.play.join.subtitle"), submit: t("quizChallenge.play.join.submit") }}
        />
      ) : null;
      break;
    case "continue":
      content = (
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizChallenge.play.open.continueTitle")}</h2>
          {identity ? <p className="text-lq-fg-muted">{t("quizChallenge.play.open.continueAs", { name: identity.displayName })}</p> : null}
          <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.open.continueText")}</p>
          <LqButton size="lg" className="w-full" onClick={() => setStage({ kind: "access", reason: "continue" })}>
            {t("quizChallenge.play.open.continue")}
          </LqButton>
          <button
            type="button"
            onClick={() => setStage({ kind: "form" })}
            className="focus-ring min-h-11 rounded-md px-2 text-sm font-semibold text-lq-accent underline-offset-4 hover:underline"
          >
            {t("quizChallenge.play.open.notYou")}
          </button>
        </div>
      );
      break;
    case "access":
      content = (
        <div className="flex flex-col gap-4">
          {stage.reason === "tokenLost" ? (
            <p className="rounded-[calc(var(--lq-radius)*0.5)] bg-lq-warning px-3 py-2 text-sm font-semibold text-lq-on-warning">{t("quizPlay.errors.tokenLost")}</p>
          ) : null}
          <AccessForm variant="live" sessionId={sessionId} defaultName={identity?.displayName ?? ""} onAccess={onJoined} access={access} />
          <button
            type="button"
            onClick={() => setStage(info?.state === "closed" ? { kind: "closed" } : { kind: "form" })}
            className="focus-ring min-h-11 self-center rounded-md px-2 text-sm font-semibold text-lq-accent underline-offset-4 hover:underline"
          >
            {info?.state === "closed" ? t("quizPlay.afterSession.back") : t("quizPlay.rejoin.back")}
          </button>
        </div>
      );
      break;
    case "closed":
      content = (
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizChallenge.play.closed.title")}</h2>
            <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.closed.text", { date: formatDeadline(info?.closes_at ?? null, locale) })}</p>
          </div>
          <div className="flex flex-col gap-2 rounded-[calc(var(--lq-radius)*0.6)] border border-lq-line bg-lq-surface-2 p-4">
            <p className="font-semibold text-lq-fg">{t("quizChallenge.play.closed.resultsTitle")}</p>
            <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.closed.resultsText")}</p>
            <LqButton className="mt-1" onClick={() => setStage({ kind: "access", reason: "results" })}>
              {t("quizChallenge.play.closed.resultsCta")}
            </LqButton>
          </div>
        </div>
      );
      break;
    case "returnCode":
      content = <ReturnCodeCard returnCode={stage.returnCode} onContinue={() => setStage({ kind: "play", credentials: stage.credentials })} />;
      break;
    default:
      content = null;
  }

  return (
    <LiveMotionProvider>
      <LiveThemeRoot theme={info?.theme_key ?? "sentinel"} className="min-h-dvh" particles>
        <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-4 py-8">
          <header className="mb-5 flex flex-col items-center gap-1 text-center">
            <p className="font-lq-mono text-xs font-medium tracking-[0.2em] text-lq-accent uppercase">{t("quizChallenge.play.brand")}</p>
            <h1 className="font-lq text-2xl font-extrabold text-balance text-lq-fg sm:text-3xl">{info?.title || t("quizChallenge.meta.playTitle")}</h1>
            {info && info.state === "open" && info.closes_at ? (
              <p className="font-lq-mono text-sm text-lq-fg-muted">
                <DeadlineHint closesAt={info.closes_at} clock={clock} />
              </p>
            ) : null}
          </header>
          <m.div key={stage.kind} initial={{ y: 16 }} animate={{ y: 0 }} transition={springs.gentle} className={cn(lqCardClass, "px-5 py-7 sm:px-8")}>
            {content}
          </m.div>
          {identity && stage.kind === "form" && info && identity.sessionId === info.session_id ? (
            <div className="mt-4 flex items-center justify-center text-sm">
              <button type="button" onClick={() => setStage({ kind: "continue" })} className="focus-ring min-h-11 rounded-md px-2 font-semibold text-lq-accent underline-offset-4 hover:underline">
                {t("quizChallenge.play.open.continueAs", { name: identity.displayName })}
              </button>
            </div>
          ) : null}
        </main>
      </LiveThemeRoot>
    </LiveMotionProvider>
  );
}

/** Ticks once a second against the server clock. */
function useServerNow(clock: ReturnType<typeof createChallengeClock>, everyMs = 1000): number {
  const [now, setNow] = useState(() => clock.serverNow());
  useEffect(() => {
    const handle = setInterval(() => setNow(clock.serverNow()), everyMs);
    return () => clearInterval(handle);
  }, [clock, everyMs]);
  return now;
}

/** "Prazo: em 2 d 3 h" under the title while the challenge is open. */
function DeadlineHint({ closesAt, clock }: { closesAt: string; clock: ReturnType<typeof createChallengeClock> }) {
  const { t } = useI18n();
  const now = useServerNow(clock, 30_000);
  const left = remainingMs(closesAt, now) ?? 0;
  return <>{t("quizChallenge.play.open.closesIn", { time: formatDurationShort(left) })}</>;
}

/** Before the opening: title, date and a countdown; reloads the link at zero. */
function ScheduledCard({ info, clock, onOpened }: { info: LiveChallengeInfo; clock: ReturnType<typeof createChallengeClock>; onOpened: () => void }) {
  const { t, locale } = useI18n();
  const now = useServerNow(clock);
  const left = remainingMs(info.opens_at, now) ?? 0;
  const fired = useRef(false);
  useEffect(() => {
    if (left > 0) {
      fired.current = false;
      return undefined;
    }
    if (!fired.current) {
      fired.current = true;
      // A little after the opening, so the server already reports "open".
      const handle = setTimeout(onOpened, 1200);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [left, onOpened]);
  const text = left >= DAY_MS ? formatDurationShort(left) : formatClock(left);
  // Announce politely only when the minute changes (not every second).
  const announced = useMemo(() => t("quizChallenge.play.scheduled.countdown", { time: formatDurationShort(Math.ceil(left / 60_000) * 60_000) }), [left, t]);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h2 className="font-lq text-2xl font-extrabold text-lq-fg">{t("quizChallenge.play.scheduled.title")}</h2>
      <p className="text-lq-fg-muted">{t("quizChallenge.play.scheduled.opensAt", { date: formatDeadline(info.opens_at, locale) })}</p>
      <p role="timer" aria-label={t("quizChallenge.play.scheduled.countdown", { time: text })} className="font-lq-mono text-5xl font-medium text-lq-fg tabular-nums">
        <span aria-hidden="true">{text}</span>
      </p>
      <p className="text-sm text-lq-fg-muted">{t("quizChallenge.play.scheduled.text")}</p>
      <LiveAnnouncer message={announced} />
    </div>
  );
}
