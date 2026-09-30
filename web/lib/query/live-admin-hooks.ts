"use client";

/**
 * React Query bindings for the Sentinel Arena admin (lib/api/live-admin.ts). Keys start with
 * "admin" so logout drops them by prefix; every mutation refreshes the lists it can change
 * (a case action may end sessions, so the overview is refreshed too).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  addLiveTerm,
  deleteLiveTerm,
  forceEndLiveSession,
  getLiveAdminOverview,
  listLiveAudit,
  listLiveCases,
  listLiveTerms,
  resolveLiveCase,
  type LiveCasesParams
} from "@/lib/api/live-admin";
import type { LiveCaseAction, LiveModerationTermInput } from "@/types/api";

export const liveAdminKeys = {
  all: ["admin-live"] as const,
  overview: ["admin-live", "overview"] as const,
  casesPrefix: ["admin-live", "cases"] as const,
  cases: (params: LiveCasesParams) => ["admin-live", "cases", params.status, params.limit ?? 50, params.offset ?? 0] as const,
  terms: ["admin-live", "terms"] as const,
  audit: (sessionId: string, limit: number) => ["admin-live", "audit", sessionId.trim(), limit] as const
};

interface Enabled {
  enabled?: boolean;
}

/** 401/403 mean "not allowed": never retry them. */
function retryUnlessForbidden(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (status === 401 || status === 403 || status === 404) {
    return false;
  }
  return failureCount < 2;
}

export function useLiveAdminOverview(options: Enabled & { refetchIntervalMs?: number } = {}) {
  return useQuery({
    queryKey: liveAdminKeys.overview,
    queryFn: ({ signal }) => getLiveAdminOverview({ signal }),
    enabled: options.enabled ?? false,
    // Active rooms change by the minute; a gentle poll keeps the table honest while it is open.
    refetchInterval: options.refetchIntervalMs ?? 30_000,
    retry: retryUnlessForbidden
  });
}

export function useLiveAdminCases(params: LiveCasesParams, options: Enabled = {}) {
  return useQuery({
    queryKey: liveAdminKeys.cases(params),
    queryFn: ({ signal }) => listLiveCases(params, { signal }),
    enabled: options.enabled ?? false,
    placeholderData: keepPreviousData,
    retry: retryUnlessForbidden
  });
}

export function useLiveAdminTerms(options: Enabled = {}) {
  return useQuery({
    queryKey: liveAdminKeys.terms,
    queryFn: ({ signal }) => listLiveTerms({ signal }),
    enabled: options.enabled ?? false,
    retry: retryUnlessForbidden
  });
}

export function useLiveAdminAudit(sessionId: string, options: Enabled & { limit?: number } = {}) {
  const limit = options.limit ?? 100;
  return useQuery({
    queryKey: liveAdminKeys.audit(sessionId, limit),
    queryFn: ({ signal }) => listLiveAudit({ sessionId, limit }, { signal }),
    enabled: options.enabled ?? false,
    placeholderData: keepPreviousData,
    retry: retryUnlessForbidden
  });
}

export function useResolveLiveCase() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, action, note }: { caseId: string; action: LiveCaseAction; note?: string }) => resolveLiveCase(caseId, action, note),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: liveAdminKeys.casesPrefix });
      void queryClient.invalidateQueries({ queryKey: liveAdminKeys.overview });
    }
  });
}

export function useForceEndLiveSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, reason }: { sessionId: string; reason: string }) => forceEndLiveSession(sessionId, reason),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: liveAdminKeys.overview });
    }
  });
}

export function useAddLiveTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LiveModerationTermInput) => addLiveTerm(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: liveAdminKeys.terms });
    }
  });
}

export function useDeleteLiveTerm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (termId: string) => deleteLiveTerm(termId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: liveAdminKeys.terms });
    }
  });
}
