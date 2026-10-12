/**
 * Offline chapters in Cache Storage (`sentinel-reader-v1`).
 *
 * Every entry lives under a synthetic same-origin path (`/__sentinel-reader__/v1/...`) that no
 * route serves and the service worker never intercepts: they are only cache keys. Stored per
 * chapter: the section details (JSON), the TTS response of every block (JSON with word timings)
 * and the block audio (bytes, keyed by `audio_id`). A small JSON index lists the chapters.
 *
 * The offline reader reads exclusively from here (no API calls).
 */

import type { ReadingOfflineManifest, ReadingSectionDetail, ReadingTtsResponse } from "@/types/api";
import { ApiError } from "@/lib/api/errors";

export const OFFLINE_CACHE_NAME = "sentinel-reader-v1";
export const OFFLINE_KEY_PREFIX = "/__sentinel-reader__/v1";
export const DEFAULT_MAX_OFFLINE_CHAPTERS = 5;

/** Synthetic keys (paths). Components are URI-encoded so ids with ":" or "/" stay one segment. */
export const offlineKeys = {
  index: () => `${OFFLINE_KEY_PREFIX}/index.json`,
  section: (sectionId: string) => `${OFFLINE_KEY_PREFIX}/section/${encodeURIComponent(sectionId)}.json`,
  tts: (sectionId: string, partId: string, blockIndex: number) =>
    `${OFFLINE_KEY_PREFIX}/tts/${encodeURIComponent(sectionId)}/${encodeURIComponent(partId)}/${blockIndex}.json`,
  audio: (audioId: string) => `${OFFLINE_KEY_PREFIX}/audio/${encodeURIComponent(audioId)}`
} as const;

/** Stable id of a downloaded chapter. */
export function offlineChapterId(bookSlug: string, chapterFile: string): string {
  return `${bookSlug}/${chapterFile}`;
}

export interface OfflineSectionEntry {
  id: string;
  title: string;
  blocks: number;
}

export interface OfflineChapterEntry {
  id: string;
  bookSlug: string;
  bookTitle: string;
  chapterFile: string;
  chapterIndex: number;
  chapterTitle: string;
  voice: string | null;
  speed: number;
  sections: OfflineSectionEntry[];
  totalBlocks: number;
  doneBlocks: number;
  /** Bytes actually stored (JSON + audio). */
  bytes: number;
  estimatedMb: number;
  complete: boolean;
  /** Audio ids stored for this chapter (removed with it). */
  audioIds: string[];
  updatedAt: string;
}

export interface OfflineIndex {
  version: 1;
  chapters: OfflineChapterEntry[];
}

/** The subset of the Cache Storage API the store uses (injectable for tests). */
export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
}

export class OfflineMissError extends Error {
  constructor(key: string) {
    super(`Not available offline: ${key}`);
    this.name = "OfflineMissError";
  }
}

export function isOfflineStoreSupported(): boolean {
  return typeof globalThis.caches !== "undefined" && typeof globalThis.caches.open === "function";
}

function defaultStorage(): CacheStorageLike {
  if (!isOfflineStoreSupported()) {
    throw new Error("Cache Storage is not available");
  }
  return globalThis.caches as unknown as CacheStorageLike;
}

/** Absolute URL for a key (Cache Storage resolves relative URLs against the page anyway). */
export function toCacheUrl(path: string): string {
  const origin = typeof globalThis.location !== "undefined" && globalThis.location.origin ? globalThis.location.origin : "http://localhost";
  return new URL(path, origin).toString();
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
}

export function emptyIndex(): OfflineIndex {
  return { version: 1, chapters: [] };
}

function isIndex(value: unknown): value is OfflineIndex {
  return typeof value === "object" && value !== null && (value as { version?: unknown }).version === 1 && Array.isArray((value as { chapters?: unknown }).chapters);
}

/** Read/write access to the offline cache. */
export class OfflineStore {
  private cachePromise: Promise<CacheLike> | null = null;

