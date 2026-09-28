"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
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

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className={`sq-page-head${editorOnly ? " sq-page-head--focused" : ""}`}>
          <div className="sq-page-head__copy">
            <span className="sq-eyebrow">{editorOnly ? t("admin.form.standaloneTitle") : t("admin.header.title")}</span>
            <div className="sq-brand">
              <div className="sq-logo" aria-hidden="true">
                SQ
              </div>
              <div className="sq-brand-copy">
                <h1 className="sq-page-title">{editorOnly ? t("admin.form.standaloneTitle") : t("admin.header.title")}</h1>
                <p className="sq-page-subtitle">{editorOnly ? t("admin.form.standaloneSubtitle") : t("admin.header.subtitle")}</p>
              </div>
            </div>
          </div>
          <div className="sq-page-head__meta">
            {editorOnly ? (
              <Link className="sq-text-link" href="/admin">
                {t("admin.form.backToAdmin")}
              </Link>
            ) : null}
            <span className="sq-chip">
              {t("admin.guard.roleLabel")}: {role ? userRoleLabel(t, role) : t("admin.guard.guestRole")}
            </span>
            {draftId ? (
              <span className="sq-chip">
                {t("admin.form.draftIdentifier")}: {draftId}
              </span>
            ) : null}
            {editorOnly || draftId ? <span className="sq-chip">{editor.currentWorkflowStatus}</span> : null}
          </div>
        </header>

        {failedBlocks.length ? (
          <StatusBanner
            tone="warning"
            title={t("admin.notices.editorialAccess")}
            role="alert"
            message={t("admin.misc.affectedBlocks", {
              message: readAdminError(failedBlocks[0].query.error, t, "admin.misc.panelLoadFailed"),
              items: failedBlocks.map((item) => t(item.labelKey)).join(", ")
            })}
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => failedBlocks.forEach((item) => void item.query.refetch())}
              >
                {t("common.actions.retry")}
              </Button>
            }
          />
        ) : null}

        {!editorOnly ? (
          <>
            <AdminMaintenanceCard
              overview={overviewQuery.data}
              canAdmin={permissions.canAdmin}
              activeTask={maintenance.activeTask}
              notice={maintenance.notice}
              onRefresh={() => void maintenance.refresh()}
              onIngest={() => void maintenance.ingest()}
              onExport={() => void maintenance.exportDatabase()}
            />

            <div className="sq-grid-3">
              <AdminUsersPanel canManageUsers={permissions.canAdmin} />
              <AdminDomainCatalogPanel enabled={permissions.canEdit} />
              <AdminIssuesPanel canView={permissions.canEdit} canTriage={permissions.canReview} />
            </div>

            <AdminInsightsCard
              analytics={analyticsQuery.data}
              canCapture={permissions.canEdit}
              isCapturing={maintenance.activeTask === "captureSnapshot"}
              onCaptureSnapshot={() => void maintenance.captureSnapshot()}
            />

            <AdminRecentIssuesCard issues={recentIssuesQuery.data ?? []} />
          </>
        ) : null}

        <div className={`sq-admin-layout${editorOnly ? " sq-admin-layout--editor-focus" : ""}`}>
          {!editorOnly ? (
            <div className="sq-page-stack">
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
          ) : null}

          <QuestionEditorCard editor={editor} exams={exams} editorOnly={editorOnly} permissions={permissions} />
        </div>
      </div>
      {maintenance.confirmDialog}
    </main>
  );
}
