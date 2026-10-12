import { describe, expect, it, vi } from "vitest";

import {
  downloadChapter,
  emptyIndex,
  OFFLINE_CACHE_NAME,
  offlineChapterId,
  offlineKeys,
  OfflineLimitError,
  OfflineStore,
  toCacheUrl,
  type CacheLike,
  type CacheStorageLike,
  type OfflineChapterEntry,
  type OfflineDownloadApi
} from "@/features/reading/lib/offline-store";
import { createOfflineSource } from "@/features/reading/lib/reader-source";
import type { ReadingOfflineManifest, ReadingSectionDetail, ReadingTtsResponse } from "@/types/api";

/** In-memory Cache Storage: stores bodies as bytes, returns fresh Responses. */
class MemoryCache implements CacheLike {
  entries = new Map<string, { body: ArrayBuffer; type: string }>();

  async match(request: string) {
    const entry = this.entries.get(request);
    return entry ? new Response(entry.body.slice(0), { headers: { "Content-Type": entry.type } }) : undefined;
  }

  async put(request: string, response: Response) {
    this.entries.set(request, { body: await response.arrayBuffer(), type: response.headers.get("Content-Type") ?? "" });
  }

  async delete(request: string) {
    return this.entries.delete(request);
  }
}

class MemoryStorage implements CacheStorageLike {
  caches = new Map<string, MemoryCache>();

