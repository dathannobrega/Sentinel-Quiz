"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import type { Exam } from "@/types/api";

import { RollbackDialog } from "@/features/admin/components/rollback-dialog";
import { EditorIdentitySection } from "@/features/admin/components/question-editor/editor-identity-section";
import { EditorOptionsCard, EditorReferencesCard } from "@/features/admin/components/question-editor/editor-options-references";
import { EditorChecklistCards, EditorQualityCard } from "@/features/admin/components/question-editor/editor-quality-card";
import { EditorTextSections } from "@/features/admin/components/question-editor/editor-text-sections";
import { EditorWorkflowCards } from "@/features/admin/components/question-editor/editor-workflow-cards";
import type { AdminPermissions, AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import { WARNING_CHIP_STYLE, deactivatedReasonKey } from "@/features/admin/utils/question-draft";

interface QuestionEditorCardProps {
  editor: AdminQuestionEditorState;
  exams: Exam[];
  editorOnly: boolean;
  permissions: AdminPermissions;
}

export function QuestionEditorCard({ editor, exams, editorOnly, permissions }: QuestionEditorCardProps) {
  const { t } = useI18n();
  const draftId = editor.questionDraft.id.trim();
  const state = editor.questionState;
  const isInactive = state?.isActive === false;

  return (
    <Card
      className={`sq-editor-card${editorOnly ? " sq-editor-card--focused" : ""}`}
      title={editorOnly ? t("admin.form.standaloneTitle") : t("admin.editor.title")}
      subtitle={editorOnly ? t("admin.form.standaloneSubtitle") : t("admin.editor.subtitle")}
      actions={
        <div className="sq-actions">
          <Button
            variant="ghost"
            size="sm"
            busy={editor.isQuestionLoading}
            onClick={() => void editor.loadQuestion(editor.questionDraft.lookupId || editor.questionDraft.id)}
          >
            {t("admin.editor.load")}
          </Button>
          <Button variant="ghost" size="sm" onClick={editor.duplicateQuestion}>
            {t("admin.editor.duplicate")}
          </Button>
          {editorOnly ? (
            <Link href="/admin">{t("admin.form.backToAdmin")}</Link>
          ) : (
            <Link href={draftId ? `/admin/questions/${encodeURIComponent(draftId)}` : "/admin/questions/new"}>
              {t("admin.form.dedicatedEntry")}
            </Link>
          )}
          {isInactive ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={!permissions.canAdmin}
              busy={editor.activeTask === "reactivateQuestion"}
              onClick={() => void editor.reactivateQuestion()}
            >
              {t("admin.lifecycle.reactivate")}
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              disabled={!permissions.canAdmin || !editor.selectedQuestionId}
              busy={editor.activeTask === "deleteQuestion"}
              onClick={() => void editor.deleteQuestion()}
            >
              {t("admin.editor.delete")}
            </Button>
          )}
        </div>
      }
    >
      <div className="sq-surface-block">
        {editor.questionNotice ? (
          <StatusBanner tone="neutral" title={t("admin.editor.noticeTitle")} message={editor.questionNotice} />
        ) : null}
        {isInactive ? (
          <StatusBanner
            tone="warning"
            title={t("admin.lifecycle.inactiveTitle")}
            message={t("admin.lifecycle.inactiveMessage", { reason: t(deactivatedReasonKey(state?.deactivatedReason)) })}
          />
        ) : null}
        {state && (state.needsReview || state.explanationMissing) ? (
          <div className="sq-chip-row" role="status" aria-label={t("admin.lifecycle.flagsAriaLabel")}>
            {state.needsReview ? <span className="sq-chip" style={WARNING_CHIP_STYLE}>{t("admin.lifecycle.needsReview")}</span> : null}
            {state.explanationMissing ? (
              <span className="sq-chip" style={WARNING_CHIP_STYLE}>{t("admin.lifecycle.explanationMissing")}</span>
            ) : null}
          </div>
        ) : null}
        {editor.hasQuestionDraftContent && editor.validationErrorKey ? (
          <StatusBanner tone="warning" title={t("admin.editor.validationTitle")} message={t(editor.validationErrorKey)} />
        ) : null}

        <div className={`sq-editor-workspace${editorOnly ? "" : " sq-editor-workspace--embedded"}`}>
          <div className="sq-editor-main">
            <EditorIdentitySection editor={editor} exams={exams} />
            <EditorTextSections editor={editor} />
            <div className="sq-editor-dual-cards">
              <EditorOptionsCard editor={editor} />
              <EditorReferencesCard editor={editor} />
            </div>
          </div>

          <aside className="sq-editor-sidebar" aria-label={t("admin.editor.workflowTitle")}>
            <EditorQualityCard editor={editor} />
            <EditorWorkflowCards editor={editor} permissions={permissions} />
            <EditorChecklistCards editor={editor} />
          </aside>
        </div>
      </div>

      {editor.confirmDialog}
      <RollbackDialog
        target={editor.rollbackTarget}
        questionId={draftId}
        busy={editor.activeTask === "rollbackQuestion"}
        onConfirm={(reason) => void editor.confirmRollback(reason)}
        onCancel={editor.cancelRollback}
      />
    </Card>
  );
}