  constructor(private readonly storage: CacheStorageLike = defaultStorage()) {}

  private cache(): Promise<CacheLike> {
    this.cachePromise ??= this.storage.open(OFFLINE_CACHE_NAME);
    return this.cachePromise;
  }

  private async readJson<T>(path: string): Promise<T | null> {
    const response = await (await this.cache()).match(toCacheUrl(path));
    if (!response) {
      return null;
    }
    try {
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  /** Stores JSON and returns its size in bytes. */
  private async writeJson(path: string, value: unknown): Promise<number> {
    const body = JSON.stringify(value);
    await (await this.cache()).put(toCacheUrl(path), new Response(body, { headers: { "Content-Type": "application/json" } }));
    return new Blob([body]).size;
  }

  async has(path: string): Promise<boolean> {
    return Boolean(await (await this.cache()).match(toCacheUrl(path)));
  }

  async readIndex(): Promise<OfflineIndex> {
    const value = await this.readJson<unknown>(offlineKeys.index());
    return isIndex(value) ? value : emptyIndex();
  }

  async writeIndex(index: OfflineIndex): Promise<void> {
    await (await this.cache()).put(toCacheUrl(offlineKeys.index()), jsonResponse(index));
  }

  async upsertChapter(entry: OfflineChapterEntry): Promise<OfflineIndex> {
    const index = await this.readIndex();
    const others = index.chapters.filter((chapter) => chapter.id !== entry.id);
    const next: OfflineIndex = { version: 1, chapters: [...others, entry] };
    await this.writeIndex(next);
    return next;
  }

  async getChapter(id: string): Promise<OfflineChapterEntry | null> {
    return (await this.readIndex()).chapters.find((chapter) => chapter.id === id) ?? null;
  }

  /** Removes a chapter and everything stored for it. */
  async removeChapter(id: string): Promise<OfflineIndex> {
    const index = await this.readIndex();
    const entry = index.chapters.find((chapter) => chapter.id === id);
    const cache = await this.cache();
    if (entry) {
      const stillUsed = new Set(index.chapters.filter((chapter) => chapter.id !== id).flatMap((chapter) => chapter.audioIds));
      for (const section of entry.sections) {
        const detail = await this.getSection(section.id);
        await cache.delete(toCacheUrl(offlineKeys.section(section.id)));
        for (const part of detail?.parts ?? []) {
          for (let blockIndex = 0; blockIndex < part.blocks.length; blockIndex += 1) {
            await cache.delete(toCacheUrl(offlineKeys.tts(section.id, part.id, blockIndex)));
          }
        }
      }
      for (const audioId of entry.audioIds) {
        if (!stillUsed.has(audioId)) {
          await cache.delete(toCacheUrl(offlineKeys.audio(audioId)));
        }
      }
    }
    const next: OfflineIndex = { version: 1, chapters: index.chapters.filter((chapter) => chapter.id !== id) };
    await this.writeIndex(next);
    return next;
  }

  getSection(sectionId: string): Promise<ReadingSectionDetail | null> {
    return this.readJson<ReadingSectionDetail>(offlineKeys.section(sectionId));
  }

  putSection(detail: ReadingSectionDetail): Promise<number> {
    return this.writeJson(offlineKeys.section(detail.section_id), detail);
  }

  getTts(sectionId: string, partId: string, blockIndex: number): Promise<ReadingTtsResponse | null> {
    return this.readJson<ReadingTtsResponse>(offlineKeys.tts(sectionId, partId, blockIndex));
  }

  putTts(sectionId: string, partId: string, blockIndex: number, tts: ReadingTtsResponse): Promise<number> {
    return this.writeJson(offlineKeys.tts(sectionId, partId, blockIndex), tts);
  }

  async getAudio(audioId: string): Promise<Blob | null> {
    const response = await (await this.cache()).match(toCacheUrl(offlineKeys.audio(audioId)));
    return response ? response.blob() : null;
  }

  async putAudio(audioId: string, blob: Blob): Promise<number> {
    await (await this.cache()).put(
      toCacheUrl(offlineKeys.audio(audioId)),
      new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } })
    );
    return blob.size;
  }

  /** Drops the whole offline cache (all chapters). */
  clearAll(): Promise<boolean> {
    this.cachePromise = null;
    return this.storage.delete(OFFLINE_CACHE_NAME);
  }
}

