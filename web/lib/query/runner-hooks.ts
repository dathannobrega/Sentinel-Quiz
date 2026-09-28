"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type {
  ExamQuestionState,
  ExamReviewScreen,
  SessionResponse,
  StudyNextQuestionResponse,
  StudySessionResponse,
  StudyState
} from "@/types/api";

export type RunnerMode = "exam" | "study";

/** Query keys for the session runner. All start with "runner" so they can be invalidated together. */
export const runnerKeys = {
  all: ["runner"] as const,
  session: (mode: RunnerMode, sessionId: string) => ["runner", mode, "session", sessionId] as const,
  examQuestion: (sessionId: string, position: number) => ["runner", "exam", "question", sessionId, position] as const,
  examQuestions: (sessionId: string) => ["runner", "exam", "question", sessionId] as const,
  studyQuestion: (sessionId: string, cursor: string) => ["runner", "study", "next", sessionId, cursor] as const,
  reviewScreen: (sessionId: string) => ["runner", "exam", "review-screen", sessionId] as const,
  studyState: (questionId: string) => ["runner", "study-state", questionId] as const
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

export function useExamSessionQuery(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: runnerKeys.session("exam", sessionId),
    queryFn: ({ signal }) => apiClient.get<SessionResponse>(`/sessions/${encode(sessionId)}`, { signal }),
    enabled,
    staleTime: 0
  });
}

export function useStudySessionQuery(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: runnerKeys.session("study", sessionId),
    queryFn: ({ signal }) => apiClient.get<StudySessionResponse>(`/study/sessions/${encode(sessionId)}`, { signal }),
    enabled,
    staleTime: 0
  });
}

/** GET /sessions/{id}/questions/{position} (also moves the server-side cursor). */
export function useExamQuestionQuery(sessionId: string, position: number | null) {
  return useQuery({
    queryKey: runnerKeys.examQuestion(sessionId, position ?? -1),
    queryFn: ({ signal }) =>
      apiClient.get<ExamQuestionState>(`/sessions/${encode(sessionId)}/questions/${position ?? 0}`, { signal }),
    enabled: position !== null,
    staleTime: 0,
    gcTime: 60_000,
    // Keep showing the previous question while the next one loads (no skeleton flash).
    placeholderData: (previous) => previous
  });
}

/**
 * GET /study/sessions/{id}/next returns the question at the server cursor, which advances after
 * each answer. `cursor` is a per-mount token + step counter bumped on "next", so a cached entry is never re-fetched
 * for the same step (that would skip a question).
 */
export function useStudyQuestionQuery(sessionId: string, cursor: string, enabled: boolean) {
  return useQuery({
    queryKey: runnerKeys.studyQuestion(sessionId, cursor),
    queryFn: ({ signal }) =>
      apiClient.get<StudyNextQuestionResponse>(`/study/sessions/${encode(sessionId)}/next`, { signal }),
    enabled,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
    gcTime: 5 * 60_000,
    placeholderData: (previous) => previous
  });
}

export function useExamReviewScreenQuery(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: runnerKeys.reviewScreen(sessionId),
    queryFn: ({ signal }) => apiClient.get<ExamReviewScreen>(`/sessions/${encode(sessionId)}/review-screen`, { signal }),
    enabled,
    staleTime: 0
  });
}

export function useStudyQuestionStateQuery(questionId: string | null) {
  return useQuery({
    queryKey: runnerKeys.studyState(questionId ?? ""),
    queryFn: ({ signal }) => apiClient.get<StudyState>(`/study/questions/${encode(questionId ?? "")}/state`, { signal }),
    enabled: !!questionId,
    staleTime: 30_000
  });
}
