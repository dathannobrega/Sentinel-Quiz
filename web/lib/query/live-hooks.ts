"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import {
  archiveLiveQuiz,
  createLiveQuiz,
  createLiveSession,
  duplicateLiveQuiz,
  endLiveSession,
  getBankFacets,
  getLiveCapabilities,
  getLiveQuiz,
  getLiveReport,
  getLiveSession,
  isVersionConflict,
  listLiveQuizzes,
  listLiveSessions,
  searchBank,
  type LiveBankSearchParams
} from "@/lib/api/live-authoring";
import { createChallenge, getChallengeProgress, updateChallenge } from "@/lib/api/live-challenge";
import { createSerialQueue, type SerialQueue } from "@/lib/utils/serial-queue";
import type {
  LiveChallengeCreate,
  LiveChallengeProgress,
  LiveChallengeUpdate,
  LiveQuizCreate,
  LiveQuizDetail,
  LiveQuizSummary,
  LiveSession,
  LiveSessionCreate
} from "@/types/api";

/** Every Sentinel Arena key starts with "live" so auth changes can drop them by prefix. */
export const liveKeys = {
  all: ["live"] as const,
  capabilities: ["live", "capabilities"] as const,
  quizzes: ["live", "quizzes"] as const,
  quiz: (quizId: string) => ["live", "quiz", quizId] as const,
  bankFacets: ["live", "bank", "facets"] as const,
  bankSearch: (params: LiveBankSearchParams) =>
    [
      "live",
      "bank",
      "search",
      params.q?.trim() ?? "",
      params.certification ?? "",
      params.domain ?? "",
      params.difficulty ?? "",
      Boolean(params.onlyGuestEligible),
      params.limit ?? 20,
      params.offset ?? 0
    ] as const,
  sessions: (quizId: string) => ["live", "sessions", quizId] as const,
  session: (sessionId: string) => ["live", "session", sessionId] as const,
  report: (sessionId: string) => ["live", "report", sessionId] as const,
  challenge: (sessionId: string) => ["live", "challenge", sessionId] as const
};

/** Owner panel poll (RF-809). */
export const CHALLENGE_POLL_MS = 10_000;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useLiveCapabilities() {
  return useQuery({
    queryKey: liveKeys.capabilities,
    queryFn: ({ signal }) => getLiveCapabilities({ signal }),
    staleTime: 5 * 60_000,
    retry: false
  });
}

export function useLiveQuizzes(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.quizzes,
    queryFn: ({ signal }) => listLiveQuizzes({ signal }),
    enabled: options?.enabled ?? true
  });
}

/**
 * Quiz detail for the editor. Never refetched in the background: the cache is owned by the
 * mutation results (each returns the full QuizDetail). A stale background response could
 * otherwise move `version` backwards and cause a spurious 409.
 */
export function useLiveQuiz(quizId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.quiz(quizId),
    queryFn: ({ signal }) => getLiveQuiz(quizId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(quizId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false
  });
}

export function useBankFacets(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.bankFacets,
    queryFn: ({ signal }) => getBankFacets({ signal }),
    staleTime: 10 * 60_000,
    enabled: options?.enabled ?? true
  });
}

export function useBankSearch(params: LiveBankSearchParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.bankSearch(params),
    queryFn: ({ signal }) => searchBank(params, { signal }),
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true
  });
}

export function useLiveSessions(quizId: string, options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: liveKeys.sessions(quizId),
    queryFn: ({ signal }) => listLiveSessions(quizId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(quizId),
    refetchInterval: options?.refetchInterval ?? false
  });
}

export function useLiveSession(sessionId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.session(sessionId),
    queryFn: ({ signal }) => getLiveSession(sessionId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(sessionId)
  });
}

export function useLiveReport(sessionId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.report(sessionId),
    queryFn: ({ signal }) => getLiveReport(sessionId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(sessionId),
    staleTime: 60_000
  });
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

export function toQuizSummary(detail: LiveQuizDetail): LiveQuizSummary {
  return {
    id: detail.id,
    title: detail.title,
    description: detail.description,
    theme_key: detail.theme_key,
    item_count: detail.item_count,
    version: detail.version,
    published_version_no: detail.published_version_no,
    has_unpublished_changes: detail.has_unpublished_changes,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    last_session: detail.last_session
  };
}

/**
 * Writes a QuizDetail into the cache, never moving `version` backwards, and mirrors it into the
 * library list when that list is cached.
 */
export function applyQuizDetail(queryClient: QueryClient, detail: LiveQuizDetail): void {
  const key = liveKeys.quiz(detail.id);
  const current = queryClient.getQueryData<LiveQuizDetail>(key);
  if (!current || detail.version >= current.version) {
    queryClient.setQueryData(key, detail);
  }
  queryClient.setQueryData<LiveQuizSummary[]>(liveKeys.quizzes, (list) => {
    if (!list) {
      return list;
    }
    const summary = toQuizSummary(detail);
    const index = list.findIndex((item) => item.id === detail.id);
    if (index === -1) {
      return [summary, ...list];
    }
    if (list[index] && list[index].version > summary.version) {
      return list;
    }
    const next = list.slice();
    next[index] = summary;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Library mutations
// ---------------------------------------------------------------------------

export function useCreateLiveQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LiveQuizCreate) => createLiveQuiz(payload),
    onSuccess: (detail) => applyQuizDetail(queryClient, detail)
  });
}

export function useDuplicateLiveQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quizId: string) => duplicateLiveQuiz(quizId),
    onSuccess: (detail) => applyQuizDetail(queryClient, detail)
  });
}