/* ------------------------------------------------------------------ downloader */

export interface OfflineDownloadApi {
  fetchManifest(signal: AbortSignal): Promise<ReadingOfflineManifest>;
  fetchSection(sectionId: string, signal: AbortSignal): Promise<ReadingSectionDetail>;
  fetchTts(sectionId: string, partId: string, blockIndex: number, signal: AbortSignal): Promise<ReadingTtsResponse>;
  fetchAudio(tts: ReadingTtsResponse, signal: AbortSignal): Promise<Blob>;
}

export interface OfflineDownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

export interface OfflineDownloadOptions {
  bookSlug: string;
  chapterFile: string;
  voice: string | null;
  speed: number;
  api: OfflineDownloadApi;
  signal: AbortSignal;
  onProgress?: (progress: OfflineDownloadProgress) => void;
  /** Refuse a new chapter when this many are already stored (resuming one is always allowed). */
  maxChapters?: number;
  now?: () => Date;
  /**
   * Minimum time between two synthesis requests. The API limits POST /api/reading/* per IP
   * (RATE_LIMIT_READING_REQUESTS, 60/min by default) and the reader itself also posts while
   * listening, so a chapter download stays well under it (~50/min).
   */
  minTtsIntervalMs?: number;
  /** Called while waiting out a 429 / 503 (seconds until the next try); `null` when resuming. */
  onWait?: (seconds: number | null) => void;
  /** Injectable for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const DEFAULT_MIN_TTS_INTERVAL_MS = 1200;
const MAX_TRANSIENT_RETRIES = 6;
const MAX_WAIT_SECONDS = 60;

/** Abortable delay. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Download cancelled", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Download cancelled", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Rate limited (429) or speech service busy/warming (503): worth waiting and trying again. */
export function isTransientError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 429 || error.status === 503);
}

/**
 * Runs `task`, waiting out transient failures (honouring Retry-After, capped at 60 s, with a
 * growing fallback) so a long download survives the per-IP limit and a warming speech service.
 */
export async function withTransientRetry<T>(
  task: () => Promise<T>,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
  onWait?: (seconds: number | null) => void
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await task();
      if (attempt > 0) {
        onWait?.(null);
      }
      return result;
    } catch (error) {
      if (!isTransientError(error) || attempt >= MAX_TRANSIENT_RETRIES) {
        throw error;
      }
      const seconds = Math.min(MAX_WAIT_SECONDS, Math.max(1, error.retryAfterSeconds ?? 5 * (attempt + 1)));
      onWait?.(seconds);
      await sleep(seconds * 1000, signal);
    }
  }
}

export class OfflineLimitError extends Error {
  constructor(readonly maxChapters: number) {
    super(`At most ${maxChapters} chapters can be stored offline`);
    this.name = "OfflineLimitError";
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Download cancelled", "AbortError");
  }
}

/**
 * Downloads (or resumes) a chapter: section details, then TTS + audio of every block, one request
 * at a time. Anything already cached is skipped, so a cancelled download resumes where it stopped.
 * The index entry is saved after every block (partial chapters show up as incomplete).
 */
