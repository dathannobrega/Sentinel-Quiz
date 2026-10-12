"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiClient, sendKeepaliveJson } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import type {
  ReadingAddWordRequest,
  ReadingAssessment,
  ReadingCardKind,
  ReadingDataDeleted,
  ReadingDataExport,
  ReadingGlossaryEntry,
  ReadingGrade,
  ReadingOfflineManifest,
  ReadingQuiz,
  ReadingQuizAnswerResult,
  ReadingWordCard,
  ReadingWordList,
  ReadingWordRef,
  ReadingWordReview,
  ReadingWordSummary,
  ReadingAttemptList,
  ReadingCapabilities,
  ReadingChapterDetail,
  ReadingLibrary,
  ReadingMode,
  ReadingProgress,
  ReadingProgressList,
  ReadingProgressUpdate,
  ReadingSectionDetail,
  ReadingStats,
  ReadingTtsRequest,
  ReadingTtsResponse
} from "@/types/api";

const READING_BASE = "/reading";

/** TTS synthesis and audio streaming can take a while on CPU; the ASR even longer. */
export const READING_TIMEOUTS = {
  tts: 60_000,
  audio: 60_000,
  assess: 120_000
} as const;

/** GET /api/reading/capabilities (cached for 60 s: the API itself re-checks the service every 30 s). */
export function useReadingCapabilitiesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.readingCapabilities,
    queryFn: ({ signal }) => apiClient.get<ReadingCapabilities>(`${READING_BASE}/capabilities`, { signal }),
    staleTime: 60_000,
    enabled
  });
}

/** GET /api/reading/library: books with chapters and the user's progress. */
export function useReadingLibraryQuery() {
  return useQuery({
    queryKey: queryKeys.readingLibrary,
    queryFn: ({ signal }) => apiClient.get<ReadingLibrary>(`${READING_BASE}/library`, { signal })
  });
}

/** GET /api/reading/books/{slug}/chapters/{file}: sections of one chapter (loaded on open). */
export function useReadingChapterQuery(slug: string, file: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.readingChapter(slug, file),
    queryFn: ({ signal }) =>
      apiClient.get<ReadingChapterDetail>(`${READING_BASE}/books/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(file)}`, {
        signal
      }),
    enabled: enabled && Boolean(slug) && Boolean(file),
    staleTime: 5 * 60_000
  });
}

/** GET /api/reading/sections/{id}: the section text plus its place in the book. */
export function useReadingSectionQuery(sectionId: string) {
  return useQuery({
    queryKey: queryKeys.readingSection(sectionId),
    queryFn: ({ signal }) => apiClient.get<ReadingSectionDetail>(`${READING_BASE}/sections/${encodeURIComponent(sectionId)}`, { signal }),
    enabled: Boolean(sectionId),
    staleTime: 10 * 60_000
  });
}

/** GET /api/reading/sections/{id}/attempts: the user's recent shadowing attempts in this section. */
export function useReadingAttemptsQuery(sectionId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.readingAttempts(sectionId),
    queryFn: ({ signal }) =>
      apiClient.get<ReadingAttemptList>(`${READING_BASE}/sections/${encodeURIComponent(sectionId)}/attempts?limit=20`, { signal }),
    enabled: enabled && Boolean(sectionId)
  });
}

/** GET /api/reading/stats */
export function useReadingStatsQuery() {
  return useQuery({
    queryKey: queryKeys.readingStats,
    queryFn: ({ signal }) => apiClient.get<ReadingStats>(`${READING_BASE}/stats`, { signal })
  });
}

/** GET /api/reading/progress */
export function useReadingProgressQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.readingProgress,
    queryFn: ({ signal }) => apiClient.get<ReadingProgressList>(`${READING_BASE}/progress`, { signal }),
    enabled
  });
}

export interface TtsParams {
  sectionId: string;
  partId: string;
  blockIndex: number;
  voice: string | null;
  speed: number;
}

function ttsKey(params: TtsParams) {
  return queryKeys.readingTts(params.sectionId, params.partId, params.blockIndex, params.voice ?? "", params.speed);
}

