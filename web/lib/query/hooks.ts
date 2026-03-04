"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { fetchCurrentUser } from "@/lib/auth/session";
import type {
  AdminDomainCatalogPage,
  AdminQuestionIssueUpdateInput,
  AuthUser,
  AdminUser,
  AdminUserUpdateInput,
  QuestionIssue,
  StudyPlanResponse,
} from "@/types/api";

export function useCurrentUserQuery() {
  return useQuery({
    queryKey: ["current-user"],
    queryFn: () => fetchCurrentUser(),
    staleTime: 60_000,
  });
}

export function useStudyPlanQuery() {
  return useQuery({
    queryKey: ["study-plan"],
    queryFn: () => apiClient.get<StudyPlanResponse>("/study/plan"),
  });
}

export function useAdminUsersQuery() {
  return useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiClient.get<AdminUser[]>("/admin/users", { retryOnUnauthorized: false }),
  });
}

export function useAdminDomainCatalogQuery(params?: { certification?: string; search?: string; page?: number }) {
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
    queryFn: () => apiClient.get<AdminDomainCatalogPage>(`/admin/domain-catalog?${query.toString()}`, { retryOnUnauthorized: false }),
  });
}

export function useAdminIssuesQuery(params?: {
  status?: string;
  category?: string;
  certification?: string;
  questionId?: string;
  assignedState?: string;
}) {
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
  query.set("limit", "12");
  return useQuery({
    queryKey: [
      "admin-issues",
      params?.status || "",
      params?.category || "",
      params?.certification || "",
      params?.questionId || "",
      params?.assignedState || "",
    ],
    queryFn: () => apiClient.get<QuestionIssue[]>(`/admin/question-issues?${query.toString()}`, { retryOnUnauthorized: false }),
  });
}

export function useAdminUpdateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: AdminUserUpdateInput }) =>
      apiClient.patch<AdminUser>(`/admin/users/${encodeURIComponent(userId)}`, payload, { retryOnUnauthorized: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export function useAdminUpdateIssueMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, payload }: { issueId: number; payload: AdminQuestionIssueUpdateInput }) =>
      apiClient.patch<QuestionIssue>(`/admin/question-issues/${issueId}`, payload, { retryOnUnauthorized: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-issues"] });
    },
  });
}

export function useAdminAssignIssueVersionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (issueId: number) =>
      apiClient.post<QuestionIssue>(`/admin/question-issues/${issueId}/assign-current-version`, undefined, { retryOnUnauthorized: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-issues"] });
    },
  });
}
