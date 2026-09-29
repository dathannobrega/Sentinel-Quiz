"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { Page, PageHeader } from "@/components/ui/section";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import {
  useAdminAnalyticsQuery,
  useAdminIssuesQuery,
  useAdminOverviewQuery,
  useAdminQuestionListQuery
} from "@/lib/query/admin-hooks";
import { useExamsQuery } from "@/lib/query/hooks";

import { AdminDomainCatalogPanel } from "@/features/admin/components/admin-domain-catalog-panel";
import { AdminExamManager } from "@/features/admin/components/admin-exam-manager";
import { AdminInsightsCard } from "@/features/admin/components/admin-insights-card";
import { AdminIssuesPanel } from "@/features/admin/components/admin-issues-panel";
import { AdminMaintenanceCard } from "@/features/admin/components/admin-maintenance-card";
import { AdminQuestionBrowser } from "@/features/admin/components/admin-question-browser";
import { AdminRecentIssuesCard } from "@/features/admin/components/admin-recent-issues-card";
import { AdminUsersPanel } from "@/features/admin/components/admin-users-panel";
import { QuestionEditorCard } from "@/features/admin/components/question-editor/question-editor-card";
import { useAdminMaintenance } from "@/features/admin/hooks/use-admin-maintenance";
import { useAdminQuestionEditor, type AdminPermissions } from "@/features/admin/hooks/use-admin-question-editor";
import type { AdminQuestionFilters, ExamDraft } from "@/features/admin/types";
import { readAdminError } from "@/features/admin/utils/admin-errors";
import { userRoleLabel } from "@/features/admin/utils/labels";
import { createEmptyExamDraft, flagFilterValue } from "@/features/admin/utils/question-draft";

const DEFAULT_QUESTION_FILTERS: AdminQuestionFilters = {
  examId: "",
  search: "",
  status: "active",
  needsReview: "any",
  explanationMissing: "any"
};

interface AdminWorkspaceProps {
  editorOnly: boolean;
  initialQuestionId: string | null;
  role: string;
  permissions: AdminPermissions;
}

