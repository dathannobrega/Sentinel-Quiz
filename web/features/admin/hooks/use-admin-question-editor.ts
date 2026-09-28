"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { useI18n } from "@/lib/i18n";
import {
  fetchAdminQuestion,
  useAdminQuestionActionMutation,
  useAdminQuestionAuditQuery,
  useAdminQuestionHistoryQuery,
  useAdminQuestionVersionsQuery,
  useAdminSaveQuestionMutation
} from "@/lib/query/admin-hooks";

import type { AdminTask, QuestionDraft, QuestionQuality, QuestionWorkflowAction } from "@/features/admin/types";
import { readAdminError, versionSuffix } from "@/features/admin/utils/admin-errors";
import {
  buildQuestionPayload,
  createEmptyQuestionDraft,
  toQuestionDraft,
  validateQuestionPayload
} from "@/features/admin/utils/question-draft";

export interface AdminPermissions {
  canEdit: boolean;
  canReview: boolean;
  canAdmin: boolean;
}

interface UseAdminQuestionEditorOptions {
  initialQuestionId: string | null;
  editorOnly: boolean;
  /** Exam preselected for new drafts (browser filter or exam form). */
  preferredExamId: string;
  permissions: AdminPermissions;
}

const WORKFLOW_COPY: Record<
  QuestionWorkflowAction,
  { task: AdminTask; permission: keyof AdminPermissions; permissionKey: string; missingKey: string; successKey: string; failureKey: string }
> = {
  "submit-review": {
    task: "submitReview",
    permission: "canEdit",
    permissionKey: "admin.misc.editorRequiredAction",
    missingKey: "admin.misc.saveBeforeReview",
    successKey: "admin.misc.submittedForReview",
    failureKey: "admin.misc.reviewSendFailed"
  },
  approve: {
    task: "approveQuestion",
    permission: "canReview",
    permissionKey: "admin.misc.reviewerRequiredAction",
    missingKey: "admin.misc.saveBeforeApprove",
    successKey: "admin.misc.approved",
    failureKey: "admin.misc.approveFailed"
  },
  publish: {
    task: "publishQuestion",
    permission: "canAdmin",
    permissionKey: "admin.misc.adminRequiredAction",
    missingKey: "admin.misc.saveBeforePublish",
    successKey: "admin.misc.published",
    failureKey: "admin.misc.publishFailed"
  }
};

