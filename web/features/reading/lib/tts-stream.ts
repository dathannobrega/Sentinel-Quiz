/**
 * `GET /api/reading/sections/{id}/tts/stream`: the block is synthesised one sentence at a time and
 * each sentence is delivered as soon as it exists (NDJSON). This module reads the stream, downloads
 * the audio of every segment (two at a time) and hands the segments over in order. Completed
 * streams are kept in the react-query cache (blobs included) so revisiting a block, or opening the
 * next section after it was prefetched, does not touch the network again.
 */

import type { QueryClient } from "@tanstack/react-query";

import { fetchTtsAudio, READING_TIMEOUTS, type TtsParams } from "@/features/reading/hooks";
import { readStreamLines } from "@/features/reading/lib/ndjson";
import { apiClient, ApiError } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import type { ReadingStreamMeta, ReadingStreamSegment } from "@/types/api";

/** Simultaneous audio downloads per stream. */
export const STREAM_DOWNLOAD_CONCURRENCY = 2;

export interface StreamHandlers {
  signal?: AbortSignal;
  /** The first line: block text and synthesis settings. */
  onMeta?: (meta: ReadingStreamMeta) => void;
  /** Called once per segment, in order, with its audio. */
  onSegment: (segment: ReadingStreamSegment, blob: Blob) => void;
}

export interface StreamedSegment {
  segment: ReadingStreamSegment;
  blob: Blob;
}

export interface StreamResult {
  meta: ReadingStreamMeta;
  segments: StreamedSegment[];
  durationSeconds: number;
}

/** The network functions, injectable for tests. */
export interface StreamDeps {
  stream: (path: string, options: { signal?: AbortSignal; timeoutMs?: number }) => Promise<Response>;
  download: (audioUrl: string, signal?: AbortSignal) => Promise<Blob>;
}

const defaultDeps: StreamDeps = {
  stream: (path, options) => apiClient.stream(path, options),
  download: (audioUrl, signal) => fetchTtsAudio(audioUrl, signal)
};

/** Streamed-TTS support, remembered for the page session after a 404/405 from an older server. */
let streamUnsupported = false;

export function isStreamUnsupported(): boolean {
  return streamUnsupported;
}

export function markStreamUnsupported(): void {
  streamUnsupported = true;
}

/** Test helper. */
export function resetStreamSupport(): void {
  streamUnsupported = false;
}

/** True for the "old server" answers on the stream route: 405, or a 404 that is not `block_not_found`. */
export function isStreamUnsupportedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  return error.status === 405 || (error.status === 404 && error.code !== "block_not_found");
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function streamPath(params: TtsParams): string {
  const query = new URLSearchParams({
    part_id: params.partId,
    block_index: String(params.blockIndex),
    speed: String(params.speed)
  });
  if (params.voice) {
    query.set("voice", params.voice);
  }
  return `/reading/sections/${encodeURIComponent(params.sectionId)}/tts/stream?${query.toString()}`;
}

function abortError(): DOMException {
  return new DOMException("stream aborted", "AbortError");
}

/**
 * Reads one block stream. Resolves on the `done` line once every segment was delivered; rejects
 * on HTTP errors (ApiError), on an `error` line (ApiError with the line's code), on a download
 * failure and on abort (AbortError).
 */