function ttsRequest(params: TtsParams): ReadingTtsRequest {
  const body: ReadingTtsRequest = { part_id: params.partId, block_index: params.blockIndex, speed: params.speed };
  if (params.voice) {
    body.voice = params.voice;
  }
  return body;
}

function postTts(params: TtsParams, signal?: AbortSignal): Promise<ReadingTtsResponse> {
  return apiClient.post<ReadingTtsResponse>(`${READING_BASE}/sections/${encodeURIComponent(params.sectionId)}/tts`, ttsRequest(params), {
    signal,
    timeoutMs: READING_TIMEOUTS.tts
  });
}

/** POST …/tts through the query cache (the same block/voice/speed is synthesised once per session). */
export function fetchTts(client: QueryClient, params: TtsParams, options: { force?: boolean } = {}): Promise<ReadingTtsResponse> {
  if (options.force) {
    client.removeQueries({ queryKey: ttsKey(params), exact: true });
  }
  return client.fetchQuery({
    queryKey: ttsKey(params),
    queryFn: ({ signal }) => postTts(params, signal),
    staleTime: 23 * 60 * 60_000,
    retry: false
  });
}

/** Warms the TTS cache (server and client) for the block that plays next. */
export function prefetchTts(client: QueryClient, params: TtsParams): Promise<void> {
  return client.prefetchQuery({
    queryKey: ttsKey(params),
    queryFn: ({ signal }) => postTts(params, signal),
    staleTime: 23 * 60 * 60_000,
    retry: false
  });
}

/** GET /api/reading/audio/{id} as a Blob (credentials included). */
export async function fetchTtsAudio(audioUrl: string, signal?: AbortSignal): Promise<Blob> {
  const file = await apiClient.download(audioUrl, { signal, timeoutMs: READING_TIMEOUTS.audio });
  return file.blob;
}

export interface AssessInput {
  partId: string;
  blockIndex: number;
  blob: Blob;
  filename: string;
  /** Drill: assess only this sentence of the block. */
  sentenceIndex?: number;
}

/** POST /api/reading/sections/{id}/assess (multipart). Invalidates attempts and stats on success. */
export function useAssessMutation(sectionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: AssessInput) => {
      const form = new FormData();
      form.append("audio", input.blob, input.filename);
      form.append("part_id", input.partId);
      form.append("block_index", String(input.blockIndex));
      if (input.sentenceIndex !== undefined) {
        form.append("sentence_index", String(input.sentenceIndex));
      }
      return apiClient.post<ReadingAssessment>(`${READING_BASE}/sections/${encodeURIComponent(sectionId)}/assess`, form, {
        timeoutMs: READING_TIMEOUTS.assess
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.readingAttempts(sectionId) });
      void client.invalidateQueries({ queryKey: queryKeys.readingStats });
      void client.invalidateQueries({ queryKey: queryKeys.readingCapabilities });
      void client.invalidateQueries({ queryKey: queryKeys.readingWords });
    }
  });
}

export interface ProgressReporterInput {
  bookSlug: string;
  sectionId: string;
  /** False for the offline reader: nothing is sent (no network, no account context). */
  enabled?: boolean;
}

export interface ProgressPosition {
  partId: string;
  blockIndex: number;
  mode: ReadingMode;
}

const PROGRESS_DEBOUNCE_MS = 2_000;

/**
 * Debounced `PUT /api/reading/progress`. `addWords` / `addSeconds` accumulate increments; `report`
 * records the current block and schedules a send 2 s later. Pending data is flushed with a
 * keepalive request on `pagehide` and on unmount.
 */
