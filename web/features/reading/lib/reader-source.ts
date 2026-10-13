/**
 * Where the reader gets its audio: the API (online) or the offline store (Cache Storage).
 * The reader UI is the same; online-only features (shadowing, drill, glossary, comprehension,
 * progress) are switched off for the offline source.
 */

import type { QueryClient } from "@tanstack/react-query";

import { fetchTts, fetchTtsAudio, postWarm, prefetchSection, prefetchTts, type TtsParams } from "@/features/reading/hooks";
import { OfflineMissError, offlineKeys, type OfflineStore } from "@/features/reading/lib/offline-store";
import { fetchTtsStream, hasCachedStream, type StreamHandlers, type StreamResult } from "@/features/reading/lib/tts-stream";
import { ApiError } from "@/lib/api/client";
import type { ReadingSectionDetail, ReadingTtsResponse, ReadingWarmRequest } from "@/types/api";

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
  /**
   * Increment 3: the block one sentence at a time (`GET …/tts/stream`), each segment delivered
   * with its audio as soon as it exists. Absent offline (the block audio is used instead).
   */
  loadStream?(params: TtsParams, handlers: StreamHandlers): Promise<StreamResult>;
  /** True when a completed stream of the block is already in memory. */
  hasStream?(params: TtsParams): boolean;
  /** `POST …/warm` (best effort; absent offline). */
  warm?(sectionId: string, body: ReadingWarmRequest, signal?: AbortSignal): Promise<void>;
  /** `GET /sections/{id}` into the query cache (absent offline). */
  loadSection?(sectionId: string): Promise<ReadingSectionDetail>;
}

export function createOnlineSource(client: QueryClient): ReaderSource {
  return {
    kind: "online",
    loadTts: (params, options) => fetchTts(client, params, options),
    loadAudio: (tts) => fetchTtsAudio(tts.audio_url),
    prefetch: (params) => {
      void prefetchTts(client, params);
    },
    isStaleAudioError: (error) => error instanceof ApiError && error.status === 404,
    loadStream: (params, handlers) => fetchTtsStream(client, params, handlers),
    hasStream: (params) => hasCachedStream(client, params),
    warm: async (sectionId, body, signal) => {
      await postWarm(sectionId, body, signal);
    },
    loadSection: (sectionId) => prefetchSection(client, sectionId)
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