export function useAdminQuestionEditor({ initialQuestionId, editorOnly, preferredExamId, permissions }: UseAdminQuestionEditorOptions) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const saveQuestionMutation = useAdminSaveQuestionMutation();
  const questionActionMutation = useAdminQuestionActionMutation();

  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(() => createEmptyQuestionDraft(preferredExamId));
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [questionQuality, setQuestionQuality] = useState<QuestionQuality | null>(null);
  const [qualitySignature, setQualitySignature] = useState("");
  const [questionNotice, setQuestionNotice] = useState<string | null>(() =>
    editorOnly && !initialQuestionId ? t("admin.misc.freshDraftReady") : null
  );
  const [isQuestionLoading, setIsQuestionLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<AdminTask | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<{ versionId: number; versionNumber: number } | null>(null);

  const versionsQuery = useAdminQuestionVersionsQuery(selectedQuestionId, { enabled: permissions.canEdit });
  const auditQuery = useAdminQuestionAuditQuery(selectedQuestionId, { enabled: permissions.canEdit });
  const historyQuery = useAdminQuestionHistoryQuery(selectedQuestionId, { enabled: permissions.canEdit });
  const questionVersions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const questionAudit = auditQuery.data ?? [];
  const questionAnalyticsHistory = historyQuery.data ?? [];

  const questionPayload = useMemo(() => buildQuestionPayload(questionDraft), [questionDraft]);
  const questionPayloadSignature = useMemo(() => JSON.stringify(questionPayload), [questionPayload]);
  const validationErrorKey = useMemo(() => validateQuestionPayload(questionPayload), [questionPayload]);
  const hasQuestionDraftContent = Boolean(
    questionDraft.id.trim() ||
      questionDraft.prompt.trim() ||
      questionDraft.changeSummary.trim() ||
      questionDraft.tagsText.trim() ||
      questionDraft.justification.trim() ||
      questionDraft.options.some((item) => item.text.trim()) ||
      questionDraft.citations.some((item) => item.source.trim() || item.reference.trim())
  );
  const currentDraftVersion = useMemo(() => questionVersions.find((item) => item.is_current_draft) || null, [questionVersions]);
  const currentPublishedVersion = useMemo(
    () => questionVersions.find((item) => item.is_current_published) || null,
    [questionVersions]
  );
  const isQualityStale = Boolean(questionQuality && qualitySignature && qualitySignature !== questionPayloadSignature);
  const draftId = questionDraft.id.trim();
  const currentWorkflowStatus = draftId
    ? currentDraftVersion?.status || currentPublishedVersion?.status || "draft"
    : t("admin.form.noDraft");
  const canSubmitForReview = Boolean(draftId && currentDraftVersion?.status === "draft");
  const canApprove = Boolean(draftId && currentDraftVersion?.status === "in_review");
  const canPublish = Boolean(draftId && currentDraftVersion?.status === "approved");
  const workflowError = versionsQuery.error || auditQuery.error || historyQuery.error || null;

  function resetWorkflowState() {
    setSelectedQuestionId(null);
    setQuestionQuality(null);
    setQualitySignature("");
  }

  const loadQuestion = useCallback(
    async (questionId: string, options?: { silent?: boolean }): Promise<boolean> => {
      const targetId = questionId.trim();
      if (!targetId) {
        setQuestionNotice(t("admin.misc.enterQuestionId"));
        return false;
      }
      setIsQuestionLoading(true);
      if (!options?.silent) {
        setQuestionNotice(null);
      }
      try {
        const response = await fetchAdminQuestion(queryClient, targetId);
        const nextDraft = toQuestionDraft(response);
        setQuestionDraft(nextDraft);
        setQuestionQuality((response.quality as QuestionQuality | null) || null);
        setQualitySignature(JSON.stringify(buildQuestionPayload(nextDraft)));
        setSelectedQuestionId(response.id);
        if (!options?.silent) {
          setQuestionNotice(t("admin.misc.questionLoaded", { id: response.id }));
        }
        return true;
      } catch (error) {
        setSelectedQuestionId(null);
        setQuestionQuality(null);
        setQualitySignature("");
        setQuestionNotice(readAdminError(error, t, "admin.misc.questionLoadFailed"));
        return false;
      } finally {
        setIsQuestionLoading(false);
      }
    },
    [queryClient, t]
  );

  // Deep link (/admin/questions/[id]): hydrate once per id.
  const hydratedQuestionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialQuestionId || hydratedQuestionRef.current === initialQuestionId) {
      return;
    }
    hydratedQuestionRef.current = initialQuestionId;
    void loadQuestion(initialQuestionId);
  }, [initialQuestionId, loadQuestion]);

  function updateQuestionDraft(patch: Partial<QuestionDraft>) {
    setQuestionDraft((current) => ({ ...current, ...patch }));
    setQuestionNotice(null);
  }

  function startNewQuestion() {
    resetWorkflowState();
    setQuestionDraft(createEmptyQuestionDraft(preferredExamId || questionDraft.examId));
    setQuestionNotice(t("admin.misc.newDraftCreated"));
  }

  function duplicateQuestion() {
    resetWorkflowState();
    setQuestionDraft((current) => ({
      ...current,
      lookupId: "",
      id: "",
      changeSummary: t("admin.misc.duplicatedSummary")
    }));
    setQuestionNotice(t("admin.misc.duplicateReady"));
  }

  async function saveQuestion() {
    if (!permissions.canEdit) {
      setQuestionNotice(t("admin.misc.editorRequiredAction"));
      return;
    }
    if (validationErrorKey) {
      setQuestionNotice(t(validationErrorKey));
      return;
    }
    setActiveTask("saveQuestion");
    setQuestionNotice(null);
    try {
      const response = await saveQuestionMutation.mutateAsync(questionPayload);
      await loadQuestion(questionPayload.id, { silent: true });
      setQuestionNotice(
        t("admin.misc.draftSaved", { id: questionPayload.id, version: versionSuffix(t, response?.version_number) })
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, t, "admin.misc.questionSaveFailed"));
    } finally {
      setActiveTask(null);
    }
  }

  async function runWorkflow(kind: QuestionWorkflowAction) {
    const copy = WORKFLOW_COPY[kind];
    if (!permissions[copy.permission]) {
      setQuestionNotice(t(copy.permissionKey));
      return;
    }
    if (!draftId) {
      setQuestionNotice(t(copy.missingKey));
      return;
    }
    setActiveTask(copy.task);
    setQuestionNotice(null);
    try {
      const response = await questionActionMutation.mutateAsync({
        kind,
        questionId: draftId,
        reason: questionDraft.changeSummary.trim() || null
      });
      await loadQuestion(draftId, { silent: true });
      setQuestionNotice(t(copy.successKey, { id: draftId, version: versionSuffix(t, response?.version_number) }));
    } catch (error) {
      setQuestionNotice(readAdminError(error, t, copy.failureKey));
    } finally {
      setActiveTask(null);
    }
  }

  function requestRollback(versionId: number, versionNumber: number) {
    if (!permissions.canAdmin) {
      setQuestionNotice(t("admin.misc.adminRequiredAction"));
      return;
    }
    if (!draftId) {
      setQuestionNotice(t("admin.misc.loadBeforeRollback"));
      return;
    }
    setRollbackTarget({ versionId, versionNumber });
  }

  async function confirmRollback(reason: string) {
    if (!rollbackTarget || !draftId) {
      setRollbackTarget(null);
      return;
    }
    setActiveTask("rollbackQuestion");
    setQuestionNotice(null);
    try {
      const response = await questionActionMutation.mutateAsync({
        kind: "rollback",
        questionId: draftId,
        versionId: rollbackTarget.versionId,
        reason: reason.trim() || null
      });
      setRollbackTarget(null);
      await loadQuestion(draftId, { silent: true });
      setQuestionNotice(t("admin.misc.rolledBack", { id: draftId, version: versionSuffix(t, response?.version_number) }));
    } catch (error) {
      setRollbackTarget(null);
      setQuestionNotice(readAdminError(error, t, "admin.misc.rollbackFailed"));
    } finally {
      setActiveTask(null);
    }
  }

  async function deleteQuestion() {
    if (!permissions.canAdmin) {
      setQuestionNotice(t("admin.misc.adminRequiredAction"));
      return;
    }
    if (!draftId) {
      setQuestionNotice(t("admin.misc.noQuestionToDelete"));
      return;
    }
    const accepted = await confirm({
      title: t("admin.misc.confirmDeleteTitle"),
      message: t("admin.misc.confirmDelete", { id: draftId }),
      confirmLabel: t("admin.misc.confirmDeleteAction"),
      tone: "danger"
    });
    if (!accepted) {
      return;
    }
    setActiveTask("deleteQuestion");
    setQuestionNotice(null);
    try {
      await questionActionMutation.mutateAsync({ kind: "delete", questionId: draftId });
      resetWorkflowState();
      setQuestionDraft(createEmptyQuestionDraft(preferredExamId));
      setQuestionNotice(t("admin.misc.questionDeleted", { id: draftId }));
    } catch (error) {
      setQuestionNotice(readAdminError(error, t, "admin.misc.deleteFailed"));
    } finally {
      setActiveTask(null);
    }
  }

  function refetchWorkflow() {
    void versionsQuery.refetch();
    void auditQuery.refetch();
    void historyQuery.refetch();
  }

  return {
    questionDraft,
    setQuestionDraft,
    updateQuestionDraft,
    selectedQuestionId,
    questionQuality,
    isQualityStale,
    questionNotice,
    setQuestionNotice,
    isQuestionLoading,
    activeTask,
    questionPayload,
    validationErrorKey,
    hasQuestionDraftContent,
    questionVersions,
    questionAudit,
    questionAnalyticsHistory,
    currentDraftVersion,
    currentPublishedVersion,
    currentWorkflowStatus,
    canSubmitForReview,
    canApprove,
    canPublish,
    workflowError,
    refetchWorkflow,
    loadQuestion,
    startNewQuestion,
    duplicateQuestion,
    saveQuestion,
    runWorkflow,
    requestRollback,
    confirmRollback,
    cancelRollback: () => setRollbackTarget(null),
    rollbackTarget,
    deleteQuestion,
    confirmDialog
  };
}

export type AdminQuestionEditorState = ReturnType<typeof useAdminQuestionEditor>;