export async function downloadChapter(store: OfflineStore, options: OfflineDownloadOptions): Promise<OfflineChapterEntry> {
  const { api, signal } = options;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const minInterval = options.minTtsIntervalMs ?? DEFAULT_MIN_TTS_INTERVAL_MS;
  const retry = <T,>(task: () => Promise<T>) => withTransientRetry(task, signal, sleep, options.onWait);
  let lastTtsAt = Number.NEGATIVE_INFINITY;
  const id = offlineChapterId(options.bookSlug, options.chapterFile);
  const index = await store.readIndex();
  const existing = index.chapters.find((chapter) => chapter.id === id) ?? null;
  const limit = options.maxChapters ?? DEFAULT_MAX_OFFLINE_CHAPTERS;
  if (!existing && index.chapters.length >= limit) {
    throw new OfflineLimitError(limit);
  }
  // A different voice/speed invalidates the stored audio of this chapter.
  const sameSettings = existing ? existing.voice === options.voice && existing.speed === options.speed : true;

  if (existing && !sameSettings) {
    await store.removeChapter(id);
  }

  throwIfAborted(signal);
  const manifest = await retry(() => api.fetchManifest(signal));
  const audioIds = new Set(sameSettings ? (existing?.audioIds ?? []) : []);
  const entry: OfflineChapterEntry = {
    id,
    bookSlug: manifest.book.slug,
    bookTitle: manifest.book.title,
    chapterFile: manifest.chapter.file,
    chapterIndex: manifest.chapter.index,
    chapterTitle: manifest.chapter.title,
    voice: options.voice,
    speed: options.speed,
    sections: manifest.sections.map((section) => ({ id: section.id, title: section.title, blocks: section.blocks.length })),
    totalBlocks: manifest.total_blocks || manifest.sections.reduce((sum, section) => sum + section.blocks.length, 0),
    doneBlocks: 0,
    bytes: sameSettings ? (existing?.bytes ?? 0) : 0,
    estimatedMb: manifest.estimated_audio_mb,
    complete: false,
    audioIds: [...audioIds],
    updatedAt: now().toISOString()
  };
  await store.upsertChapter(entry);

  let done = 0;
  const report = () => options.onProgress?.({ done, total: entry.totalBlocks, bytes: entry.bytes });
  report();

  for (const section of manifest.sections) {
    throwIfAborted(signal);
    if (!(await store.has(offlineKeys.section(section.id)))) {
      const detail = await retry(() => api.fetchSection(section.id, signal));
      entry.bytes += await store.putSection(detail);
    }
    for (const block of section.blocks) {
      throwIfAborted(signal);
      let tts = sameSettings ? await store.getTts(section.id, block.part_id, block.block_index) : null;
      if (!tts) {
        const wait = lastTtsAt + minInterval - Date.now();
        if (wait > 0) {
          await sleep(wait, signal);
        }
        lastTtsAt = Date.now();
        tts = await retry(() => api.fetchTts(section.id, block.part_id, block.block_index, signal));
        entry.bytes += await store.putTts(section.id, block.part_id, block.block_index, tts);
      }
      if (!(await store.has(offlineKeys.audio(tts.audio_id)))) {
        throwIfAborted(signal);
        const current = tts;
        const blob = await retry(() => api.fetchAudio(current, signal));
        entry.bytes += await store.putAudio(tts.audio_id, blob);
      }
      audioIds.add(tts.audio_id);
      done += 1;
      entry.doneBlocks = done;
      entry.audioIds = [...audioIds];
      entry.updatedAt = now().toISOString();
      await store.upsertChapter(entry);
      report();
    }
  }
  entry.complete = true;
  entry.doneBlocks = entry.totalBlocks;
  entry.updatedAt = now().toISOString();
  await store.upsertChapter(entry);
  report();
  return entry;
}

/** Asks the browser to keep this origin's storage under pressure (best effort, never throws). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage && typeof navigator.storage.persist === "function") {
      return await navigator.storage.persist();
    }
  } catch {
    // Not granted or not supported: downloads still work, the browser may evict them later.
  }
  return false;
}

/** Megabytes with one decimal ("12.3"). */
export function formatMegabytes(bytes: number): string {
  return (Math.max(0, bytes) / (1024 * 1024)).toFixed(1);
}
