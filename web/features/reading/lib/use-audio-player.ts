"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createSegmentFeed, INITIAL_SEGMENT_PLAYER_STATE, SegmentPlayer, type SegmentFeed, type SegmentPlayerState, type SegmentPlayerStatus } from "@/features/reading/lib/segment-player";
import type { WordTiming } from "@/features/reading/lib/tokenize";

export type AudioPlayerStatus = SegmentPlayerStatus;

export type AudioPlayerState = SegmentPlayerState;

export interface UseAudioPlayerOptions {
  playbackRate: number;
  /** Fired when the loaded track plays to its end (not after `playRange`). */
  onEnded?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * The reader's player: a `SegmentPlayer` (two alternating HTMLAudioElements, one timeline) shared
 * by the single-file path (offline, fallback: one complete segment) and the streamed path (a feed
 * of sentence segments). The state is mirrored into React; listening time is accumulated in
 * wall-clock seconds and drained by the progress reporter.
 */
export function useAudioPlayer({ playbackRate, onEnded, onError }: UseAudioPlayerOptions) {
  const playerRef = useRef<SegmentPlayer | null>(null);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  const [state, setState] = useState<AudioPlayerState>(INITIAL_SEGMENT_PLAYER_STATE);

  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  });

  const getPlayer = useCallback((): SegmentPlayer | null => {
    if (typeof window === "undefined") {
      return null;
    }
    if (!playerRef.current) {
      playerRef.current = new SegmentPlayer({
        onState: (next) => setState(next),
        onEnded: () => onEndedRef.current?.(),
        onError: (error) => onErrorRef.current?.(error)
      });
      playerRef.current.setPlaybackRate(playbackRate);
    }
    return playerRef.current;
  }, [playbackRate]);

  useEffect(() => {
    playerRef.current?.setPlaybackRate(playbackRate);
  }, [playbackRate]);

  // Release the elements on unmount.
  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, []);

  /** Loads a single file (blob URL) with the word timings of that audio. */
  const load = useCallback(
    async (src: string, timings: WordTiming[], options: { autoplay?: boolean } = {}) => {
      getPlayer()?.load(createSegmentFeed([{ url: src, duration: 0, offset: 0 }], true), timings, options);
    },
    [getPlayer]
  );

  /** Loads a (possibly still growing) list of segments as one track. */
  const loadSegments = useCallback(
    (feed: SegmentFeed, timings: WordTiming[], options: { autoplay?: boolean } = {}) => {
      getPlayer()?.load(feed, timings, options);
    },
    [getPlayer]
  );

  /** Word timings on the block timeline (they grow as streamed segments arrive). */
  const setTimings = useCallback((timings: WordTiming[]) => playerRef.current?.setTimings(timings), []);
  const play = useCallback(async () => playerRef.current?.play(), []);
  const pause = useCallback(() => playerRef.current?.pause(), []);
  const toggle = useCallback(() => playerRef.current?.toggle(), []);
  const seek = useCallback((seconds: number, options: { play?: boolean } = {}) => playerRef.current?.seek(seconds, options), []);
  /** Plays only `[start, end]` of the timeline; resolves when the range ends or is interrupted. */
  const playRange = useCallback((start: number, end: number): Promise<void> => playerRef.current?.playRange(start, end) ?? Promise.resolve(), []);
  const stop = useCallback(() => playerRef.current?.stop(), []);
  /** Returns and resets the wall-clock seconds spent playing since the previous call. */
  const drainListenedSeconds = useCallback(() => playerRef.current?.drainListenedSeconds() ?? 0, []);
  const hasSource = useCallback(() => playerRef.current?.hasSource() ?? false, []);
  /** Volume 0–1 (the sleep timer fades with it). */
  const setVolume = useCallback((volume: number) => playerRef.current?.setVolume(volume), []);
  /** Precise position and duration of the loaded track (state rounds the time). */
  const getTimes = useCallback(() => playerRef.current?.getTimes() ?? { currentTime: 0, duration: 0, playbackRate: 1 }, []);

  return useMemo(
    () => ({ state, load, loadSegments, setTimings, play, pause, toggle, seek, playRange, stop, drainListenedSeconds, hasSource, setVolume, getTimes }),
    [state, load, loadSegments, setTimings, play, pause, toggle, seek, playRange, stop, drainListenedSeconds, hasSource, setVolume, getTimes]
  );
}

export type AudioPlayer = ReturnType<typeof useAudioPlayer>;