export async function streamTts(params: TtsParams, handlers: StreamHandlers, deps: StreamDeps = defaultDeps): Promise<StreamResult> {
  const controller = new AbortController();
  const external = handlers.signal;
  const onExternalAbort = () => controller.abort();
  if (external?.aborted) {
    throw abortError();
  }
  external?.addEventListener("abort", onExternalAbort, { once: true });

  const response = await deps
    .stream(streamPath(params), {
      signal: controller.signal,
      timeoutMs: READING_TIMEOUTS.tts
    })
    .finally(() => {
      if (controller.signal.aborted) {
        external?.removeEventListener("abort", onExternalAbort);
      }
    });
  if (controller.signal.aborted) {
    throw abortError();
  }
  if (!response.body) {
    external?.removeEventListener("abort", onExternalAbort);
    throw new ApiError({
      code: "invalid_stream",
      message: "Empty stream body.",
      status: response.status
    });
  }

  let meta: ReadingStreamMeta | null = null;
  const received: ReadingStreamSegment[] = [];
  const delivered: StreamedSegment[] = [];
  const blobs = new Map<number, Blob>();
  const queue: number[] = [];
  let active = 0;
  let nextToDeliver = 0;
  let failure: unknown = null;
  let wake: () => void = () => {};

  const deliverReady = () => {
    while (blobs.has(nextToDeliver)) {
      const blob = blobs.get(nextToDeliver) as Blob;
      blobs.delete(nextToDeliver);
      const segment = received[nextToDeliver];
      nextToDeliver += 1;
      delivered.push({ segment, blob });
      handlers.onSegment(segment, blob);
    }
    wake();
  };

  const pump = () => {
    while (active < STREAM_DOWNLOAD_CONCURRENCY && queue.length && failure === null && !controller.signal.aborted) {
      const position = queue.shift() as number;
      active += 1;
      deps
        .download(received[position].audio_url, controller.signal)
        .then((blob) => {
          active -= 1;
          blobs.set(position, blob);
          deliverReady();
          pump();
        })
        .catch((error: unknown) => {
          active -= 1;
          failure ??= error;
          wake();
        });
    }
  };

  const waitForChange = () =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = () => {};
        resolve();
      };
    });
  controller.signal.addEventListener("abort", () => wake(), { once: true });

  try {
    for await (const line of readStreamLines(response.body, controller.signal)) {
      if (failure !== null) {
        break;
      }
      if (line.type === "meta") {
        meta = line;
        handlers.onMeta?.(line);
      } else if (line.type === "segment") {
        received.push(line);
        queue.push(received.length - 1);
        pump();
      } else if (line.type === "error") {
        throw new ApiError({
          code: line.code || "tts_failed",
          message: line.message || "Speech synthesis failed.",
          status: 502
        });
      } else {
        // `done`: wait for the downloads still in flight, then finish.
        while (nextToDeliver < received.length && failure === null && !controller.signal.aborted) {
          await waitForChange();
        }
        if (controller.signal.aborted) {
          throw abortError();
        }
        if (failure !== null) {
          throw failure;
        }
        if (!meta) {
          throw new ApiError({
            code: "invalid_stream",
            message: "Stream without meta line.",
            status: 502
          });
        }
        return {
          meta,
          segments: delivered,
          durationSeconds: line.duration_seconds
        };
      }
    }
    if (controller.signal.aborted) {
      throw abortError();
    }
    if (failure !== null) {
      throw failure;
    }
    throw new ApiError({
      code: "stream_incomplete",
      message: "The stream ended before the done line.",
      status: 502
    });
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    external?.removeEventListener("abort", onExternalAbort);
  }
}

function streamKey(params: TtsParams) {
  return queryKeys.readingTtsStream(params.sectionId, params.partId, params.blockIndex, params.voice ?? "", params.speed);
}

/**
 * Stream through the react-query cache: a completed stream is replayed from memory (every
 * segment delivered synchronously), otherwise the network stream runs and its result is stored.
 */
export async function fetchTtsStream(client: QueryClient, params: TtsParams, handlers: StreamHandlers, deps?: StreamDeps): Promise<StreamResult> {
  const key = streamKey(params);
  const cached = client.getQueryData<StreamResult>(key);
  if (cached) {
    handlers.onMeta?.(cached.meta);
    for (const item of cached.segments) {
      handlers.onSegment(item.segment, item.blob);
    }
    return cached;
  }
  const result = await streamTts(params, handlers, deps);
  client.setQueryData(key, result);
  return result;
}

/** True when a completed stream of this block is already in memory. */
export function hasCachedStream(client: QueryClient, params: TtsParams): boolean {
  return client.getQueryData<StreamResult>(streamKey(params)) !== undefined;
}