export function useProgressReporter({ bookSlug, sectionId, enabled = true }: ProgressReporterInput) {
  const client = useQueryClient();
  const positionRef = useRef<ProgressPosition | null>(null);
  const wordsRef = useRef(0);
  const secondsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const buildPayload = useCallback((): ReadingProgressUpdate | null => {
    const position = positionRef.current;
    if (!enabled || !position || !bookSlug || !sectionId) {
      return null;
    }
    return {
      book_slug: bookSlug,
      section_id: sectionId,
      part_id: position.partId,
      block_index: position.blockIndex,
      mode: position.mode,
      words_read: Math.max(0, Math.round(wordsRef.current)),
      seconds_listened: Math.max(0, Math.round(secondsRef.current))
    };
  }, [bookSlug, enabled, sectionId]);

  const reset = useCallback(() => {
    wordsRef.current = 0;
    secondsRef.current = 0;
    dirtyRef.current = false;
  }, []);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) {
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    reset();
    try {
      await apiClient.put<ReadingProgress>(`${READING_BASE}/progress`, payload);
      void client.invalidateQueries({ queryKey: queryKeys.readingLibrary });
      void client.invalidateQueries({ queryKey: queryKeys.readingProgress });
      void client.invalidateQueries({ queryKey: queryKeys.readingStats });
    } catch {
      // Progress is best effort; the next block change retries with fresh increments.
    }
  }, [buildPayload, client, reset]);

  const schedule = useCallback(() => {
    dirtyRef.current = true;
    if (timerRef.current) {
      globalThis.clearTimeout(timerRef.current);
    }
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, PROGRESS_DEBOUNCE_MS);
  }, [flush]);

  const report = useCallback(
    (position: ProgressPosition) => {
      positionRef.current = position;
      schedule();
    },
    [schedule]
  );

  const addWords = useCallback(
    (count: number) => {
      if (count > 0) {
        wordsRef.current += count;
        schedule();
      }
    },
    [schedule]
  );

  const addSeconds = useCallback(
    (seconds: number) => {
      if (seconds > 0) {
        secondsRef.current += seconds;
        dirtyRef.current = true;
      }
    },
    []
  );

  useEffect(() => {
    const flushKeepalive = () => {
      if (!dirtyRef.current) {
        return;
      }
      const payload = buildPayload();
      if (!payload) {
        return;
      }
      if (timerRef.current) {
        globalThis.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      reset();
      sendKeepaliveJson(`${READING_BASE}/progress`, "PUT", payload);
    };
    window.addEventListener("pagehide", flushKeepalive);
    return () => {
      window.removeEventListener("pagehide", flushKeepalive);
      flushKeepalive();
    };
  }, [buildPayload, reset]);

  // Stable identity: the reader keys effects on this object.
  return useMemo(() => ({ report, addWords, addSeconds, flush }), [report, addWords, addSeconds, flush]);
}

/* ------------------------------------------------------------------ words (spaced repetition) */

function invalidateWords(client: QueryClient) {
  void client.invalidateQueries({ queryKey: queryKeys.readingWords });
  void client.invalidateQueries({ queryKey: queryKeys.readingCapabilities });
  void client.invalidateQueries({ queryKey: queryKeys.readingStats });
}

/** GET /api/reading/words/summary */
export function useWordSummaryQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.readingWordSummary,
    queryFn: ({ signal }) => apiClient.get<ReadingWordSummary>(`${READING_BASE}/words/summary`, { signal }),
    enabled
  });
}

export type WordStatusFilter = "due" | "all";
export type WordKindFilter = ReadingCardKind | "any";

export function buildWordsPath(status: WordStatusFilter, kind: WordKindFilter, limit: number, offset = 0): string {
  const params = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
  if (kind !== "any") {
    params.set("kind", kind);
  }
  return `${READING_BASE}/words?${params.toString()}`;
}

/** GET /api/reading/words (due first). `limit` grows with "show more". */
export function useWordListQuery(status: WordStatusFilter, kind: WordKindFilter, limit = 50, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.readingWordList(status, kind), limit] as const,
    queryFn: ({ signal }) => apiClient.get<ReadingWordList>(buildWordsPath(status, kind, limit), { signal }),
    enabled
  });
}

/** POST /api/reading/words (201 new, 200 when the card already existed). */
export function useAddWordMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReadingAddWordRequest) => apiClient.post<ReadingWordCard>(`${READING_BASE}/words`, body),
    onSuccess: () => invalidateWords(client)
  });
}

/** DELETE /api/reading/words/{id} */
export function useDeleteWordMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<null>(`${READING_BASE}/words/${encodeURIComponent(id)}`),
    onSuccess: () => invalidateWords(client)
  });
}

