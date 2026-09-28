"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import {
  fetchCurrentUser,
  loginUser,
  logoutUser,
  registerUser
} from "@/lib/auth/session";
import { queryKeys } from "@/lib/query/keys";
import type {
  ActiveSessionItem,
  AuthUser,
  DomainCatalogResponse,
  EngagementSnapshot,
  Exam,
  QuestionSearchResponse,
  ReadinessScore,
  ReviewQueueSnapshot,
  SessionHistoryItem,
  SessionReview,
  StudyHistoryItem,
  StudyOverview,
  StudyPlanResponse,
  StudySessionReview,
  StudyWeeklyAnalytics,
  WeakAreasResponse
} from "@/types/api";

export { queryKeys } from "@/lib/query/keys";

const STAFF_ROLES = new Set(["editor", "reviewer", "admin"]);

// ---------------------------------------------------------------------------
// Auth / current user (single source of truth for /auth/me)
// ---------------------------------------------------------------------------

/** The only hook that should read /auth/me. Shared cache key: ["current-user"]. */
export function useCurrentUser(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: ({ signal }) => fetchCurrentUser(signal),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true
  });
}

/** @deprecated alias kept for older imports. */
export const useCurrentUserQuery = useCurrentUser;

export function useSessionRole() {
  const query = useCurrentUser();
  const user = query.data ?? null;
  const role = String(user?.role || "");
  return {
    query,
    user,
    role,
    isAuthenticated: !!user,
    isAdmin: role === "admin",
    isStaff: STAFF_ROLES.has(role),
    isResolved: query.isFetched || query.isError
  };
}

function refreshUserScopedData(queryClient: QueryClient) {
  // Anonymous sessions/study state are claimed on login; everything user-scoped must refetch.
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] !== queryKeys.currentUser[0]
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; password: string }) => loginUser(payload),
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(queryKeys.currentUser, user);
      void refreshUserScopedData(queryClient);
    }
  });
}

export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; password: string; display_name?: string | null }) => registerUser(payload),
    onSuccess: (user: AuthUser) => {
      queryClient.setQueryData(queryKeys.currentUser, user);
      void refreshUserScopedData(queryClient);
    }
  });
}

export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutUser(),
    onSettled: () => {
      queryClient.setQueryData(queryKeys.currentUser, null);
      queryClient.removeQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("admin") });
      void refreshUserScopedData(queryClient);
    }
  });
}

/** Stores a user returned by another endpoint (e.g. /auth/verify-email) in the shared cache. */
export function useSetCurrentUser() {
  const queryClient = useQueryClient();
  return (user: AuthUser | null) => queryClient.setQueryData(queryKeys.currentUser, user);
}

// ---------------------------------------------------------------------------
// Catalog / discovery
// ---------------------------------------------------------------------------

export function useExamsQuery() {
  return useQuery({
    queryKey: queryKeys.exams,
    queryFn: ({ signal }) => apiClient.get<Exam[]>("/exams", { signal }),
    staleTime: 5 * 60_000
  });
}

export function useDomainsQuery(examId: string) {
  return useQuery({
    queryKey: queryKeys.domains(examId),
    queryFn: ({ signal }) => {
      const query = examId ? `?exam_id=${encodeURIComponent(examId)}` : "";
      return apiClient.get<DomainCatalogResponse>(`/domains${query}`, { signal });
    },
    staleTime: 5 * 60_000
  });
}

export function useQuestionSearchQuery(params: URLSearchParams) {
  const serialized = params.toString();
  return useQuery({
    queryKey: queryKeys.questionSearch(serialized),
    queryFn: ({ signal }) => apiClient.get<QuestionSearchResponse>(`/questions/search?${serialized}`, { signal }),
    placeholderData: (previous) => previous
  });
}

// ---------------------------------------------------------------------------
// Dashboard / analytics
// ---------------------------------------------------------------------------

export function useStudyPlanQuery() {
  return useQuery({
    queryKey: queryKeys.studyPlan,
    queryFn: ({ signal }) => apiClient.get<StudyPlanResponse>("/study/plan", { signal })
  });
}

export function useStudyOverviewQuery() {
  return useQuery({
    queryKey: queryKeys.studyOverview,
    queryFn: ({ signal }) => apiClient.get<StudyOverview>("/study/overview", { signal })
  });
}

export function useWeakAreasQuery() {
  return useQuery({
    queryKey: queryKeys.weakAreas,
    queryFn: ({ signal }) => apiClient.get<WeakAreasResponse>("/analytics/weak-areas", { signal })
  });
}

export function useEngagementQuery() {
  return useQuery({
    queryKey: queryKeys.engagement,
    queryFn: ({ signal }) => apiClient.get<EngagementSnapshot>("/analytics/engagement", { signal })
  });
}

export function useReadinessQuery() {
  return useQuery({
    queryKey: queryKeys.readiness,
    queryFn: ({ signal }) => apiClient.get<ReadinessScore>("/analytics/readiness", { signal })
  });
}

export function useExamHistoryQuery(limit: number) {
  return useQuery({
    queryKey: queryKeys.examHistory(limit),
    queryFn: ({ signal }) => apiClient.get<SessionHistoryItem[]>(`/sessions/history?limit=${limit}`, { signal })
  });
}

export function useStudyHistoryQuery(limit: number) {
  return useQuery({
    queryKey: queryKeys.studyHistory(limit),
    queryFn: ({ signal }) => apiClient.get<StudyHistoryItem[]>(`/study/history?limit=${limit}`, { signal })
  });
}

export function useStudyWeeklyQuery(weeks: number) {
  return useQuery({
    queryKey: queryKeys.studyWeekly(weeks),
    queryFn: ({ signal }) => apiClient.get<StudyWeeklyAnalytics>(`/study/analytics/weekly?weeks=${weeks}`, { signal })
  });
}

export function useActiveExamSessionsQuery(limit: number) {
  return useQuery({
    queryKey: queryKeys.activeExamSessions(limit),
    queryFn: ({ signal }) => apiClient.get<ActiveSessionItem[]>(`/sessions/active?limit=${limit}`, { signal })
  });
}

export function useActiveStudySessionsQuery(limit: number) {
  return useQuery({
    queryKey: queryKeys.activeStudySessions(limit),
    queryFn: ({ signal }) => apiClient.get<ActiveSessionItem[]>(`/study/sessions/active?limit=${limit}`, { signal })
  });
}

export function useReviewQueueQuery(params: URLSearchParams) {
  const serialized = params.toString();
  return useQuery({
    queryKey: queryKeys.reviewQueue(serialized),
    queryFn: ({ signal }) => apiClient.get<ReviewQueueSnapshot>(`/study/review/queue?${serialized}`, { signal }),
    placeholderData: (previous) => previous
  });
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function useSessionReviewQuery(mode: "exam" | "study", sessionId: string) {
  return useQuery({
    queryKey: queryKeys.sessionReview(mode, sessionId),
    queryFn: ({ signal }) => {
      const basePath = mode === "study" ? "/study/sessions" : "/sessions";
      return apiClient.get<SessionReview | StudySessionReview>(`${basePath}/${encodeURIComponent(sessionId)}/review`, {
        signal
      });
    },
    enabled: !!sessionId
  });
}
