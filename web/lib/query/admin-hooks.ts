"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { API_TIMEOUTS, apiClient, readCountHeader } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import type {
  AdminAnalyticsSnapshotCapture,
  AdminAuditLog,
  AdminCreateExamInput,
  AdminDomainCatalogPage,
  AdminIngestResponse,
  AdminMutationResponse,
  AdminOverview,
  AdminQuestion,
  AdminQuestionAnalytics,
  AdminQuestionAnalyticsSnapshot,
  AdminQuestionInput,
  AdminQuestionIssueUpdateInput,
  AdminQuestionStatusFilter,
  AdminQuestionSummary,
  AdminQuestionVersion,
  AdminUser,
  AdminUserUpdateInput,
  QuestionIssue
} from "@/types/api";

/** Admin queries only run once the current user's role allows them (pass `enabled`). */
interface AdminQueryOptions {
  enabled?: boolean;
}

/** 401/403 on admin endpoints mean "not allowed": never retry them, never swap in the bearer fallback. */
const ADMIN_REQUEST = { retryOnUnauthorized: false } as const;

/** Every admin key starts with "admin" so logout can drop them by prefix. */
export const adminKeys = {
  users: ["admin-users"] as const,
  issues: ["admin-issues"] as const,
  overview: ["admin-overview"] as const,
  analytics: ["admin-analytics"] as const,
  questions: (params: AdminQuestionListParams) =>
    [
      "admin-questions",
      params.examId,
      params.search.trim(),
      params.status ?? "active",
      params.needsReview ?? null,
      params.explanationMissing ?? null
    ] as const,
  questionsPrefix: ["admin-questions"] as const,
  question: (questionId: string) => ["admin-question", questionId] as const,
  versions: (questionId: string) => ["admin-question-versions", questionId] as const,
  audit: (questionId: string) => ["admin-question-audit", questionId] as const,
  history: (questionId: string) => ["admin-question-history", questionId] as const
};

function encode(value: string): string {
  return encodeURIComponent(value);
}

/** GET /admin/questions filters (backend admin.py admin_list_questions). */
export interface AdminQuestionListParams {
  examId: string;
  search: string;
  /** Question.is_active filter; the backend defaults to "active". */
  status?: AdminQuestionStatusFilter;
  /** undefined/null = no filter on the ingest flag. */
  needsReview?: boolean | null;
  explanationMissing?: boolean | null;
}

// ---------------------------------------------------------------------------
// Users / domain catalog / issues (panels)
// ---------------------------------------------------------------------------

/** Page size for GET /admin/users (backend default limit is 500; we page explicitly). */
export const ADMIN_USERS_PAGE_SIZE = 50;

export interface AdminUsersPage {
  users: AdminUser[];
  /** From X-Total-Count; null when the header is missing (e.g. not exposed via CORS). */
  total: number | null;
  page: number;
  pageSize: number;
}

/** `page` is 0-based. Uses limit/offset and reads the total from `X-Total-Count`. */
export function useAdminUsersQuery(page = 0, options?: AdminQueryOptions) {
  const safePage = Math.max(0, Math.floor(page));
  return useQuery({
    queryKey: [...adminKeys.users, safePage, ADMIN_USERS_PAGE_SIZE] as const,
    queryFn: async ({ signal }): Promise<AdminUsersPage> => {
      const query = new URLSearchParams({
        limit: String(ADMIN_USERS_PAGE_SIZE),
        offset: String(safePage * ADMIN_USERS_PAGE_SIZE)
      });
      const { data, headers } = await apiClient.getWithHeaders<AdminUser[]>(`/admin/users?${query.toString()}`, {
        ...ADMIN_REQUEST,
        signal
      });
      return { users: data ?? [], total: readCountHeader(headers), page: safePage, pageSize: ADMIN_USERS_PAGE_SIZE };
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? false
  });
}

export function useAdminDomainCatalogQuery(
  params?: { certification?: string; search?: string; page?: number },
  options?: AdminQueryOptions
) {
  const query = new URLSearchParams();
  if (params?.certification) {
    query.set("certification", params.certification);
  }
  if (params?.search) {
    query.set("search", params.search);
  }
  query.set("page", String(params?.page || 1));
  query.set("page_size", "12");
  return useQuery({
    queryKey: ["admin-domain-catalog", params?.certification || "", params?.search || "", params?.page || 1],
    queryFn: ({ signal }) =>
      apiClient.get<AdminDomainCatalogPage>(`/admin/domain-catalog?${query.toString()}`, { ...ADMIN_REQUEST, signal }),
    enabled: options?.enabled ?? false,
    placeholderData: (previous) => previous
  });
}

export function useAdminIssuesQuery(
  params?: {
    status?: string;
    category?: string;
    certification?: string;
    questionId?: string;
    assignedState?: string;
    limit?: number;
  },
  options?: AdminQueryOptions
) {
  const query = new URLSearchParams();
  if (params?.status) {
    query.set("status", params.status);
  }
  if (params?.category) {
    query.set("category", params.category);
  }
  if (params?.certification) {
    query.set("certification", params.certification);
  }
  if (params?.questionId) {
    query.set("question_id", params.questionId);
  }
  if (params?.assignedState) {
    query.set("assigned_state", params.assignedState);
  }
  query.set("limit", String(params?.limit ?? 12));
  return useQuery({
    queryKey: [
      ...adminKeys.issues,
      params?.status || "",
      params?.category || "",
      params?.certification || "",
      params?.questionId || "",
      params?.assignedState || "",
      params?.limit ?? 12
    ],
    queryFn: ({ signal }) =>
      apiClient.get<QuestionIssue[]>(`/admin/question-issues?${query.toString()}`, { ...ADMIN_REQUEST, signal }),
    enabled: options?.enabled ?? false
  });
}

export function useAdminUpdateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: AdminUserUpdateInput }) =>
      apiClient.patch<AdminUser>(`/admin/users/${encode(userId)}`, payload, ADMIN_REQUEST),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.users });
    }
  });
}

