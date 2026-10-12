"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { findWordIndexAtTime, type WordTiming } from "@/features/reading/lib/tokenize";

export type AudioPlayerStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

export interface AudioPlayerState {
  status: AudioPlayerStatus;
  /** Index into the timings passed to `load`; -1 before the first word. */
  currentWordIndex: number;
  currentTime: number;
  duration: number;
}

export interface UseAudioPlayerOptions {
  playbackRate: number;
  /** Fired when the loaded source plays to its end (not after `playRange`). */
  onEnded?: () => void;
  onError?: (error: unknown) => void;
}

const INITIAL_STATE: AudioPlayerState = { status: "idle", currentWordIndex: -1, currentTime: 0, duration: 0 };

/**
 * One HTMLAudioElement for the whole reader. A requestAnimationFrame loop derives the current word
 * from `currentTime` (binary search over word starts) while playing. Listening time is accumulated
 * in wall-clock seconds and drained by the progress reporter.
 */
export function useAudioPlayer({ playbackRate, onEnded, onError }: UseAudioPlayerOptions) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timingsRef = useRef<WordTiming[]>([]);
  const rangeEndRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const listenedRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [state, setState] = useState<AudioPlayerState>(INITIAL_STATE);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  });

  const getAudio = useCallback((): HTMLAudioElement | null => {
    if (typeof window === "undefined" || typeof Audio === "undefined") {
      return null;
    }
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    return audioRef.current;
  }, []);

  const stopLoop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    lastTickRef.current = null;
  }, []);

  const syncWord = useCallback((audio: HTMLAudioElement) => {
    const time = audio.currentTime;
    const index = findWordIndexAtTime(timingsRef.current, time + 0.02);
    setState((previous) => {
      const rounded = Math.round(time * 4) / 4;
      if (previous.currentWordIndex === index && previous.currentTime === rounded) {
        return previous;
      }
      return { ...previous, currentWordIndex: index, currentTime: rounded };
    });
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    const tick = (now: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      if (lastTickRef.current !== null && !audio.paused) {
        listenedRef.current += Math.max(0, (now - lastTickRef.current) / 1000);
      }
      lastTickRef.current = now;
      const rangeEnd = rangeEndRef.current;
      if (rangeEnd !== null && audio.currentTime >= rangeEnd) {
        rangeEndRef.current = null;
        audio.pause();
        return;
      }
      syncWord(audio);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [stopLoop, syncWord]);

  // Element event listeners (attached once).
  useEffect(() => {
    const audio = getAudio();
    if (!audio) {
      return;
    }
    const handlePlay = () => {
      setState((previous) => ({ ...previous, status: "playing" }));
      startLoop();
    };
    const handlePause = () => {
      stopLoop();
      syncWord(audio);
      setState((previous) => (previous.status === "ended" ? previous : { ...previous, status: audio.ended ? "ended" : "paused" }));
    };
    const handleEnded = () => {
      stopLoop();
      const wasRange = rangeEndRef.current !== null;
      rangeEndRef.current = null;
      setState((previous) => ({ ...previous, status: "ended", currentWordIndex: timingsRef.current.length - 1 }));
      if (!wasRange) {
        onEndedRef.current?.();
      }
    };
    const handleDuration = () => {
      setState((previous) => ({ ...previous, duration: Number.isFinite(audio.duration) ? audio.duration : previous.duration }));
    };
    const handleCanPlay = () => {
      setState((previous) => (previous.status === "loading" ? { ...previous, status: "ready" } : previous));
    };
    const handleError = () => {
      stopLoop();
      setState((previous) => ({ ...previous, status: "error" }));
      onErrorRef.current?.(audio.error);
    };
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("durationchange", handleDuration);
    audio.addEventListener("loadedmetadata", handleDuration);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);
    return () => {
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("durationchange", handleDuration);
      audio.removeEventListener("loadedmetadata", handleDuration);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
    };
  }, [getAudio, startLoop, stopLoop, syncWord]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Release the element on unmount.
  useEffect(() => {
    return () => {
      stopLoop();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      audioRef.current = null;
    };
  }, [stopLoop]);

  const play = useCallback(async () => {
    const audio = getAudio();
    if (!audio || !audio.src) {
      return;
    }
    rangeEndRef.current = null;
    if (audio.ended) {
      audio.currentTime = 0;
    }
    try {
      await audio.play();
    } catch (error) {
      // Autoplay policies reject play() without a gesture; surface it as paused, not broken.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setState((previous) => ({ ...previous, status: "paused" }));
        return;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setState((previous) => ({ ...previous, status: "error" }));
      onErrorRef.current?.(error);
    }
  }, [getAudio]);

  /** Loads a new source (blob URL) with the word timings of that audio. */
  const load = useCallback(
    async (src: string, timings: WordTiming[], options: { autoplay?: boolean } = {}) => {
      const audio = getAudio();
      if (!audio) {
        return;
      }
      stopLoop();
      rangeEndRef.current = null;
      timingsRef.current = timings;
      audio.pause();
      audio.playbackRate = playbackRate;
      audio.src = src;
      setState({ status: "loading", currentWordIndex: -1, currentTime: 0, duration: 0 });
      audio.load();
      if (options.autoplay) {
        await play();
      }
    },
    [getAudio, play, playbackRate, stopLoop]
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) {
      return;
    }
    if (audio.paused) {
      void play();
    } else {
      audio.pause();
    }
  }, [play]);

  const seek = useCallback(
    (seconds: number, options: { play?: boolean } = {}) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) {
        return;
      }
      rangeEndRef.current = null;
      audio.currentTime = Math.max(0, seconds);
      syncWord(audio);
      setState((previous) => (previous.status === "ended" ? { ...previous, status: "paused" } : previous));
      if (options.play || !audio.paused) {
        void play();
      }
    },
    [play, syncWord]
  );

  /** Plays only `[start, end]` of the loaded source (e.g. one word of the model audio). */
  const playRange = useCallback(
    (start: number, end: number) => {
      const audio = audioRef.current;
      if (!audio || !audio.src) {
        return;
      }
      audio.currentTime = Math.max(0, start);
      rangeEndRef.current = Math.max(start + 0.05, end);
      syncWord(audio);
      void audio.play().catch(() => {
        rangeEndRef.current = null;
      });
    },
    [syncWord]
  );

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    rangeEndRef.current = null;
    audio.pause();
    audio.currentTime = 0;
    setState((previous) => ({ ...previous, status: audio.src ? "paused" : "idle", currentWordIndex: -1, currentTime: 0 }));
  }, []);

  /** Returns and resets the wall-clock seconds spent playing since the previous call. */
  const drainListenedSeconds = useCallback(() => {
    const seconds = listenedRef.current;
    listenedRef.current = 0;
    return seconds;
  }, []);

  const hasSource = useCallback(() => Boolean(audioRef.current?.src), []);

  return useMemo(
    () => ({ state, load, play, pause, toggle, seek, playRange, stop, drainListenedSeconds, hasSource }),
    [state, load, play, pause, toggle, seek, playRange, stop, drainListenedSeconds, hasSource]
  );
}

export type AudioPlayer = ReturnType<typeof useAudioPlayer>;
