"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Panel } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";

import type { AdminPermissions, AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";

interface EditorWorkflowCardsProps {
  editor: AdminQuestionEditorState;
  permissions: AdminPermissions;
}

export function EditorWorkflowPanel({ editor, permissions }: EditorWorkflowCardsProps) {
  const { t } = useI18n();
  const { activeTask, currentDraftVersion, currentPublishedVersion } = editor;

  const steps = ["admin.editor.stepSave", "admin.editor.stepReview", "admin.editor.stepApprove", "admin.editor.stepPublish"];

  return (
    <Panel title={t("admin.editor.workflowTitle")} description={t("admin.editor.workflowSubtitle")} level={3}>
      {editor.workflowError ? (
        <QueryErrorBanner
          tone="warning"
          title={t("admin.editor.workflowLoadFailed")}
          error={editor.workflowError}
          onRetry={editor.refetchWorkflow}
        />
      ) : null}

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="col-span-3">
          <dt className="text-xs text-fg-muted">{t("admin.editor.statusCurrent")}</dt>
          <dd className="font-semibold text-fg">{editor.currentWorkflowStatus}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t("admin.editor.draftCurrent")}</dt>
          <dd className="nums font-mono font-medium text-fg">
            {currentDraftVersion?.version_number ? `v${currentDraftVersion.version_number}` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t("admin.editor.publishedCurrent")}</dt>
          <dd className="nums font-mono font-medium text-fg">
            {currentPublishedVersion?.version_number ? `v${currentPublishedVersion.version_number}` : "-"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-muted">{t("admin.editor.auditedEvents")}</dt>
          <dd className="nums font-medium text-fg">{editor.questionAudit.length}</dd>
        </div>
      </dl>

      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        {steps.map((key, index) => (
          <li key={key} className="flex items-center gap-2">
            <span className="nums grid size-5 place-items-center rounded-full border border-line-strong font-mono text-[0.6875rem]">
              {index + 1}
            </span>
            {t(key)}
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="text-fg-subtle">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-2">
        <Button disabled={!permissions.canEdit} busy={activeTask === "saveQuestion"} onClick={() => void editor.saveQuestion()}>
          {t("admin.editor.saveDraft")}
        </Button>
        <div className="grid grid-cols-2 gap-2">
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
            variant="secondary"
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
      </div>
    </Panel>
  );
}

export function EditorHistory({ editor, permissions }: EditorWorkflowCardsProps) {
  const { t } = useI18n();
  const { activeTask } = editor;

  return (
    <>

      <Disclosure
        summary={t("admin.editor.versionsTitle")}
        hint={t("admin.editor.versionsSubtitle")}
        meta={<Badge>{editor.questionVersions.length}</Badge>}
      >
        {editor.questionVersions.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {editor.questionVersions.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="nums font-mono text-sm font-medium text-fg">v{item.version_number}</span>
                  <span className="text-sm text-fg-muted">{item.status}</span>
                  {item.is_current_published ? <Badge tone="success">{t("admin.editor.currentPublishedTag")}</Badge> : null}
                  {item.is_current_draft ? <Badge tone="primary">{t("admin.editor.currentDraftTag")}</Badge> : null}
                </div>
                <p className="text-xs text-fg-subtle">
                  {item.published_at
                    ? t("admin.editor.versionPublishedAt", { date: item.published_at })
                    : t("admin.editor.versionUpdatedAt", { date: item.updated_at || item.created_at || "-" })}{" "}
                  · {t("admin.editor.versionCorrectCount", { correct: item.correct_count, count: item.option_count })}
                </p>
                {item.change_summary ? <p className="text-[0.8125rem] text-fg">{item.change_summary}</p> : null}
                {!item.is_current_published ? (
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-3"
                      disabled={!permissions.canAdmin}
                      busy={activeTask === "rollbackQuestion"}
                      onClick={() => editor.requestRollback(item.id, item.version_number)}
                    >
                      {t("admin.editor.rollbackVersion")}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("admin.editor.noVersions")}</p>
        )}
      </Disclosure>

      <Disclosure summary={t("admin.editor.auditTitle")} hint={t("admin.editor.auditSubtitle")} meta={<Badge>{editor.questionAudit.length}</Badge>}>
        {editor.questionAudit.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {editor.questionAudit.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0">
                <p className="text-sm text-fg">
                  {item.action} · <span className="text-fg-muted">{item.actor_role || t("admin.editor.auditSystem")}</span>
                </p>
                <p className="text-xs text-fg-subtle">{item.created_at || "-"}</p>
                {item.reason ? <p className="text-[0.8125rem] text-fg-muted">{item.reason}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("admin.editor.noAudit")}</p>
        )}
      </Disclosure>

      <Disclosure
        summary={t("admin.editor.performanceTitle")}
        hint={t("admin.editor.performanceSubtitle")}
        meta={<Badge>{editor.questionAnalyticsHistory.length}</Badge>}
      >
        {editor.questionAnalyticsHistory.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {editor.questionAnalyticsHistory.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5 py-2.5 first:pt-0">
                <p className="text-sm text-fg">
                  {item.version_number ? `v${item.version_number}` : t("admin.editor.versionUnknown")} ·{" "}
                  {t("admin.editor.scoreLabel", { value: item.difficulty_score })}
                </p>
                <p className="text-xs text-fg-subtle">
                  {item.captured_at || "-"} · {t("admin.editor.errorRate", { value: item.wrong_rate_percent })} ·{" "}
                  {t("admin.editor.attemptsCount", { count: item.attempts_total })}
                </p>
                <p className="text-xs text-fg-subtle">
                  {t("admin.editor.lowConfidenceRate", { value: item.low_confidence_rate_percent })} ·{" "}
                  {t("admin.editor.pressureCount", { count: item.review_pressure_count })}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-fg-muted">{t("admin.editor.noPerformance")}</p>
        )}
      </Disclosure>
    </>
  );
}