export function useArchiveLiveQuiz() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quizId: string) => archiveLiveQuiz(quizId),
    onMutate: async (quizId) => {
      await queryClient.cancelQueries({ queryKey: liveKeys.quizzes });
      const previous = queryClient.getQueryData<LiveQuizSummary[]>(liveKeys.quizzes);
      queryClient.setQueryData<LiveQuizSummary[]>(liveKeys.quizzes, (list) => list?.filter((item) => item.id !== quizId));
      return { previous };
    },
    onError: (_error, _quizId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(liveKeys.quizzes, context.previous);
      }
    },
    onSettled: (_data, _error, quizId) => {
      queryClient.removeQueries({ queryKey: liveKeys.quiz(quizId) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.quizzes });
    }
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function useCreateLiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LiveSessionCreate) => createLiveSession(payload),
    onSuccess: (session) => {
      queryClient.setQueryData(liveKeys.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: liveKeys.sessions(session.quiz_id) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.quizzes });
    }
  });
}

export function useEndLiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => endLiveSession(sessionId),
    onSuccess: (session: LiveSession) => {
      queryClient.setQueryData(liveKeys.session(session.id), session);
      queryClient.setQueryData<LiveSession[]>(liveKeys.sessions(session.quiz_id), (list) =>
        list?.map((item) => (item.id === session.id ? session : item))
      );
      void queryClient.invalidateQueries({ queryKey: liveKeys.quizzes });
    }
  });
}

// ---------------------------------------------------------------------------
// Self-paced challenges (Incremento 6)
// ---------------------------------------------------------------------------

/**
 * Owner panel, polled every 10 s. react-query pauses interval refetches while the tab is hidden
 * (`refetchIntervalInBackground: false`) and refetches on focus, so a background tab costs nothing.
 */
export function useChallengeProgress(sessionId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: liveKeys.challenge(sessionId),
    queryFn: ({ signal }) => getChallengeProgress(sessionId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(sessionId),
    refetchInterval: CHALLENGE_POLL_MS,
    refetchIntervalInBackground: false
  });
}

export function useCreateChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LiveChallengeCreate) => createChallenge(payload),
    onSuccess: (session) => {
      queryClient.setQueryData(liveKeys.session(session.id), session);
      void queryClient.invalidateQueries({ queryKey: liveKeys.sessions(session.quiz_id) });
      void queryClient.invalidateQueries({ queryKey: liveKeys.quizzes });
    }
  });
}

/** Moves the deadline or closes now; the answer is the fresh panel. */
export function useUpdateChallenge(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LiveChallengeUpdate) => updateChallenge(sessionId, body),
    onSuccess: (progress: LiveChallengeProgress) => {
      queryClient.setQueryData(liveKeys.challenge(sessionId), progress);
      void queryClient.invalidateQueries({ queryKey: liveKeys.session(sessionId) });
      void queryClient.invalidateQueries({ queryKey: ["live", "sessions"] });
    }
  });
}

// ---------------------------------------------------------------------------
// Editor: serialized, optimistic-concurrency aware quiz mutations
// ---------------------------------------------------------------------------

export interface QuizMutator {
  /**
   * Queues `task`. It runs after every previously queued task and receives the quiz `version`
   * currently in the cache (i.e. the one produced by the previous mutation). `pick` extracts the
   * QuizDetail from the response (defaults to the response itself).
   */
  run<T>(task: (expectedVersion: number) => Promise<T>, pick?: (result: T) => LiveQuizDetail): Promise<T>;
  /** Tasks queued or running. */
  busy: number;
  /** Set when a 409 version_conflict was received (the quiz was changed in another tab). */
  conflict: boolean;
  dismissConflict: () => void;
  queue: SerialQueue;
}

export function useQuizMutator(quizId: string): QuizMutator {
  const queryClient = useQueryClient();
  const [queue] = useState<SerialQueue>(() => createSerialQueue());
  const [conflict, setConflict] = useState(false);

  const busy = useSyncExternalStore(
    useCallback((listener: () => void) => queue.subscribe(listener), [queue]),
    () => queue.size,
    () => 0
  );

  const run = useCallback(
    <T,>(task: (expectedVersion: number) => Promise<T>, pick?: (result: T) => LiveQuizDetail): Promise<T> =>
      queue.enqueue(async () => {
        const current: LiveQuizDetail =
          queryClient.getQueryData<LiveQuizDetail>(liveKeys.quiz(quizId)) ??
          (await queryClient.fetchQuery<LiveQuizDetail>({
            queryKey: liveKeys.quiz(quizId),
            queryFn: ({ signal }) => getLiveQuiz(quizId, { signal })
          }));
        try {
          const result = await task(current.version);
          const detail = pick ? pick(result) : (result as unknown as LiveQuizDetail);
          if (detail && typeof detail === "object" && "version" in detail) {
            applyQuizDetail(queryClient, detail);
          }
          return result;
        } catch (error) {
          if (isVersionConflict(error)) {
            setConflict(true);
            // Pull the other tab's version so the next attempt uses the right expected_version.
            await queryClient
              .fetchQuery({
                queryKey: liveKeys.quiz(quizId),
                queryFn: ({ signal }) => getLiveQuiz(quizId, { signal }),
                staleTime: 0
              })
              .then((fresh) => queryClient.setQueryData(liveKeys.quiz(quizId), fresh))
              .catch(() => undefined);
          }
          throw error;
        }
      }),
    [queryClient, queue, quizId]
  );

  const dismissConflict = useCallback(() => setConflict(false), []);

  return { run, busy, conflict, dismissConflict, queue };
}
