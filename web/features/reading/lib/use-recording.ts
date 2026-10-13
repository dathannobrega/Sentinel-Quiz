"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isTypingTarget } from "@/features/reading/lib/keyboard";
import { MAX_RECORDING_SECONDS, RecorderError, startRecording, type ActiveRecording, type RecorderErrorCode } from "@/features/reading/lib/recorder";

/** Recordings shorter than this are rejected before upload. */
export const MIN_RECORDING_SECONDS = 0.8;

export type RecordingErrorKind = RecorderErrorCode | "too_short";

export interface UseRecordingOptions {
  maxSeconds?: number;
  /** Called before the microphone opens (pause model playback). */
  onBeforeRecord?: () => void;
  /** A usable recording is ready. */
  onCaptured: (blob: Blob, filename: string, hitLimit: boolean) => void;
  /** Bind the `R` key (toggle) while mounted and enabled. */
  shortcut?: boolean;
  enabled?: boolean;
  /** Stop by itself after silence (listen and repeat). */
  stopOnSilence?: boolean;
}

/** Microphone capture shared by shadowing, the sentence drill and the word review. */
export function useRecording({ maxSeconds = MAX_RECORDING_SECONDS, onBeforeRecord, onCaptured, shortcut = false, enabled = true, stopOnSilence = false }: UseRecordingOptions) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [hitLimit, setHitLimit] = useState(false);
  const [error, setError] = useState<RecordingErrorKind | null>(null);
  const activeRef = useRef<ActiveRecording | null>(null);
  const callbacksRef = useRef({ onBeforeRecord, onCaptured });
  useEffect(() => {
    callbacksRef.current = { onBeforeRecord, onCaptured };
  });

  const cancel = useCallback(() => {
    activeRef.current?.cancel();
    activeRef.current = null;
    setRecording(false);
  }, []);

  useEffect(() => () => {
    activeRef.current?.cancel();
    activeRef.current = null;
  }, []);

  /** Starts recording; `overrides.maxSeconds` replaces the hook's limit for this take (per-sentence caps). */
  const start = useCallback(
    async (overrides: { maxSeconds?: number } = {}) => {
      if (!enabled || activeRef.current) {
        return;
      }
      setError(null);
      setHitLimit(false);
      setElapsed(0);
      callbacksRef.current.onBeforeRecord?.();
      try {
        const active = await startRecording({ maxSeconds: overrides.maxSeconds ?? maxSeconds, stopOnSilence, onElapsed: (seconds) => setElapsed(seconds) });
        activeRef.current = active;
        setRecording(true);
        active.result
          .then((captured) => {
            activeRef.current = null;
            setRecording(false);
            setHitLimit(captured.hitLimit);
            if (captured.durationSeconds < MIN_RECORDING_SECONDS || captured.blob.size === 0) {
              setError("too_short");
              return;
            }
            callbacksRef.current.onCaptured(captured.blob, captured.filename, captured.hitLimit);
          })
          .catch((reason: unknown) => {
            activeRef.current = null;
            setRecording(false);
            if (reason instanceof RecorderError && reason.message === "cancelled") {
              return;
            }
            setError(reason instanceof RecorderError ? reason.code : "failed");
          });
      } catch (reason) {
        setRecording(false);
        setError(reason instanceof RecorderError ? reason.code : "failed");
      }
    },
    [enabled, maxSeconds, stopOnSilence]
  );

  const stop = useCallback(() => {
    activeRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      stop();
    } else {
      void start();
    }
  }, [start, stop]);

  useEffect(() => {
    if (!shortcut || !enabled) {
      return;
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, shortcut, toggle]);

  return { recording, elapsed, hitLimit, error, setError, start, stop, toggle, cancel };
}

/** Message (and optional title) for a recording error. */
export function describeRecordingError(kind: RecordingErrorKind, t: (key: string) => string): { title?: string; message: string } {
  switch (kind) {
    case "unsupported":
      return { title: t("reading.shadow.unsupportedTitle"), message: t("reading.shadow.unsupported") };
    case "permission_denied":
      return { title: t("reading.shadow.permissionDeniedTitle"), message: t("reading.shadow.permissionDenied") };
    case "no_device":
      return { message: t("reading.shadow.noDevice") };
    case "too_short":
      return { message: t("reading.shadow.tooShort") };
    default:
      return { message: t("reading.shadow.recordFailed") };
  }
}