export function useAdminUpdateIssueMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, payload }: { issueId: number; payload: AdminQuestionIssueUpdateInput }) =>
      apiClient.patch<QuestionIssue>(`/admin/question-issues/${encode(String(issueId))}`, payload, ADMIN_REQUEST),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.issues });
    }
  });
}

export function useAdminAssignIssueVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueId: number) =>
      apiClient.post<QuestionIssue>(`/admin/question-issues/${encode(String(issueId))}/assign-current-version`, undefined, ADMIN_REQUEST),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.issues });
    }
  });
}

// ---------------------------------------------------------------------------
// Overview / analytics / question bank
// ---------------------------------------------------------------------------

export function useAdminOverviewQuery(options?: AdminQueryOptions) {
  return useQuery({
    queryKey: adminKeys.overview,
    queryFn: ({ signal }) => apiClient.get<AdminOverview>("/admin/overview", { ...ADMIN_REQUEST, signal }),
    enabled: options?.enabled ?? false
  });
}

export function useAdminAnalyticsQuery(options?: AdminQueryOptions) {
  return useQuery({
    queryKey: adminKeys.analytics,
    queryFn: ({ signal }) =>
      apiClient.get<AdminQuestionAnalytics>("/admin/analytics/questions?limit=8", { ...ADMIN_REQUEST, signal }),
    enabled: options?.enabled ?? false
  });
}

export function useAdminQuestionListQuery(params: AdminQuestionListParams, options?: AdminQueryOptions) {
  const search = params.search.trim();
  return useQuery({
    queryKey: adminKeys.questions(params),
    queryFn: ({ signal }) => {
      const query = new URLSearchParams();
      query.set("limit", "200");
      query.set("status", params.status ?? "active");
      if (params.examId) {
        query.set("exam_id", params.examId);
      }
      if (search) {
        query.set("search", search);
      }
      if (typeof params.needsReview === "boolean") {
        query.set("needs_review", String(params.needsReview));
      }
      if (typeof params.explanationMissing === "boolean") {
        query.set("explanation_missing", String(params.explanationMissing));
      }
      return apiClient.get<AdminQuestionSummary[]>(`/admin/questions?${query.toString()}`, { ...ADMIN_REQUEST, signal });
    },
    enabled: options?.enabled ?? false,
    placeholderData: (previous) => previous
  });
}

export function fetchAdminQuestion(queryClient: QueryClient, questionId: string) {
  return queryClient.fetchQuery({
    queryKey: adminKeys.question(questionId),
    queryFn: ({ signal }) => apiClient.get<AdminQuestion>(`/admin/questions/${encode(questionId)}`, { ...ADMIN_REQUEST, signal }),
    staleTime: 0
  });
}

export function useAdminQuestionVersionsQuery(questionId: string | null, options?: AdminQueryOptions) {
  return useQuery({
    queryKey: adminKeys.versions(questionId || ""),
    queryFn: ({ signal }) =>
      apiClient.get<AdminQuestionVersion[]>(`/admin/questions/${encode(questionId || "")}/versions`, { ...ADMIN_REQUEST, signal }),
    enabled: Boolean(questionId) && (options?.enabled ?? false)
  });
}

