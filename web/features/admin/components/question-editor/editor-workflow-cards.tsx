"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { useI18n } from "@/lib/i18n";

import type { AdminPermissions, AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";

interface EditorWorkflowCardsProps {
  editor: AdminQuestionEditorState;
  permissions: AdminPermissions;
}

export function EditorWorkflowCards({ editor, permissions }: EditorWorkflowCardsProps) {
  const { t } = useI18n();
  const { activeTask, currentDraftVersion, currentPublishedVersion } = editor;

  return (
    <>
      <Card title={t("admin.editor.workflowTitle")} subtitle={t("admin.editor.workflowSubtitle")}>
        {editor.workflowError ? (
          <QueryErrorBanner
            tone="warning"
            title={t("admin.editor.workflowLoadFailed")}
            error={editor.workflowError}
            onRetry={editor.refetchWorkflow}
          />
        ) : null}
        <div className="sq-metric-grid">
          <MetricCard label={t("admin.editor.statusCurrent")} value={editor.currentWorkflowStatus} />
          <MetricCard
            label={t("admin.editor.draftCurrent")}
            value={currentDraftVersion?.version_number ? `v${currentDraftVersion.version_number}` : "-"}
          />
          <MetricCard
            label={t("admin.editor.publishedCurrent")}
            value={currentPublishedVersion?.version_number ? `v${currentPublishedVersion.version_number}` : "-"}
          />
          <MetricCard label={t("admin.editor.auditedEvents")} value={editor.questionAudit.length} />
          <MetricCard label={t("admin.editor.snapshots")} value={editor.questionAnalyticsHistory.length} />
        </div>

        <ol className="sq-chip-row" style={{ marginTop: "var(--sq-space-4)", listStyle: "none", padding: 0 }}>
          <li className="sq-chip">{t("admin.editor.stepSave")}</li>
          <li className="sq-chip">{t("admin.editor.stepReview")}</li>
          <li className="sq-chip">{t("admin.editor.stepApprove")}</li>
          <li className="sq-chip">{t("admin.editor.stepPublish")}</li>
        </ol>

        <div className="sq-actions" style={{ marginTop: "var(--sq-space-4)" }}>
          <Button disabled={!permissions.canEdit} busy={activeTask === "saveQuestion"} onClick={() => void editor.saveQuestion()}>
            {t("admin.editor.saveDraft")}
          </Button>
          <Button
            variant="secondary"
            busy={activeTask === "submitReview"}
            disabled={!permissions.canEdit || !editor.canSubmitForReview}
            onClick={() => void editor.runWorkflow("submit-review")}
            title={editor.canSubmitForReview ? t("admin.editor.submitReviewHintReady") : t("admin.editor.submitReviewHintBlocked")}
          >
            {t("admin.editor.submitReview")}
          </Button>
          <Button
            variant="secondary"
            busy={activeTask === "approveQuestion"}
            disabled={!permissions.canReview || !editor.canApprove}
            onClick={() => void editor.runWorkflow("approve")}
            title={editor.canApprove ? t("admin.editor.approveHintReady") : t("admin.editor.approveHintBlocked")}
          >
            {t("admin.editor.approve")}
          </Button>
          <Button
            variant="ghost"
            busy={activeTask === "publishQuestion"}
            disabled={!permissions.canAdmin || !editor.canPublish}
            onClick={() => void editor.runWorkflow("publish")}
            title={editor.canPublish ? t("admin.editor.publishHintReady") : t("admin.editor.publishHintBlocked")}
          >
            {t("admin.editor.publish")}
          </Button>
          <Button variant="ghost" disabled={!permissions.canEdit} onClick={editor.startNewQuestion}>
            {t("admin.editor.newDraft")}
          </Button>
        </div>
      </Card>

      <Card title={t("admin.editor.versionsTitle")} subtitle={t("admin.editor.versionsSubtitle")}>
        {editor.questionVersions.length ? (
          <div className="sq-list">
            {editor.questionVersions.map((item) => (
              <div key={item.id} className="sq-list-item">
                <div className="sq-list-title">
                  v{item.version_number} · {item.status}
                </div>
                <div className="sq-list-meta">
                  {item.published_at
                    ? t("admin.editor.versionPublishedAt", { date: item.published_at })
                    : t("admin.editor.versionUpdatedAt", { date: item.updated_at || item.created_at || "-" })}
                </div>
                {item.change_summary ? (
                  <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                    {item.change_summary}
                  </div>
                ) : null}
                <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
                  {item.is_current_published ? <span className="sq-chip">{t("admin.editor.currentPublishedTag")}</span> : null}
                  {item.is_current_draft ? <span className="sq-chip">{t("admin.editor.currentDraftTag")}</span> : null}
                  <span className="sq-chip">
                    {t("admin.editor.versionCorrectCount", { correct: item.correct_count, count: item.option_count })}
                  </span>
                </div>
                {!item.is_current_published ? (
                  <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!permissions.canAdmin}
                      busy={activeTask === "rollbackQuestion"}
                      onClick={() => editor.requestRollback(item.id, item.version_number)}
                    >
                      {t("admin.editor.rollbackVersion")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="sq-empty">{t("admin.editor.noVersions")}</div>
        )}
      </Card>

      <Card title={t("admin.editor.auditTitle")} subtitle={t("admin.editor.auditSubtitle")}>
        {editor.questionAudit.length ? (
          <div className="sq-list">
            {editor.questionAudit.map((item) => (
              <div key={item.id} className="sq-list-item">
                <div className="sq-list-title">
                  {item.action} · {item.actor_role || t("admin.editor.auditSystem")}
                </div>
                <div className="sq-list-meta">{item.created_at || "-"}</div>
                {item.reason ? (
                  <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                    {item.reason}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="sq-empty">{t("admin.editor.noAudit")}</div>
        )}
      </Card>

      <Card title={t("admin.editor.performanceTitle")} subtitle={t("admin.editor.performanceSubtitle")}>
        {editor.questionAnalyticsHistory.length ? (
          <div className="sq-list">
            {editor.questionAnalyticsHistory.map((item) => (
              <div key={item.id} className="sq-list-item">
                <div className="sq-list-title">
                  {item.version_number ? `v${item.version_number}` : t("admin.editor.versionUnknown")} ·{" "}
                  {t("admin.editor.scoreLabel", { value: item.difficulty_score })}
                </div>
                <div className="sq-list-meta">
                  {item.captured_at || "-"} · {t("admin.editor.errorRate", { value: item.wrong_rate_percent })} ·{" "}
                  {t("admin.editor.attemptsCount", { count: item.attempts_total })}
                </div>
                <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                  {t("admin.editor.lowConfidenceRate", { value: item.low_confidence_rate_percent })} ·{" "}
                  {t("admin.editor.pressureCount", { count: item.review_pressure_count })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="sq-empty">{t("admin.editor.noPerformance")}</div>
        )}
      </Card>
    </>
  );
}
