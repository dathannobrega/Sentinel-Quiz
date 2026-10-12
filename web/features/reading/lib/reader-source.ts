/**
 * Where the reader gets its audio: the API (online) or the offline store (Cache Storage).
 * The reader UI is the same; online-only features (shadowing, drill, glossary, comprehension,
 * progress) are switched off for the offline source.
 */

import type { QueryClient } from "@tanstack/react-query";

import { fetchTts, fetchTtsAudio, prefetchTts, type TtsParams } from "@/features/reading/hooks";
import { OfflineMissError, offlineKeys, type OfflineStore } from "@/features/reading/lib/offline-store";
import { ApiError } from "@/lib/api/client";
import type { ReadingTtsResponse } from "@/types/api";

export interface ReaderSource {
  kind: "online" | "offline";
  /** TTS response (text + word timings) of a block. */
  loadTts(params: TtsParams, options?: { force?: boolean }): Promise<ReadingTtsResponse>;
  /** Audio bytes of a TTS response. */
  loadAudio(tts: ReadingTtsResponse): Promise<Blob>;
  /** Warms the next block (no-op offline). */
  prefetch(params: TtsParams): void;
  /** True when a failed audio fetch is worth re-synthesising (server cache expired). */
  isStaleAudioError(error: unknown): boolean;
}

export function createOnlineSource(client: QueryClient): ReaderSource {
  return {
    kind: "online",
    loadTts: (params, options) => fetchTts(client, params, options),
    loadAudio: (tts) => fetchTtsAudio(tts.audio_url),
    prefetch: (params) => {
      void prefetchTts(client, params);
    },
    isStaleAudioError: (error) => error instanceof ApiError && error.status === 404
  };
}

/** Reads only from Cache Storage: never touches the network. */
export function createOfflineSource(store: OfflineStore): ReaderSource {
  return {
    kind: "offline",
    async loadTts(params) {
      const tts = await store.getTts(params.sectionId, params.partId, params.blockIndex);
      if (!tts) {
        throw new OfflineMissError(offlineKeys.tts(params.sectionId, params.partId, params.blockIndex));
      }
      return tts;
    },
    async loadAudio(tts) {
      const blob = await store.getAudio(tts.audio_id);
      if (!blob) {
        throw new OfflineMissError(offlineKeys.audio(tts.audio_id));
      }
      return blob;
    },
    prefetch: () => {},
    isStaleAudioError: () => false
  };
}
