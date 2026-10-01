"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, m } from "motion/react";

import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { LiveThemeRoot } from "@/features/quiz-live/components/live-chrome";
import { lqButtonClass, LqButton } from "@/features/quiz-live/components/lq-ui";
import { createDisplayToken, getSession, loadDisplayToken, saveDisplayToken } from "@/features/quiz-live/lib/live-fetch";
import { selectStageView, waitingTotal, type LiveState } from "@/features/quiz-live/lib/live-store";
import { isAnswerableType } from "@/features/quiz-live/lib/protocol";
import { LiveProvider, useLive, useLiveConnection, useLiveState } from "@/features/quiz-live/lib/use-live-session";
import { HostControlBar, HotkeysHelp, ParticipantsPanel } from "@/features/quiz-present/components/host-controls";
import { PresenterView } from "@/features/quiz-present/components/presenter-view";
import { WaitingRoomDialog, type WaitingRoomActions } from "@/features/quiz-present/components/waiting-room-panel";
import { WordModerationDialog } from "@/features/quiz-present/components/word-moderation";
import { admitCommand, approvalCommand, capacityCommand, rejectCommand } from "@/features/quiz-present/lib/waiting-room";
import { PhonePreviewPanel, PreflightDialog, usePhonePreview, usePreflight } from "@/features/quiz-present/components/room-ops";
import { Stage } from "@/features/quiz-present/components/stage";
import { useElementHeight, useFullscreen, usePresenterHotkeys, useWakeLock, type HotkeyCommand } from "@/features/quiz-present/hooks/use-stage-hooks";
import {
  contextualAction,
  DEFAULT_EXTEND_S,
  extendCommand,
  hostCommand,
  pauseToggleCommand,
  setTimeCommand,
  timeControls,
  type HostAction,
  type HostContext
} from "@/features/quiz-present/lib/host-actions";
import { preflightOverall, shouldAutoRunPreflight } from "@/features/quiz-present/lib/room-ops";
import { isApiError } from "@/lib/api/errors";
import { useI18n } from "@/lib/i18n";
import type { LiveSession } from "@/types/api/live";

type Mode = { kind: "resolving" } | { kind: "host" } | { kind: "presenter" } | { kind: "display"; token: string } | { kind: "display-missing" };

const CALM_KEY = "lq:calm";
/** The presenter view keeps its control bar in flow (sticky): leave roughly its height free. */
const PRESENTER_BAR_ALLOWANCE = 96;

function readDisplayTokenFromUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get("display");
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const fromHash = hash.get("display");
  const token = fromHash || fromQuery;
  if (token) {
    // Never keep the token in the address bar/history (screenshots, shared links, logs).
    url.searchParams.delete("display");
    url.searchParams.set("view", "display");
    url.hash = "";
    window.history.replaceState(window.history.state, "", url.toString());
  }
  return token;
}

/** `/present/{sessionId}`: host stage (default), presenter view (`?view=presenter`) or display-only. */
export function PresentShell({ sessionId }: { sessionId: string }) {
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const [mode, setMode] = useState<Mode>({ kind: "resolving" });

  useEffect(() => {
    const fromUrl = readDisplayTokenFromUrl();
    if (fromUrl) {
      saveDisplayToken(sessionId, fromUrl);
      setMode({ kind: "display", token: fromUrl });
      return;
    }
    if (viewParam === "display") {
      const stored = loadDisplayToken(sessionId);
      setMode(stored ? { kind: "display", token: stored } : { kind: "display-missing" });
      return;
    }
    setMode(viewParam === "presenter" ? { kind: "presenter" } : { kind: "host" });
  }, [sessionId, viewParam]);

  if (mode.kind === "resolving") {
    return <LiveThemeRoot theme="sentinel" className="h-dvh">{null}</LiveThemeRoot>;
  }
  if (mode.kind === "display" || mode.kind === "display-missing") {
    return <DisplayShell sessionId={sessionId} token={mode.kind === "display" ? mode.token : null} />;
  }
  return <HostShell sessionId={sessionId} mode={mode.kind} />;
}

// ----------------------------------------------------------------------------- display only

function DisplayShell({ sessionId, token }: { sessionId: string; token: string | null }) {
  const credentials = useMemo(() => (token ? { kind: "display" as const, token } : null), [token]);
  const connection = useLiveConnection("display", credentials);
  return (
    <LiveProvider value={connection}>
      <LiveMotionProvider features="max">
        <DisplayInner sessionId={sessionId} missing={!token} />
      </LiveMotionProvider>
    </LiveProvider>
  );
}