export function AdminWorkspace({ editorOnly, initialQuestionId, role, permissions }: AdminWorkspaceProps) {
  const { t } = useI18n();
  const [questionFilters, setQuestionFilters] = useState<AdminQuestionFilters>(DEFAULT_QUESTION_FILTERS);
  const browserExamId = questionFilters.examId;
  const deferredQuestionSearch = useDeferredValue(questionFilters.search);
  const [examDraft, setExamDraft] = useState<ExamDraft>(createEmptyExamDraft);

  const panelsEnabled = !editorOnly && permissions.canEdit;
  const examsQuery = useExamsQuery();
  const overviewQuery = useAdminOverviewQuery({ enabled: panelsEnabled });
  const analyticsQuery = useAdminAnalyticsQuery({ enabled: panelsEnabled });
  const questionListQuery = useAdminQuestionListQuery(
    {
      examId: browserExamId,
      search: deferredQuestionSearch,
      status: questionFilters.status,
      needsReview: flagFilterValue(questionFilters.needsReview),
      explanationMissing: flagFilterValue(questionFilters.explanationMissing)
    },
    { enabled: panelsEnabled }
  );
  const recentIssuesQuery = useAdminIssuesQuery({ limit: 8 }, { enabled: panelsEnabled });

  const maintenance = useAdminMaintenance({ canAdmin: permissions.canAdmin, canEdit: permissions.canEdit });
  const editor = useAdminQuestionEditor({
    initialQuestionId,
    editorOnly,
    preferredExamId: browserExamId || examDraft.id,
    permissions
  });
  const exams = examsQuery.data ?? [];
  const draftId = editor.questionDraft.id.trim();

  const failedBlocks = useMemo(
    () =>
      [
        { query: overviewQuery, labelKey: "admin.misc.loadOverview" },
        { query: analyticsQuery, labelKey: "admin.misc.loadAnalytics" },
        { query: questionListQuery, labelKey: "admin.misc.loadQuestionList" },
        { query: recentIssuesQuery, labelKey: "admin.misc.loadIssues" }
      ].filter((item) => item.query.isError),
    [overviewQuery, analyticsQuery, questionListQuery, recentIssuesQuery]
  );

  function handleExamChosen(examId: string, force: boolean) {
    if (force || !editor.questionDraft.examId) {
      editor.updateQuestionDraft({ examId });
    }
  }

  const roleLabel = role ? userRoleLabel(t, role) : t("admin.guard.guestRole");

  const questionsArea = (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-6">
        <AdminQuestionBrowser
          exams={exams}
          filters={questionFilters}
          items={questionListQuery.data ?? []}
          isFetching={questionListQuery.isFetching}
          error={questionListQuery.error}
          onRetry={() => void questionListQuery.refetch()}
          selectedQuestionId={editor.selectedQuestionId}
          canEdit={permissions.canEdit}
          onFiltersChange={(patch) => setQuestionFilters((current) => ({ ...current, ...patch }))}
          onSelect={(questionId) => void editor.loadQuestion(questionId)}
          onNewQuestion={editor.startNewQuestion}
        />
        <AdminExamManager
          exams={exams}
          examDraft={examDraft}
          canEdit={permissions.canEdit}
          onExamDraftChange={setExamDraft}
          onExamChosen={handleExamChosen}
        />
      </div>
      <QuestionEditorCard editor={editor} exams={exams} editorOnly={false} permissions={permissions} />
    </div>
  );

  return (
    <Page width="wide">
      <PageHeader
        context={
          editorOnly ? (
            <Link className="focus-ring inline-flex items-center gap-1.5 rounded-sm hover:text-fg" href="/admin">
              <ArrowLeftIcon />
              {t("admin.form.backToAdmin")}
            </Link>
          ) : undefined
        }
        title={editorOnly ? t("admin.form.standaloneTitle") : t("admin.header.title")}
        description={editorOnly ? t("admin.form.standaloneSubtitle") : t("admin.header.subtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge>
              {t("admin.guard.roleLabel")}: {roleLabel}
            </Badge>
            {draftId ? (
              <Badge className="max-w-full">
                <span className="truncate">
                  {t("admin.form.draftIdentifier")}: {draftId}
                </span>
              </Badge>
            ) : null}
            {editorOnly || draftId ? <Badge tone="primary">{editor.currentWorkflowStatus}</Badge> : null}
          </div>
        }
      />

      {failedBlocks.length ? (
        <Alert
          tone="warning"
          title={t("admin.notices.editorialAccess")}
          role="alert"
          message={t("admin.misc.affectedBlocks", {
            message: readAdminError(failedBlocks[0].query.error, t, "admin.misc.panelLoadFailed"),
            items: failedBlocks.map((item) => t(item.labelKey)).join(", ")
          })}
          action={
            <Button variant="secondary" size="sm" onClick={() => failedBlocks.forEach((item) => void item.query.refetch())}>
              {t("common.actions.retry")}
            </Button>
          }
        />
      ) : null}

      {editorOnly ? (
        <QuestionEditorCard editor={editor} exams={exams} editorOnly permissions={permissions} />
      ) : (
        <Tabs
          ariaLabel={t("admin.tabs.label")}
          items={[
            { id: "questions", label: t("admin.tabs.questions"), content: questionsArea },
            {
              id: "operations",
              label: t("admin.tabs.operations"),
              content: (
                <div className="flex flex-col gap-10">
                  <AdminMaintenanceCard
                    overview={overviewQuery.data}
                    canAdmin={permissions.canAdmin}
                    activeTask={maintenance.activeTask}
                    notice={maintenance.notice}
                    onRefresh={() => void maintenance.refresh()}
                    onIngest={() => void maintenance.ingest()}
                    onExport={() => void maintenance.exportDatabase()}
                  />
                  <AdminInsightsCard
                    analytics={analyticsQuery.data}
                    canCapture={permissions.canEdit}
                    isCapturing={maintenance.activeTask === "captureSnapshot"}
                    onCaptureSnapshot={() => void maintenance.captureSnapshot()}
                  />
                  <AdminRecentIssuesCard issues={recentIssuesQuery.data ?? []} />
                </div>
              )
            },
            {
              id: "issues",
              label: t("admin.tabs.issues"),
              content: <AdminIssuesPanel canView={permissions.canEdit} canTriage={permissions.canReview} />
            },
            {
              id: "people",
              label: t("admin.tabs.people"),
              content: (
                <div className="grid items-start gap-10 xl:grid-cols-2">
                  <AdminUsersPanel canManageUsers={permissions.canAdmin} />
                  <AdminDomainCatalogPanel enabled={permissions.canEdit} />
                </div>
              )
            }
          ]}
        />
      )}
      {maintenance.confirmDialog}
    </Page>
  );
}