export function useAdminQuestionAuditQuery(questionId: string | null, options?: AdminQueryOptions) {
  return useQuery({
    queryKey: adminKeys.audit(questionId || ""),
    queryFn: ({ signal }) =>
      apiClient.get<AdminAuditLog[]>(`/admin/audit/logs?question_id=${encode(questionId || "")}&limit=20`, {
        ...ADMIN_REQUEST,
        signal
      }),
    enabled: Boolean(questionId) && (options?.enabled ?? false)
  });
}

export function useAdminQuestionHistoryQuery(questionId: string | null, options?: AdminQueryOptions) {
  return useQuery({
    queryKey: adminKeys.history(questionId || ""),
    queryFn: ({ signal }) =>
      apiClient.get<AdminQuestionAnalyticsSnapshot[]>(
        `/admin/questions/${encode(questionId || "")}/analytics-history?limit=12`,
        { ...ADMIN_REQUEST, signal }
      ),
    enabled: Boolean(questionId) && (options?.enabled ?? false)
  });
}

function invalidateAdminData(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("admin") });
}

function invalidateQuestion(queryClient: QueryClient, questionId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: adminKeys.questionsPrefix }),
    queryClient.invalidateQueries({ queryKey: adminKeys.question(questionId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.versions(questionId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.audit(questionId) }),
    queryClient.invalidateQueries({ queryKey: adminKeys.overview }),
    queryClient.invalidateQueries({ queryKey: adminKeys.analytics })
  ]);
}

/** Refetches every admin query plus the exam catalog (toolbar "Refresh"). */
export function refreshAdminData(queryClient: QueryClient) {
  return Promise.all([
    queryClient.refetchQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("admin"), type: "active" }),
    queryClient.invalidateQueries({ queryKey: queryKeys.exams })
  ]);
}

// ---------------------------------------------------------------------------
// Maintenance mutations (long-running: 120s timeout)
// ---------------------------------------------------------------------------

export function useAdminIngestMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<AdminIngestResponse>("/admin/ingest", {}, {
        ...ADMIN_REQUEST,
        timeoutMs: API_TIMEOUTS.adminLong
      }),
    onSuccess: () => {
      void invalidateAdminData(queryClient);
      void queryClient.invalidateQueries({ queryKey: queryKeys.exams });
    }
  });
}

/** GET /admin/export (admin.py admin_export_db) as a blob download with timeout + error parsing. */
export function useAdminExportMutation() {
  return useMutation({
    mutationFn: () => apiClient.download("/admin/export", { ...ADMIN_REQUEST, timeoutMs: API_TIMEOUTS.adminLong })
  });
}

export function useAdminCaptureSnapshotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient.post<AdminAnalyticsSnapshotCapture>("/admin/analytics/questions/snapshots", {}, {
        ...ADMIN_REQUEST,
        timeoutMs: API_TIMEOUTS.adminLong
      }),
    onSuccess: (response) => {
      if (response.schema_ready) {
        void queryClient.invalidateQueries({ queryKey: adminKeys.analytics });
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "admin-question-history" });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Editorial mutations
// ---------------------------------------------------------------------------

export function useAdminSaveExamMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminCreateExamInput) => apiClient.post<AdminMutationResponse>("/admin/exams", payload, ADMIN_REQUEST),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.exams });
      void queryClient.invalidateQueries({ queryKey: adminKeys.overview });
    }
  });
}

export function useAdminSaveQuestionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminQuestionInput) => apiClient.post<AdminMutationResponse>("/admin/questions", payload, ADMIN_REQUEST),
    onSuccess: (_response, payload) => invalidateQuestion(queryClient, payload.id)
  });
}

export type AdminQuestionAction =
  | { kind: "submit-review" | "approve" | "publish"; questionId: string; reason: string | null }
  | { kind: "rollback"; questionId: string; versionId: number; reason: string | null }
  /** DELETE = deactivate (soft delete); "reactivate" undoes it. */
  | { kind: "delete"; questionId: string }
  | { kind: "reactivate"; questionId: string; reason: string | null };

export function useAdminQuestionActionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AdminQuestionAction) => {
      const base = `/admin/questions/${encode(action.questionId)}`;
      switch (action.kind) {
        case "delete":
          return apiClient.delete<AdminMutationResponse>(base, ADMIN_REQUEST);
        case "reactivate":
          return apiClient.post<AdminMutationResponse>(`${base}/reactivate`, { reason: action.reason }, ADMIN_REQUEST);
        case "rollback":
          return apiClient.post<AdminMutationResponse>(
            `${base}/rollback`,
            { version_id: action.versionId, reason: action.reason },
            ADMIN_REQUEST
          );
        default:
          return apiClient.post<AdminMutationResponse>(`${base}/${action.kind}`, { reason: action.reason }, ADMIN_REQUEST);
      }
    },
    onSuccess: (_response, action) => invalidateQuestion(queryClient, action.questionId)
  });
}
