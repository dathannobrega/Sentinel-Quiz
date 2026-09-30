"use client";

/**
 * React bindings for the live client: one socket + store + clock per screen, selectors for
 * rendering, and rAF-based countdown hooks that do not re-render the tree on every frame.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { buildApiUrl } from "@/lib/api/client";
import { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import { computeCountdown, elapsedSinceOpen, type CountdownValue } from "@/features/quiz-live/lib/countdown";
import { LiveSocket, toWebSocketUrl, type LiveCredentials } from "@/features/quiz-live/lib/live-socket";
import { createInitialLiveState, LiveStore, useLiveSelector, type LiveAnswerDraft, type LiveState } from "@/features/quiz-live/lib/live-store";
import { LIVE_WS_PATH, type ClientMessage, type LiveRole, type LiveTimer } from "@/features/quiz-live/lib/protocol";

export interface LiveConnection {
  role: LiveRole;
  store: LiveStore;
  clock: ClockSync;
  /** Sends a command; returns its `mid` (null when there is no socket). */
  send: (message: ClientMessage, options?: { queueWhileOffline?: boolean }) => string | null;
  /** Sends an answer through the outbox and marks it as pending locally. */
  submitAnswer: (qi: number, answer: LiveAnswerDraft) => string | null;
  /** Forces a fresh connection attempt (e.g. "Tentar de novo" after a terminal close). */
  reconnect: () => void;
}

export function liveSocketUrl(): string {
  return toWebSocketUrl(buildApiUrl(LIVE_WS_PATH));
}

function credentialsKey(credentials: LiveCredentials | null): string | null {
  if (!credentials) {
    return null;
  }
  return credentials.kind === "host" ? `host:${credentials.sessionId}` : `${credentials.kind}:${credentials.token}`;
}

/**
 * Opens the live WebSocket for `credentials` (null = do not connect yet) and keeps it alive until
 * unmount. The store survives credential changes; a new socket replaces the old one.
 */
export function useLiveConnection(role: LiveRole, credentials: LiveCredentials | null): LiveConnection {
  const [store] = useState(() => new LiveStore(createInitialLiveState(role)));
  const [clock] = useState(() => new ClockSync());
  const socketRef = useRef<LiveSocket | null>(null);
  const [generation, setGeneration] = useState(0);
  const key = credentialsKey(credentials);
  const credentialsRef = useRef(credentials);

  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  useEffect(() => {
    const current = credentialsRef.current;
    if (!key || !current) {
      return undefined;
    }
    const socket = new LiveSocket({ url: liveSocketUrl, credentials: current, clock });
    socketRef.current = socket;
    const offMessage = socket.onMessage((message) => store.dispatch({ type: "server", message }));
    const offStatus = socket.onStatus((event) =>
      store.dispatch({
        type: "connection",
        status: event.status,
        attempt: event.attempt,
        reason: event.reason ?? null,
        closeCode: event.closeCode ?? null,
        retryInMs: event.retryInMs ?? null
      })
    );
    socket.connect();
    return () => {
      offMessage();
      offStatus();
      socket.close();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [key, clock, store, generation]);

  return useMemo<LiveConnection>(
    () => ({
      role,
      store,
      clock,
      send: (message, options) => socketRef.current?.send(message, options) ?? null,
      submitAnswer: (qi, answer) => {
        const socket = socketRef.current;
        if (!socket) {
          return null;
        }
        const timer = store.getState().timer;
        const answerId = socket.submitAnswer({ qi, ...answer, client_elapsed_ms: elapsedSinceOpen(timer, clock.serverNow()) });
        store.dispatch({ type: "local.submit", qi, answerId, answer });
        return answerId;
      },
      reconnect: () => setGeneration((value) => value + 1)
    }),
    [role, store, clock]
  );
}

// ----------------------------------------------------------------------------- context

const LiveContext = createContext<LiveConnection | null>(null);
export const LiveProvider = LiveContext.Provider;

export function useLive(): LiveConnection {
  const connection = useContext(LiveContext);
  if (!connection) {
    throw new Error("useLive must be used inside <LiveProvider>");
  }
  return connection;
}

/** Selector over the live store of the nearest <LiveProvider>. */
export function useLiveState<T>(selector: (state: LiveState) => T, isEqual?: (a: T, b: T) => boolean): T {
  const { store } = useLive();
  return useLiveSelector(store, selector, isEqual);
}

// ----------------------------------------------------------------------------- countdown

type FrameListener = (value: CountdownValue) => void;

/**
 * Single rAF loop per timer that notifies subscribers each frame. React state only changes when
 * the visible second, stage or warning flag changes (≤ 1 render per second).
 */
export function useCountdown(
  timer: LiveTimer | null | undefined,
  clock: ClockSync,
  onFrame?: FrameListener,
  /** "stage": re-render only when reading → open → expired changes (not every second). */
  precision: "seconds" | "stage" = "seconds"
): CountdownValue {
  const openAt = timer?.answers_open_at_ms ?? null;
  const deadline = timer?.deadline_ms ?? null;
  const frameRef = useRef(onFrame);
  useEffect(() => {
    frameRef.current = onFrame;
  }, [onFrame]);

  const subscribe = useMemo(() => {
    return (notify: () => void) => {
      if (openAt === null) {
        return () => undefined;
      }
      const stableTimer = { answers_open_at_ms: openAt, deadline_ms: deadline };
      let raf = 0;
      let lastKey = "";
      const hasRaf = typeof requestAnimationFrame === "function";
      const loop = () => {
        const value = computeCountdown(stableTimer, clock.serverNow());
        frameRef.current?.(value);
        const next = precision === "stage" ? value.stage : `${value.stage}:${value.seconds}:${value.warning}`;
        if (next !== lastKey) {
          lastKey = next;
          notify();
        }
        if (value.stage === "reading" || value.stage === "open") {
          raf = hasRaf ? requestAnimationFrame(loop) : (setTimeout(loop, 100) as unknown as number);
        }
      };
      loop();
      return () => {
        if (hasRaf) {
          cancelAnimationFrame(raf);
        } else {
          clearTimeout(raf);
        }
      };
    };
  }, [openAt, deadline, clock, precision]);

  const cacheRef = useRef<{ key: string; value: CountdownValue } | null>(null);
  const getSnapshot = () => {
    const value = computeCountdown(openAt === null ? null : { answers_open_at_ms: openAt, deadline_ms: deadline }, clock.serverNow());
    const nextKey = precision === "stage" ? `${openAt}:${deadline}:${value.stage}` : `${openAt}:${deadline}:${value.stage}:${value.seconds}:${value.warning}`;
    const cached = cacheRef.current;
    if (cached && cached.key === nextKey) {
      return cached.value;
    }
    cacheRef.current = { key: nextKey, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
