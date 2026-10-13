import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchTtsStream, isStreamUnsupportedError, streamPath, streamTts, type StreamDeps } from "@/features/reading/lib/tts-stream";
import { ApiError } from "@/lib/api/errors";
import type { ReadingStreamLine } from "@/types/api";

const PARAMS = {
  sectionId: "book:c01:s1",
  partId: "p1",
  blockIndex: 2,
  voice: "af_heart",
  speed: 1
};

function ndjson(lines: ReadingStreamLine[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

function segmentLine(index: number): ReadingStreamLine {
  return {
    type: "segment",
    index,
    audio_id: `a${index}`,
    audio_url: `/api/reading/audio/a${index}`,
    char_start: index * 10,
    char_end: index * 10 + 9,
    duration_seconds: 1,
    cached: false,
    words: []
  };
}

const META: ReadingStreamLine = {
  type: "meta",
  block_audio_id: "b",
  sentences: 3,
  engine: "fake",
  model: "fake",
  voice: "af_heart",
  speed: 1,
  lang: "en-us",
  content_type: "audio/wav",
  text: "x"
};

function responseOf(body: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson" }
  });
}

/** Downloads resolve only when the test releases them (to observe ordering and concurrency). */
function controlledDownloads() {
  const pending = new Map<string, (blob: Blob) => void>();
  const started: string[] = [];
  const download: StreamDeps["download"] = (url) =>
    new Promise<Blob>((resolve) => {
      started.push(url);
      pending.set(url, resolve);
    });
  const release = (url: string) => {
    const resolve = pending.get(url);
    pending.delete(url);
    resolve?.(new Blob([url]));
  };
  return { download, release, started };
}

describe("streamTts", () => {
  let deps: StreamDeps;
  let downloads: ReturnType<typeof controlledDownloads>;

  beforeEach(() => {
    downloads = controlledDownloads();
    deps = {
      stream: vi.fn(async () => responseOf(ndjson([META, segmentLine(0), segmentLine(1), segmentLine(2), { type: "done", duration_seconds: 3 }]))),
      download: downloads.download
    };
  });

  it("builds the stream path from the TTS params", () => {
    expect(streamPath(PARAMS)).toBe("/reading/sections/book%3Ac01%3As1/tts/stream?part_id=p1&block_index=2&speed=1&voice=af_heart");
    expect(streamPath({ ...PARAMS, voice: null })).not.toContain("voice=");
  });

  it("delivers the segments in order, two downloads at a time", async () => {
    const onMeta = vi.fn();
    const onSegment = vi.fn();
    const promise = streamTts(PARAMS, { onMeta, onSegment }, deps);
    await vi.waitFor(() => expect(downloads.started).toHaveLength(2));
    expect(onMeta).toHaveBeenCalledWith(expect.objectContaining({ type: "meta", text: "x" }));
    expect(downloads.started).toEqual(["/api/reading/audio/a0", "/api/reading/audio/a1"]);

    // The second finishes first: nothing is delivered until the first arrives.
    downloads.release("/api/reading/audio/a1");
    await vi.waitFor(() => expect(downloads.started).toHaveLength(3));
    expect(onSegment).not.toHaveBeenCalled();
    downloads.release("/api/reading/audio/a0");
    await vi.waitFor(() => expect(onSegment).toHaveBeenCalledTimes(2));
    expect(onSegment.mock.calls.map(([segment]) => segment.index)).toEqual([0, 1]);
    downloads.release("/api/reading/audio/a2");
    const result = await promise;
    expect(result.durationSeconds).toBe(3);
    expect(result.segments.map((item) => item.segment.index)).toEqual([0, 1, 2]);
    expect(onSegment).toHaveBeenCalledTimes(3);
  });

  it("rejects on an error line with the line's code", async () => {
    deps.stream = async () => responseOf(ndjson([META, { type: "error", code: "tts_failed", message: "boom" }]));
    await expect(streamTts(PARAMS, { onSegment: vi.fn() }, deps)).rejects.toMatchObject({ code: "tts_failed", status: 502 });
  });

  it("propagates HTTP errors from the stream request", async () => {
    deps.stream = async () => {
      throw new ApiError({
        code: "http_404",
        message: "Not Found",
        status: 404
      });
    };
    const error = await streamTts(PARAMS, { onSegment: vi.fn() }, deps).catch((reason: unknown) => reason);
    expect(isStreamUnsupportedError(error)).toBe(true);
    expect(isStreamUnsupportedError(new ApiError({ code: "block_not_found", message: "", status: 404 }))).toBe(false);
    expect(isStreamUnsupportedError(new ApiError({ code: "http_405", message: "", status: 405 }))).toBe(true);
    expect(isStreamUnsupportedError(new ApiError({ code: "language_unsupported", message: "", status: 409 }))).toBe(false);
  });

  it("aborts the in-flight downloads and rejects with AbortError", async () => {
    const controller = new AbortController();
    const promise = streamTts(PARAMS, { signal: controller.signal, onSegment: vi.fn() }, deps);
    await vi.waitFor(() => expect(downloads.started).toHaveLength(2));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects when a download fails", async () => {
    deps.download = async () => {
      throw new ApiError({ code: "audio_not_found", message: "", status: 404 });
    };
    await expect(streamTts(PARAMS, { onSegment: vi.fn() }, deps)).rejects.toMatchObject({ code: "audio_not_found" });
  });
});

describe("fetchTtsStream", () => {
  it("replays a completed stream from the query cache without touching the network", async () => {
    const client = new QueryClient();
    const deps: StreamDeps = {
      stream: vi.fn(async () => responseOf(ndjson([META, segmentLine(0), segmentLine(1), { type: "done", duration_seconds: 2 }]))),
      download: vi.fn(async (url: string) => new Blob([url]))
    };
    const first = vi.fn();
    await fetchTtsStream(client, PARAMS, { onSegment: first }, deps);
    expect(first).toHaveBeenCalledTimes(2);

    const second = vi.fn();
    const onMeta = vi.fn();
    const result = await fetchTtsStream(client, PARAMS, { onMeta, onSegment: second }, deps);
    expect(deps.stream).toHaveBeenCalledTimes(1);
    expect(onMeta).toHaveBeenCalledTimes(1);
    expect(second.mock.calls.map(([segment]) => segment.index)).toEqual([0, 1]);
    expect(result.segments).toHaveLength(2);
  });
});
