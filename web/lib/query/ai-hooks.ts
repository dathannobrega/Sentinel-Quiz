"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  applyAiJob,
  createFromSourceJob,
  createGenerateJob,
  createImproveJob,
  getAiCapabilities,
  getAiJob,
  isAiAlreadyApplied,
  isAiJobNotFound,
  isAiQuotaExceeded,
  isJobActive,
  jobRefetchInterval,
  listAiJobs,
  markDraftsApplied,
  sampleBank,
  suggestItemFormat
} from "@/lib/api/ai-authoring";
import type { QuizMutator } from "@/lib/query/live-hooks";
import type {
  AiFromSourceIn,
  AiGenerateIn,
  AiImproveIn,
  AiJob,
  AiSuggestFormatIn,
  LiveBankSampleIn,
  LiveQuizDetail
} from "@/types/api";

/** Prefixed with "live" so auth changes drop them together with the other Sentinel Arena keys. */
export const aiKeys = {
  all: ["live", "ai"] as const,
  capabilities: ["live", "ai", "capabilities"] as const,
  jobs: (quizId: string) => ["live", "ai", "jobs", quizId] as const,
  job: (jobId: string) => ["live", "ai", "job", jobId] as const
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAiCapabilities(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: aiKeys.capabilities,
    queryFn: ({ signal }) => getAiCapabilities({ signal }),
    staleTime: 60_000,
    retry: false,
    enabled: options?.enabled ?? true
  });
}

/**
 * One AI job, polled every 1.5 s while it is queued/running and not polled once it finished.
 * Polling pauses while the tab is hidden (react-query skips intervals in the background) and
 * resumes with an immediate refetch when the tab becomes visible again.
 */
export function useAiJob(jobId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: aiKeys.job(jobId ?? ""),
    queryFn: ({ signal }) => getAiJob(jobId as string, { signal }),
    enabled: Boolean(jobId),
    refetchInterval: (current) => {
      // A job that never loaded (404, network down) is not polled forever.
      if (current.state.status === "error" && !current.state.data) return false;
      return jobRefetchInterval(current.state.data);
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: (current) => (current.state.data && !isJobActive(current.state.data.status) ? Infinity : 0),
    retry: (count, error) => !isAiJobNotFound(error) && count < 2
  });

  // When the job finishes, credits may have been refunded and the recent list changed.
  const status = query.data?.status;
  const quizId = query.data?.quiz_id;
  const previous = useRef(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (was && isJobActive(was) && status && !isJobActive(status)) {
      void queryClient.invalidateQueries({ queryKey: aiKeys.capabilities });
      if (quizId) void queryClient.invalidateQueries({ queryKey: aiKeys.jobs(quizId) });
    }
  }, [queryClient, quizId, status]);

  return query;
}

/** Recent jobs of the user for a quiz ("Gerações recentes"). */
export function useAiJobs(quizId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: aiKeys.jobs(quizId),
    queryFn: ({ signal }) => listAiJobs(quizId, { signal }),
    enabled: (options?.enabled ?? true) && Boolean(quizId),
    refetchInterval: (current) => (current.state.data?.some((job) => isJobActive(job.status)) ? 5_000 : false)
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CreateAiJobInput =
  | { kind: "generate"; input: AiGenerateIn }
  | { kind: "from_source"; input: AiFromSourceIn }
  | { kind: "improve"; itemId: string; input: AiImproveIn };

export function createAiJob(variables: CreateAiJobInput): Promise<AiJob> {
  switch (variables.kind) {
    case "generate":
      return createGenerateJob(variables.input);
    case "from_source":
      return createFromSourceJob(variables.input);
    case "improve":
      return createImproveJob(variables.itemId, variables.input);
  }
}

/** Starts a generate / from-source / improve job. The job is seeded in the cache for polling. */
export function useCreateAiJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAiJob,
    onSuccess: (job) => {
      queryClient.setQueryData(aiKeys.job(job.id), job);
      void queryClient.invalidateQueries({ queryKey: aiKeys.capabilities });
      void queryClient.invalidateQueries({ queryKey: aiKeys.jobs(job.quiz_id) });
    },
    onError: (error) => {
      if (isAiQuotaExceeded(error)) {
        void queryClient.invalidateQueries({ queryKey: aiKeys.capabilities });
      }
    }
  });
}

export interface ApplyAiJobInput {
  jobId: string;
  indexes: number[];
  force?: boolean;
}

/**
 * Applies drafts (or an improvement proposal) to the quiz. The request runs through the editor's
 * serialized QuizMutator — after `beforeApply` (flush of pending autosave edits) — so it reads the
 * `version` produced by the previous save and never races autosave; the returned QuizDetail is
 * written to the quiz cache by the mutator (never moving `version` backwards).
 */
export function useApplyAiJob(quizId: string, mutator: Pick<QuizMutator, "run">, options?: { beforeApply?: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const beforeApply = options?.beforeApply;
  return useMutation({
    mutationFn: async ({ jobId, indexes, force }: ApplyAiJobInput): Promise<LiveQuizDetail> => {
      await beforeApply?.();
      return mutator.run((version) =>
        applyAiJob(jobId, { quiz_id: quizId, expected_version: version, indexes, ...(force ? { force: true } : {}) })
      );
    },
    onSuccess: (_detail, { jobId, indexes }) => {
      queryClient.setQueryData<AiJob>(aiKeys.job(jobId), (job) => (job ? markDraftsApplied(job, indexes) : job));
      void queryClient.invalidateQueries({ queryKey: aiKeys.job(jobId) });
    },
    onError: (error, { jobId }) => {
      if (isAiAlreadyApplied(error)) {
        void queryClient.invalidateQueries({ queryKey: aiKeys.job(jobId) });
      }
    }
  });
}

/** Deterministic bank draw (POST /api/live/bank/sample). */
export function useBankSample() {
  return useMutation({ mutationFn: (payload: LiveBankSampleIn) => sampleBank(payload) });
}

/** Deterministic time-limit suggestion (POST /api/ai/items/suggest-format). */
export function useSuggestFormat() {
  return useMutation({ mutationFn: (payload: AiSuggestFormatIn) => suggestItemFormat(payload) });
}