function DisplayInner({ sessionId, missing }: { sessionId: string; missing: boolean }) {
  const { t } = useI18n();
  const live = useLive();
  const view = useLiveState(selectStageView);
  const connection = useLiveState((state: LiveState) => state.connection);
  const [calm] = useState(() => readCalm());
  useWakeLock(true);
  const { toggle } = useFullscreen();
  usePresenterHotkeys((command) => {
    if (command === "fullscreen") {
      void toggle();
    }
  });

  const expired = missing || (connection.status === "closed" && (connection.reason === "auth" || connection.reason === "token_expired"));
  if (expired) {
    return (
      <LiveThemeRoot theme="sentinel" className="h-dvh">
        <div className="m-auto flex max-w-lg flex-col items-center gap-4 px-6 text-center">
          <p className="font-lq text-2xl font-bold text-lq-fg">{t("quizPresent.errors.displayExpired")}</p>
          <Link href={`/present/${sessionId}`} className={lqButtonClass("secondary")}>
            {t("quizPresent.errors.signIn")}
          </Link>
        </div>
      </LiveThemeRoot>
    );
  }
  return <Stage view={view} clock={live.clock} calm={calm} />;
}

function readCalm(): boolean {
  try {
    return window.sessionStorage.getItem(CALM_KEY) === "1";
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------------- host / presenter

function HostShell({ sessionId, mode }: { sessionId: string; mode: "host" | "presenter" }) {
  const credentials = useMemo(() => ({ kind: "host" as const, sessionId }), [sessionId]);
  const connection = useLiveConnection("host", credentials);
  return (
    <LiveProvider value={connection}>
      <LiveMotionProvider features="max">
        <HostInner sessionId={sessionId} mode={mode} />
      </LiveMotionProvider>
    </LiveProvider>
  );
}

const selectHostMeta = (state: LiveState) => ({
  phase: state.phase,
  qi: state.qi,
  total: state.total,
  itemType: state.question?.item_type ?? null,
  paused: state.phase === "question" && Boolean(state.timer?.paused),
  timed: state.timer ? state.timer.deadline_ms !== null : false,
  roomLocked: state.roomLocked,
  participantCount: state.participantCount,
  participants: state.participants,
  connection: state.connection,
  lastError: state.lastError,
  sessionId: state.sessionId,
  hydrated: state.hydrated,
  joinCode: state.joinCode,
  maxParticipants: state.maxParticipants,
  rehearsal: state.rehearsal,
  removedItem: state.removedItem,
  wordCloud: state.question?.item_type === "word_cloud" ? state.wordCloud : null,
  hiddenWords: state.hiddenWords,
  waitingRoom: state.waitingRoom
});

function HostInner({ sessionId, mode }: { sessionId: string; mode: "host" | "presenter" }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const live = useLive();
  const meta = useLiveState(selectHostMeta);
  const stageView = useLiveState(selectStageView);
  const fullscreen = useFullscreen();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [sessionError, setSessionError] = useState<"auth" | "forbidden" | "not_found" | null>(null);
  // HostInner mounts client-side only (after the mode is resolved), so storage is readable here.
  const [calm, setCalm] = useState(readCalm);
  const [controlsVisible, setControlsVisible] = useState(true);
  // The bar wraps to 1–2 rows depending on the width; the stage reserves exactly its height.
  const [barRef, barHeight] = useElementHeight<HTMLDivElement>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [openingDisplay, setOpeningDisplay] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(false);
  const [waitingOpen, setWaitingOpen] = useState(false);
  const preflight = usePreflight(sessionId);
  const preview = usePhonePreview(sessionId);
  const autoPreflightDone = useRef(false);
  const lastRemovedSts = useRef<number | null>(null);

  useWakeLock(mode === "host");

  useEffect(() => {
    const controller = new AbortController();
    getSession(sessionId, controller.signal)
      .then(setSession)
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isApiError(error)) {
          setSessionError(error.status === 401 ? "auth" : error.status === 403 ? "forbidden" : error.status === 404 ? "not_found" : null);
        }
      });
    return () => controller.abort();
  }, [sessionId]);

  const maxParticipants = meta.maxParticipants ?? session?.max_participants ?? null;
  const rehearsal = Boolean(session?.rehearsal || meta.rehearsal);

  // RF-1115: large rooms (300+ seats) run the pre-event check once, as soon as the lobby is up.
  const { run: runPreflight } = preflight;
  useEffect(() => {
    if (autoPreflightDone.current || !meta.hydrated || meta.phase !== "lobby" || !shouldAutoRunPreflight(maxParticipants)) {
      return;
    }
    autoPreflightDone.current = true;
    void runPreflight().then((result) => {
      if (result && preflightOverall(result) === "attention") {
        setNotice(t("quizPresent.preflight.autoAttention"));
      }
    });
  }, [meta.hydrated, meta.phase, maxParticipants, runPreflight, t]);

  // Moderation removed an item (RF-1114): tell the host once per event.
  const removed = meta.removedItem;
  useEffect(() => {
    if (!removed || lastRemovedSts.current === removed.sts) {
      return;
    }
    lastRemovedSts.current = removed.sts;
    setNotice(removed.current ? t("quizPresent.moderation.toastCurrent", { position: removed.qi + 1 }) : t("quizPresent.moderation.toast"));
  }, [removed, t]);

  // Server errors (stale/forbidden/rate_limited...) and local notices → a short toast.
  const toast = notice ?? (meta.lastError ? t(`quizPresent.errors.${meta.lastError.code}`) : null);
  const dismissToast = useCallback(() => {
    setNotice(null);
    live.store.dispatch({ type: "local.clearError" });
  }, [live.store]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = setTimeout(dismissToast, 4500);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  const context: HostContext = useMemo(
    () => ({
      phase: meta.phase,
      qi: meta.qi,
      total: meta.total,
      answerable: meta.itemType ? isAnswerableType(meta.itemType) : false,
      paused: meta.paused,
      timed: meta.timed
    }),
    [meta.phase, meta.qi, meta.total, meta.itemType, meta.paused, meta.timed]
  );

  const runAction = useCallback(
    (action: HostAction) => {
      if (live.store.getState().connection.status !== "open") {
        return;
      }
      live.send(hostCommand(action, live.store.getState().qi), { queueWhileOffline: false });
    },
    [live]
  );

  // Time controls (RF-622): the current qi is read at click time, so a stale button never pauses
  // the next question (the server also checks expected_qi).
  const togglePause = useCallback(() => {
    const state = live.store.getState();
    if (state.connection.status !== "open" || state.phase !== "question") {
      return;
    }
    live.send(pauseToggleCommand({ qi: state.qi, paused: Boolean(state.timer?.paused) }), { queueWhileOffline: false });
  }, [live]);

  const extendTime = useCallback(
    (seconds: number) => {
      const state = live.store.getState();
      if (state.connection.status !== "open" || state.phase !== "question" || state.timer?.paused || !state.timer || state.timer.deadline_ms === null) {
        return;
      }
      live.send(extendCommand(state.qi, seconds), { queueWhileOffline: false });
    },
    [live]
  );

  const toggleCalm = useCallback(() => {
    setCalm((value) => {
      const next = !value;
      try {
        window.sessionStorage.setItem(CALM_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Word cloud moderation (Incremento 5 §7): the qi is read at click time, like the time controls.
  const sendHideWord = useCallback(
    (word: string, hidden: boolean) => {
      const qi = live.store.getState().qi;
      if (qi !== null) {
        live.send({ type: "host.hide_word", data: { qi, word, hidden } }, { queueWhileOffline: false });
      }
    },
    [live]
  );
  const wordCloudOpen = meta.itemType === "word_cloud" && (meta.phase === "question" || meta.phase === "locked" || meta.phase === "reveal");

  // Waiting room (Incremento 7 §4): commands are not queued while offline (a stale approval
  // replayed later could seat someone the host meant to refuse).
  const waitingActions = useMemo<WaitingRoomActions>(
    () => ({
      admit: (target) => live.send(admitCommand(target), { queueWhileOffline: false }),
      reject: (requestId) => live.send(rejectCommand(requestId), { queueWhileOffline: false }),
      setCapacity: (max) => live.send(capacityCommand(max, live.store.getState().waitingRoom?.platform_max ?? max), { queueWhileOffline: false }),
      setApproval: (required) => live.send(approvalCommand(required), { queueWhileOffline: false })
    }),
    [live]
  );

  const toggleRoomLock = useCallback(() => {
    live.send({ type: "host.room_lock", data: { locked: !live.store.getState().roomLocked } }, { queueWhileOffline: false });
  }, [live]);

  const openDisplay = useCallback(async () => {
    // Open synchronously (inside the click) so popup blockers allow it; navigate once the token exists.
    const popup = window.open("about:blank", `sq-display-${sessionId}`);
    if (!popup) {
      setNotice(t("quizPresent.errors.popupBlocked"));
      return;
    }
    setOpeningDisplay(true);
    try {
      const { token } = await createDisplayToken(sessionId);
      // Token travels in the fragment (never sent to servers or logs) and is stripped on arrival.
      popup.location.href = `${window.location.origin}/present/${encodeURIComponent(sessionId)}?view=display#display=${encodeURIComponent(token)}`;
      popup.opener = null;
    } catch {
      popup.close();
      setNotice(t("quizPresent.errors.displayToken"));
    } finally {
      setOpeningDisplay(false);
    }
  }, [sessionId, t]);

  const switchView = useCallback(() => {
    if (mode === "host") {
      window.open(`${pathname}?view=presenter`, `sq-presenter-${sessionId}`);
    } else {
      router.push(pathname);
    }
  }, [mode, pathname, router, sessionId]);

  const onHotkey = useCallback(
    (command: HotkeyCommand) => {
      switch (command) {
        case "advance": {
          const action = contextualAction(context);
          if (action && action !== "end") {
            runAction(action);
          }
          break;
        }
        case "lock":
          runAction("lock");
          break;
        case "reveal":
          runAction("reveal");
          break;
        case "leaderboard":
          runAction("leaderboard");
          break;
        case "pause":
          if (timeControls(context).pause || timeControls(context).resume) {
            togglePause();
          }
          break;
        case "extend":
          if (timeControls(context).extend) {
            extendTime(DEFAULT_EXTEND_S);
          }
          break;
        case "fullscreen":
          void fullscreen.toggle();
          break;
        case "calm":
          toggleCalm();
          break;
        case "controls":
          setControlsVisible((value) => !value);
          break;
        case "help":
          setHelpOpen((value) => !value);
          break;
        case "escape":
          setHelpOpen(false);
          break;
      }
    },
    [context, runAction, togglePause, extendTime, fullscreen, toggleCalm]
  );
  usePresenterHotkeys(onHotkey);

  const closedReason = meta.connection.status === "closed" ? meta.connection.reason : null;
  const authProblem = sessionError === "auth" || closedReason === "auth" || closedReason === "policy";
  if (authProblem || sessionError === "forbidden" || sessionError === "not_found") {
    const message = sessionError === "forbidden" ? t("quizPresent.errors.forbidden") : sessionError === "not_found" ? t("quizPresent.errors.not_found") : t("quizPresent.errors.auth");
    return (
      <LiveThemeRoot theme="sentinel" className="h-dvh">
        <div role="alert" className="m-auto flex max-w-lg flex-col items-center gap-4 px-6 text-center">
          <p className="font-lq text-2xl font-bold text-lq-fg">{message}</p>
          {authProblem ? (
            <Link href={`/login?next=${encodeURIComponent(`/present/${sessionId}`)}`} className={lqButtonClass("primary")}>
              {t("quizPresent.errors.signIn")}
            </Link>
          ) : null}
        </div>
      </LiveThemeRoot>
    );
  }

  const controls = (
    <HostControlBar
      context={context}
      rehearsal={Boolean(session?.rehearsal)}
      onTogglePause={togglePause}
      onExtend={extendTime}
      connection={meta.connection}
      participantCount={meta.participantCount}
      roomLocked={meta.roomLocked}
      calm={calm}
      isFullscreen={fullscreen.isFullscreen}
      fullscreenSupported={fullscreen.supported}
      openingDisplay={openingDisplay}
      mode={mode}
      onAction={runAction}
      onToggleRoomLock={toggleRoomLock}
      onToggleCalm={toggleCalm}
      onToggleFullscreen={() => void fullscreen.toggle()}
      onOpenDisplay={() => void openDisplay()}
      onSwitchView={switchView}
      onOpenParticipants={() => setParticipantsOpen(true)}
      onOpenHelp={() => setHelpOpen(true)}
      onHide={mode === "host" ? () => setControlsVisible(false) : undefined}
      maxParticipants={maxParticipants}
      preflight={{ overall: preflight.overall, running: preflight.state.kind === "running", onOpen: () => setPreflightOpen(true) }}
      preview={rehearsal ? { active: preview.active, busy: preview.state.kind === "opening", onToggle: preview.toggle } : undefined}
      // The presenter view has the same list inline.
      words={mode === "host" && wordCloudOpen ? { count: meta.wordCloud?.words.length ?? 0, onOpen: () => setWordsOpen(true) } : undefined}
      // The presenter view has the same panel inline.
      waiting={mode === "host" && meta.waitingRoom ? { count: waitingTotal(meta.waitingRoom), onOpen: () => setWaitingOpen(true) } : undefined}
    />
  );

  const reportHref = session ? `/quizzes/${encodeURIComponent(session.quiz_id)}/results/${encodeURIComponent(sessionId)}` : null;

  return (
    <div className="relative">
      {mode === "presenter" ? (
        <PresenterView controls={controls} />
      ) : (
        <>
          <Stage
            view={stageView}
            clock={live.clock}
            calm={calm}
            reportHref={reportHref}
            libraryHref="/quizzes"
            bottomInset={controlsVisible ? barHeight : 0}
            className={preview.state.kind !== "closed" ? "lg:pr-[25.5rem]" : undefined}
          />
          <div ref={barRef} data-lq-theme={stageView.themeKey} className="fixed inset-x-0 bottom-0 z-40">
            <AnimatePresence initial={false}>
              {controlsVisible ? (
                <m.div key="bar" initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", visualDuration: 0.3, bounce: 0.1 }}>
                  {controls}
                </m.div>
              ) : (
                <m.div key="show" className="flex justify-end p-3" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}>
                  <LqButton variant="secondary" onClick={() => setControlsVisible(true)} aria-keyshortcuts="H">
                    {t("quizPresent.controls.show")}
                  </LqButton>
                </m.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {closedReason && !authProblem ? (
        <div data-lq-theme={stageView.themeKey} role="alert" className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-lq-danger px-4 py-2 text-sm font-bold text-lq-on-danger">
          {closedReason === "session_ended" ? t("quizPresent.errors.session_ended") : t("quizPresent.errors.generic")}
          {closedReason !== "session_ended" ? (
            <button type="button" onClick={live.reconnect} className="focus-ring rounded-md underline underline-offset-2">
              {t("quizPresent.errors.retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* The live region exists before any toast, so screen readers announce each one. */}
      <div aria-live="polite" aria-atomic="true">
        <AnimatePresence>
          {toast ? (
            <m.div
              key={toast}
              data-lq-theme={stageView.themeKey}
              role="status"
              className="fixed top-4 left-1/2 z-50 flex max-w-[min(90vw,36rem)] -translate-x-1/2 items-center gap-3 rounded-[var(--lq-radius)] border border-lq-line bg-lq-surface-2 px-4 py-3 text-sm font-semibold text-lq-fg shadow-[0_20px_50px_-20px_rgb(0_0_0/0.7)]"
              initial={{ y: -40 }}
              animate={{ y: 0 }}
              exit={{ y: -40, opacity: 0 }}
            >
              <span>{toast}</span>
              <button type="button" onClick={dismissToast} className="focus-ring rounded-md px-2 text-lq-fg-muted hover:text-lq-fg" aria-label={t("quizPresent.errors.dismiss")}>
                ✕
              </button>
            </m.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div data-lq-theme={stageView.themeKey}>
        <PhonePreviewPanel state={preview.state} onClose={preview.close} bottomInset={mode === "presenter" ? PRESENTER_BAR_ALLOWANCE : controlsVisible ? barHeight : 0} code={meta.joinCode} />
      </div>
      <PreflightDialog open={preflightOpen} onClose={() => setPreflightOpen(false)} preflight={preflight} />

      <HotkeysHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <WaitingRoomDialog
        open={waitingOpen && mode === "host"}
        onClose={() => setWaitingOpen(false)}
        room={meta.waitingRoom}
        participantCount={meta.participantCount}
        actions={waitingActions}
        disabled={meta.connection.status !== "open"}
      />
      <WordModerationDialog
        open={wordsOpen && wordCloudOpen}
        onClose={() => setWordsOpen(false)}
        cloud={meta.wordCloud}
        hidden={meta.hiddenWords ?? []}
        onToggle={sendHideWord}
        disabled={meta.connection.status !== "open"}
      />
      <ParticipantsPanel
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        participants={meta.participants ?? []}
        canSetTime={meta.connection.status === "open"}
        onSetTime={(participantId, multiplier) => {
          live.send(setTimeCommand(participantId, multiplier), { queueWhileOffline: false });
        }}
        onKick={(participantId, ban) => {
          live.send({ type: "host.kick", data: { participant_id: participantId, ban } }, { queueWhileOffline: false });
          live.store.dispatch({ type: "local.kick", participantId });
        }}
      />
    </div>
  );
}
