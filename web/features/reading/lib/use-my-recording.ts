"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useReadingCapabilitiesQuery } from "@/features/reading/hooks";
import { createClipPlayer, type ClipPlayer } from "@/features/reading/lib/clip-player";
import type { ReadingAssessedWord, ReadingPhonemesReason } from "@/types/api";

/**
 * Keeps the learner's last recording in memory (never uploaded twice, never persisted) and plays
 * a word of it back, so they can compare their own sound with the model's.
 */
export function useMyRecording() {
  const [recording, setRecording] = useState<Blob | null>(null);
  const playerRef = useRef<ClipPlayer | null>(null);
  useEffect(() => () => playerRef.current?.dispose(), []);

  const playWord = useCallback(
    (word: ReadingAssessedWord) => {
      if (!recording || word.start === null || word.start === undefined || word.end === null || word.end === undefined) {
        return;
      }
      playerRef.current ??= createClipPlayer();
      void playerRef.current.play(recording, word.start, word.end);
    },
    [recording]
  );
  const playRange = useCallback(
    (start: number, end: number) => {
      if (!recording) {
        return;
      }
      playerRef.current ??= createClipPlayer();
      void playerRef.current.play(recording, start, end);
    },
    [recording]
  );
  const stop = useCallback(() => playerRef.current?.stop(), []);
  return { recording, setRecording, playWord, playRange, stop };
}

/** Why phoneme scoring is off right now (for the notice under a result); null when it is on. */
export function usePhonemesOffReason(): ReadingPhonemesReason | null {
  const capabilities = useReadingCapabilitiesQuery();
  const phonemes = capabilities.data?.phonemes;
  if (!phonemes || phonemes.available) {
    return null;
  }
  return phonemes.reason ?? "speech_unavailable";
}