  async open(name: string) {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async delete(name: string) {
    return this.caches.delete(name);
  }
}

const SLUG = "fake_security_guide";
const FILE = "c01";

const MANIFEST: ReadingOfflineManifest = {
  book: { slug: SLUG, title: "Fake Security Guide" },
  chapter: { file: FILE, index: 1, title: "Chapter 1: Social Engineering" },
  sections: [
    { id: `${SLUG}:c01:head-2-1`, title: "Phishing", blocks: [{ part_id: "p1", block_index: 0, words: 12 }, { part_id: "p1", block_index: 1, words: 9 }] },
    { id: `${SLUG}:c01:head-3-1`, title: "Whaling", blocks: [{ part_id: "p2", block_index: 0, words: 10 }] }
  ],
  total_blocks: 3,
  estimated_audio_mb: 0.4
};

function sectionDetail(id: string, partId: string, blocks: number): ReadingSectionDetail {
  return {
    section_id: id,
    book_title: "Fake Security Guide",
    title: id,
    breadcrumb: [],
    objectives: [],
    parts: [{ id: partId, title: "Part", depth: 1, blocks: Array.from({ length: blocks }, (_, index) => ({ text: `Block ${index}.` })) }],
    truncated: false,
    practice_questions: 0,
    book_slug: SLUG,
    chapter_file: FILE,
    chapter_index: 1,
    position: { index: 1, total: 2 },
    progress: null
  };
}

function tts(sectionId: string, partId: string, blockIndex: number): ReadingTtsResponse {
  return {
    audio_id: `${sectionId}-${partId}-${blockIndex}`.replace(/[^a-z0-9]/gi, ""),
    audio_url: "/api/reading/audio/x",
    content_type: "audio/wav",
    duration_seconds: 1,
    voice: "af_heart",
    speed: 1,
    engine: "fake",
    cached: false,
    text: "Block.",
    words: [{ text: "Block", start: 0, end: 0.3, char_start: 0, char_end: 5 }]
  };
}

function fakeApi() {
  const api = {
    fetchManifest: vi.fn(async () => MANIFEST),
    fetchSection: vi.fn(async (id: string) => sectionDetail(id, id.endsWith("head-2-1") ? "p1" : "p2", id.endsWith("head-2-1") ? 2 : 1)),
    fetchTts: vi.fn(async (sectionId: string, partId: string, blockIndex: number) => tts(sectionId, partId, blockIndex)),
    fetchAudio: vi.fn(async () => new Blob([new Uint8Array(1024)], { type: "audio/wav" }))
  } satisfies OfflineDownloadApi;
  return api;
}

describe("offline keys", () => {
  it("are synthetic same-origin paths under one prefix, with encoded components", () => {
    expect(offlineKeys.index()).toBe("/__sentinel-reader__/v1/index.json");
    expect(offlineKeys.section("book:c01:head-2-1")).toBe("/__sentinel-reader__/v1/section/book%3Ac01%3Ahead-2-1.json");
    expect(offlineKeys.tts("book:c01:x", "part/1", 3)).toBe("/__sentinel-reader__/v1/tts/book%3Ac01%3Ax/part%2F1/3.json");
    expect(offlineKeys.audio("abc123")).toBe("/__sentinel-reader__/v1/audio/abc123");
    expect(offlineChapterId(SLUG, FILE)).toBe(`${SLUG}/${FILE}`);
    expect(toCacheUrl(offlineKeys.index())).toMatch(/^https?:\/\/[^/]+\/__sentinel-reader__\/v1\/index\.json$/);
    expect(OFFLINE_CACHE_NAME).toBe("sentinel-reader-v1");
  });
});

describe("OfflineStore index", () => {
  it("starts empty, upserts and removes chapters", async () => {
    const store = new OfflineStore(new MemoryStorage());
    expect(await store.readIndex()).toEqual(emptyIndex());
    const entry: OfflineChapterEntry = {
      id: "a/c01",
      bookSlug: "a",
      bookTitle: "A",
      chapterFile: "c01",
      chapterIndex: 1,
      chapterTitle: "One",
      voice: "af_heart",
      speed: 1,
      sections: [],
      totalBlocks: 0,
      doneBlocks: 0,
      bytes: 0,
      estimatedMb: 0,
      complete: true,
      audioIds: [],
      updatedAt: "2026-10-12T00:00:00.000Z"
    };
    await store.upsertChapter(entry);
    await store.upsertChapter({ ...entry, doneBlocks: 2 });
    const index = await store.readIndex();
    expect(index.chapters).toHaveLength(1);
    expect(index.chapters[0].doneBlocks).toBe(2);
    expect((await store.removeChapter("a/c01")).chapters).toEqual([]);
  });
});

describe("downloadChapter", () => {
  it("stores sections, TTS and audio, reports progress and serves them to the offline reader source", async () => {
    const storage = new MemoryStorage();
    const store = new OfflineStore(storage);
    const api = fakeApi();
    const progress: Array<[number, number]> = [];
    const entry = await downloadChapter(store, {
      bookSlug: SLUG,
      chapterFile: FILE,
      voice: "af_heart",
      speed: 1,
      api,
      minTtsIntervalMs: 0,
      signal: new AbortController().signal,
      onProgress: (value) => progress.push([value.done, value.total])
    });
    expect(entry.complete).toBe(true);
    expect(entry.doneBlocks).toBe(3);
    expect(entry.bytes).toBeGreaterThan(3 * 1024);
    expect(progress.at(-1)).toEqual([3, 3]);
    expect(api.fetchTts).toHaveBeenCalledTimes(3);
    expect(api.fetchAudio).toHaveBeenCalledTimes(3);

    // The offline source reads everything back without any API.
    const source = createOfflineSource(store);
    const params = { sectionId: `${SLUG}:c01:head-2-1`, partId: "p1", blockIndex: 1, voice: "af_heart", speed: 1 };
    const loaded = await source.loadTts(params);
    expect(loaded.words[0].text).toBe("Block");
    expect((await source.loadAudio(loaded)).size).toBe(1024);
    expect((await store.getSection(`${SLUG}:c01:head-3-1`))?.parts[0].id).toBe("p2");
    await expect(source.loadTts({ ...params, blockIndex: 9 })).rejects.toThrow(/offline/i);
  });

  it("resumes after a cancel, skipping what is already cached", async () => {
    const store = new OfflineStore(new MemoryStorage());
    const api = fakeApi();
    const controller = new AbortController();
    api.fetchAudio.mockImplementation(async () => {
      if (api.fetchAudio.mock.calls.length === 2) {
        controller.abort();
      }
      return new Blob([new Uint8Array(10)]);
    });
    await expect(
      downloadChapter(store, { bookSlug: SLUG, chapterFile: FILE, voice: "af_heart", speed: 1, api, minTtsIntervalMs: 0, signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
    const partial = await store.getChapter(offlineChapterId(SLUG, FILE));
    expect(partial?.complete).toBe(false);
    expect(partial?.doneBlocks).toBe(2);

    api.fetchTts.mockClear();
    api.fetchAudio.mockClear();
    api.fetchSection.mockClear();
    const done = await downloadChapter(store, { bookSlug: SLUG, chapterFile: FILE, voice: "af_heart", speed: 1, api, minTtsIntervalMs: 0, signal: new AbortController().signal });
    expect(done.complete).toBe(true);
    expect(api.fetchTts).toHaveBeenCalledTimes(1);
    expect(api.fetchAudio).toHaveBeenCalledTimes(1);
    // Only the second section was not stored before the cancel.
    expect(api.fetchSection).toHaveBeenCalledTimes(1);
    expect(api.fetchSection).toHaveBeenCalledWith(`${SLUG}:c01:head-3-1`, expect.anything());
  });

  it("refuses a new chapter past the limit but removes chapters with their data", async () => {
    const storage = new MemoryStorage();
    const store = new OfflineStore(storage);
    const api = fakeApi();
    await downloadChapter(store, { bookSlug: SLUG, chapterFile: FILE, voice: null, speed: 1, api, minTtsIntervalMs: 0, signal: new AbortController().signal, maxChapters: 1 });
    await expect(
      downloadChapter(store, { bookSlug: SLUG, chapterFile: "c02", voice: null, speed: 1, api, minTtsIntervalMs: 0, signal: new AbortController().signal, maxChapters: 1 })
    ).rejects.toBeInstanceOf(OfflineLimitError);

    await store.removeChapter(offlineChapterId(SLUG, FILE));
    const cache = storage.caches.get(OFFLINE_CACHE_NAME);
    // Only the (now empty) index remains.
    expect([...(cache?.entries.keys() ?? [])]).toEqual([toCacheUrl(offlineKeys.index())]);
  });
});

describe("downloadChapter pacing and transient errors", () => {
  it("waits out a 429 (Retry-After) and resumes the same block", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    const store = new OfflineStore(new MemoryStorage());
    const api = fakeApi();
    const original = api.fetchTts.getMockImplementation();
    let failed = false;
    api.fetchTts.mockImplementation(async (sectionId: string, partId: string, blockIndex: number) => {
      if (!failed) {
        failed = true;
        throw new ApiError({ message: "slow down", code: "rate_limited", status: 429, retryAfterSeconds: 7 });
      }
      return original!(sectionId, partId, blockIndex);
    });
    const sleeps: number[] = [];
    const waits: Array<number | null> = [];
    const entry = await downloadChapter(store, {
      bookSlug: SLUG,
      chapterFile: FILE,
      voice: "af_heart",
      speed: 1,
      api,
      signal: new AbortController().signal,
      minTtsIntervalMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onWait: (seconds) => waits.push(seconds)
    });
    expect(entry.complete).toBe(true);
    expect(sleeps).toContain(7000);
    expect(waits).toEqual([7, null]);
    expect(api.fetchTts).toHaveBeenCalledTimes(4);
  });

  it("paces synthesis requests and gives up on non-transient errors", async () => {
    const { ApiError } = await import("@/lib/api/errors");
    const store = new OfflineStore(new MemoryStorage());
    const api = fakeApi();
    const sleeps: number[] = [];
    await downloadChapter(store, {
      bookSlug: SLUG,
      chapterFile: FILE,
      voice: "af_heart",
      speed: 1,
      api,
      signal: new AbortController().signal,
      minTtsIntervalMs: 60_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });
    // Three blocks: the second and third synthesis wait for the interval.
    expect(sleeps.filter((ms) => ms > 1000)).toHaveLength(2);

    const other = new OfflineStore(new MemoryStorage());
    const failing = fakeApi();
    failing.fetchTts.mockRejectedValue(new ApiError({ message: "nope", code: "block_not_found", status: 404 }));
    await expect(
      downloadChapter(other, { bookSlug: SLUG, chapterFile: FILE, voice: null, speed: 1, api: failing, minTtsIntervalMs: 0, signal: new AbortController().signal })
    ).rejects.toMatchObject({ status: 404 });
  });
});
