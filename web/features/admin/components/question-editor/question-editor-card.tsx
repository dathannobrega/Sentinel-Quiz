"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { ExternalIcon } from "@/components/ui/icons";
import { SectionHeading } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import type { Exam } from "@/types/api";

import { RollbackDialog } from "@/features/admin/components/rollback-dialog";
import { EditorIdentitySection } from "@/features/admin/components/question-editor/editor-identity-section";
import { EditorOptionsCard, EditorReferencesCard } from "@/features/admin/components/question-editor/editor-options-references";
import { EditorChecklistCards, EditorQualityCard } from "@/features/admin/components/question-editor/editor-quality-card";
import { EditorTextSections } from "@/features/admin/components/question-editor/editor-text-sections";
import { EditorHistory, EditorWorkflowPanel } from "@/features/admin/components/question-editor/editor-workflow-cards";
import type { AdminPermissions, AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import { deactivatedReasonKey } from "@/features/admin/utils/question-draft";

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

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant="secondary"
        size="sm"
        busy={editor.isQuestionLoading}
        onClick={() => void editor.loadQuestion(editor.questionDraft.lookupId || editor.questionDraft.id)}
      >
        {t("admin.editor.load")}
      </Button>
      <Button variant="ghost" size="sm" onClick={editor.duplicateQuestion}>
        {t("admin.editor.duplicate")}
      </Button>
      {editorOnly ? null : (
        <Link
          href={draftId ? `/admin/questions/${encodeURIComponent(draftId)}` : "/admin/questions/new"}
          className={buttonClassName("ghost", "sm")}
        >
          {t("admin.form.dedicatedEntry")}
          <ExternalIcon size={12} />
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
  );

  return (
    <section className="@container flex min-w-0 flex-col gap-5" aria-label={editorOnly ? t("admin.form.standaloneTitle") : t("admin.editor.title")}>
      {/* Toolbar in its own wrapping row: SectionHeading's actions slot does not shrink on narrow screens. */}
      {editorOnly ? null : <SectionHeading title={t("admin.editor.title")} description={t("admin.editor.subtitle")} />}
      <div className={editorOnly ? "flex justify-end" : undefined}>{toolbar}</div>

      {editor.questionNotice ? <Alert tone="neutral" title={t("admin.editor.noticeTitle")} message={editor.questionNotice} /> : null}
      {isInactive ? (
        <Alert
          tone="warning"
          title={t("admin.lifecycle.inactiveTitle")}
          message={t("admin.lifecycle.inactiveMessage", { reason: t(deactivatedReasonKey(state?.deactivatedReason)) })}
        />
      ) : null}
      {state && (state.needsReview || state.explanationMissing) ? (
        <div className="flex flex-wrap gap-1.5" role="status" aria-label={t("admin.lifecycle.flagsAriaLabel")}>
          {state.needsReview ? <Badge tone="warning">{t("admin.lifecycle.needsReview")}</Badge> : null}
          {state.explanationMissing ? <Badge tone="warning">{t("admin.lifecycle.explanationMissing")}</Badge> : null}
        </div>
      ) : null}
      {editor.hasQuestionDraftContent && editor.validationErrorKey ? (
        <Alert tone="warning" title={t("admin.editor.validationTitle")} message={t(editor.validationErrorKey)} />
      ) : null}

      <div className="grid items-start gap-8 @5xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="@container flex min-w-0 flex-col gap-6">
          <EditorIdentitySection editor={editor} exams={exams} />
          <EditorTextSections editor={editor} />
          <EditorOptionsCard editor={editor} />
          <EditorReferencesCard editor={editor} />
        </div>

        <aside
          className="flex min-w-0 flex-col gap-4 @5xl:sticky @5xl:top-6 @5xl:max-h-[calc(100dvh-3rem)] @5xl:overflow-y-auto @5xl:overscroll-contain"
          aria-label={t("admin.editor.workflowTitle")}
        >
          <EditorWorkflowPanel editor={editor} permissions={permissions} />
          <EditorQualityCard editor={editor} />
          <EditorHistory editor={editor} permissions={permissions} />
          <EditorChecklistCards editor={editor} />
        </aside>
      </div>

      {editor.confirmDialog}
      <RollbackDialog
        target={editor.rollbackTarget}
        questionId={draftId}
        busy={editor.activeTask === "rollbackQuestion"}
        onConfirm={(reason) => void editor.confirmRollback(reason)}
        onCancel={editor.cancelRollback}
      />
    </section>
  );
}
