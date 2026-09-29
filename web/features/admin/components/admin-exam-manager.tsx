"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useAdminSaveExamMutation } from "@/lib/query/admin-hooks";
import type { AdminCreateExamInput, Exam } from "@/types/api";

import type { ExamDraft } from "@/features/admin/types";
import { readAdminError } from "@/features/admin/utils/admin-errors";
import { createEmptyExamDraft } from "@/features/admin/utils/question-draft";

interface AdminExamManagerProps {
  exams: Exam[];
  examDraft: ExamDraft;
  canEdit: boolean;
  onExamDraftChange: (draft: ExamDraft) => void;
  /** Called when an existing exam is picked or a new one is saved (prefills the question draft). */
  onExamChosen: (examId: string, force: boolean) => void;
}

export function AdminExamManager({ exams, examDraft, canEdit, onExamDraftChange, onExamChosen }: AdminExamManagerProps) {
  const { t } = useI18n();
  const saveExamMutation = useAdminSaveExamMutation();
  const [notice, setNotice] = useState<{ tone: "neutral" | "success" | "danger"; message: string } | null>(null);

  function patchDraft(patch: Partial<ExamDraft>) {
    onExamDraftChange({ ...examDraft, ...patch });
    setNotice(null);
  }

  function applyExam(examId: string) {
    const match = exams.find((item) => item.id === examId);
    if (!match) {
      onExamDraftChange(createEmptyExamDraft());
      return;
    }
    onExamDraftChange({
      id: match.id,
      title: match.title,
      source: String(match.source || ""),
      questionCount: match.question_count === null || match.question_count === undefined ? "" : String(match.question_count)
    });
    onExamChosen(match.id, false);
  }

  function handleSave() {
    if (!canEdit) {
      setNotice({ tone: "danger", message: t("admin.misc.editorRequiredAction") });
      return;
    }
    const payload: AdminCreateExamInput = {
      id: examDraft.id.trim(),
      title: examDraft.title.trim(),
      source: examDraft.source.trim() || null,
      question_count: examDraft.questionCount.trim() ? Number(examDraft.questionCount.trim()) : null
    };
    if (!payload.id || !payload.title) {
      setNotice({ tone: "danger", message: t("admin.misc.examRequiredFields") });
      return;
    }
    setNotice(null);
    saveExamMutation.mutate(payload, {
      onSuccess: () => {
        setNotice({ tone: "success", message: t("admin.misc.examSaved", { id: payload.id }) });
        onExamChosen(payload.id, true);
      },
      onError: (error) => {
        setNotice({ tone: "danger", message: readAdminError(error, t, "admin.misc.examSaveFailed") });
      }
    });
  }

  return (
    <Disclosure
      variant="plain"
      className="border-t border-b border-line"
      summary={t("admin.examsManager.title")}
      hint={t("admin.examsManager.subtitle")}
      defaultOpen={!!notice}
      contentClassName="flex flex-col gap-3"
    >
      <Field label={t("admin.examsManager.registeredExams")} htmlFor="admin-exam-select">
        <Select id="admin-exam-select" value={examDraft.id} onChange={(event) => applyExam(event.target.value)}>
          <option value="">{t("common.filters.selectExam")}</option>
          {exams.map((exam) => (
            <option key={exam.id} value={exam.id}>
              {exam.title} ({exam.id})
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Field label={t("admin.examsManager.examId")} htmlFor="admin-exam-id">
          <Input id="admin-exam-id" type="text" value={examDraft.id} onChange={(event) => patchDraft({ id: event.target.value })} />
        </Field>
        <Field label={t("admin.examsManager.questionCount")} htmlFor="admin-exam-count">
          <Input
            id="admin-exam-count"
            type="number"
            min="0"
            value={examDraft.questionCount}
            onChange={(event) => patchDraft({ questionCount: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t("admin.examsManager.titleLabel")} htmlFor="admin-exam-title">
        <Input id="admin-exam-title" type="text" value={examDraft.title} onChange={(event) => patchDraft({ title: event.target.value })} />
      </Field>

      <Field label={t("admin.examsManager.source")} htmlFor="admin-exam-source" hint={t("admin.examsManager.sourceHint")}>
        <Input id="admin-exam-source" type="text" value={examDraft.source} onChange={(event) => patchDraft({ source: event.target.value })} />
      </Field>

      {notice ? (
        <Alert
          tone={notice.tone}
          title={t("admin.examsManager.noticeTitle")}
          message={notice.message}
          role={notice.tone === "danger" ? "alert" : "status"}
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!canEdit} busy={saveExamMutation.isPending} onClick={handleSave}>
          {t("admin.examsManager.saveExam")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onExamDraftChange(createEmptyExamDraft());
            setNotice(null);
          }}
        >
          {t("admin.examsManager.clear")}
        </Button>
      </div>
    </Disclosure>
  );
}