/** POST /api/reading/words/{id}/review (multipart recording of the word). */
export function useReviewWordMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; blob: Blob; filename: string }) => {
      const form = new FormData();
      form.append("audio", input.blob, input.filename);
      return apiClient.post<ReadingWordReview>(`${READING_BASE}/words/${encodeURIComponent(input.id)}/review`, form, {
        timeoutMs: READING_TIMEOUTS.assess
      });
    },
    onSuccess: () => invalidateWords(client)
  });
}

/** POST /api/reading/words/{id}/grade (vocabulary cards). */
export function useGradeWordMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; grade: ReadingGrade }) =>
      apiClient.post<ReadingWordCard>(`${READING_BASE}/words/${encodeURIComponent(input.id)}/grade`, { grade: input.grade }),
    onSuccess: () => invalidateWords(client)
  });
}

/** POST /api/reading/words/{id}/tts, then the audio blob. */
export async function fetchWordAudio(cardId: string, options: { voice?: string | null; signal?: AbortSignal } = {}): Promise<Blob> {
  const body: { voice?: string } = {};
  if (options.voice) {
    body.voice = options.voice;
  }
  const tts = await apiClient.post<ReadingTtsResponse>(`${READING_BASE}/words/${encodeURIComponent(cardId)}/tts`, body, {
    signal: options.signal,
    timeoutMs: READING_TIMEOUTS.tts
  });
  return fetchTtsAudio(tts.audio_url, options.signal);
}

/* ------------------------------------------------------------------ glossary and comprehension */

/** Updates the cached glossary entry after the word was added to the deck. */
export function markGlossaryInDeck(client: QueryClient, ref: ReadingWordRef, card: ReadingWordCard) {
  client.setQueryData<ReadingGlossaryEntry>(
    queryKeys.readingGlossary(ref.section_id, ref.part_id, ref.block_index, ref.char_start, ref.char_end),
    (previous) => (previous ? { ...previous, in_deck: true, card_id: card.id } : previous)
  );
}

/** POST /api/reading/sections/{id}/quiz: generates (or returns the cached) comprehension quiz. */
export function useGenerateQuizMutation(sectionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<ReadingQuiz>(`${READING_BASE}/sections/${encodeURIComponent(sectionId)}/quiz`, undefined, {
        timeoutMs: READING_TIMEOUTS.assess
      }),
    onSuccess: (quiz) => client.setQueryData(queryKeys.readingQuiz(sectionId), quiz)
  });
}

/** POST /api/reading/sections/{id}/quiz/answer */
export function useAnswerQuizMutation(sectionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { questionIndex: number; choice: string }) =>
      apiClient.post<ReadingQuizAnswerResult>(`${READING_BASE}/sections/${encodeURIComponent(sectionId)}/quiz/answer`, {
        question_index: input.questionIndex,
        choice: input.choice
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.readingStats })
  });
}

/* ------------------------------------------------------------------ your data */

/** GET /api/reading/me/export */
export function exportReadingData(): Promise<ReadingDataExport> {
  return apiClient.get<ReadingDataExport>(`${READING_BASE}/me/export`, { timeoutMs: READING_TIMEOUTS.assess });
}

/** DELETE /api/reading/me, then every reading query is refetched. */
export function useDeleteReadingDataMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.delete<ReadingDataDeleted>(`${READING_BASE}/me`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["reading"] })
  });
}

/* ------------------------------------------------------------------ offline */

export function offlineManifestPath(slug: string, file: string): string {
  return `${READING_BASE}/books/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(file)}/offline-manifest`;
}

export function sectionPath(sectionId: string): string {
  return `${READING_BASE}/sections/${encodeURIComponent(sectionId)}`;
}

/** GET …/offline-manifest */
export function fetchOfflineManifest(slug: string, file: string, signal?: AbortSignal): Promise<ReadingOfflineManifest> {
  return apiClient.get<ReadingOfflineManifest>(offlineManifestPath(slug, file), { signal });
}

/** POST …/tts outside the query cache (offline downloads). */
export function requestTts(params: TtsParams, signal?: AbortSignal): Promise<ReadingTtsResponse> {
  return postTts(params, signal);
}
