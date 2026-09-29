"use client";

import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import type { Exam } from "@/types/api";

import { EditorSection, editorGrid } from "@/features/admin/components/question-editor/editor-section";
import type { AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import type { QuestionDraft } from "@/features/admin/types";
import { DIFFICULTY_OPTIONS, QUESTION_FORMAT_OPTIONS } from "@/features/admin/utils/question-draft";

type TextFieldKey = "certification" | "domain" | "subject" | "subtopic" | "subdomain" | "objectiveCode" | "blueprintCode";

export function EditorIdentitySection({ editor, exams }: { editor: AdminQuestionEditorState; exams: Exam[] }) {
  const { t } = useI18n();
  const { questionDraft, updateQuestionDraft } = editor;

  function textField(field: TextFieldKey, labelKey: string, id: string) {
    return (
      <Field label={t(labelKey)} htmlFor={id}>
        <Input
          id={id}
          type="text"
          value={questionDraft[field]}
          onChange={(event) => updateQuestionDraft({ [field]: event.target.value } as Partial<QuestionDraft>)}
        />
      </Field>
    );
  }

  return (
    <EditorSection
      id="admin-editor-identity-title"
      title={t("admin.form.identityTitle")}
      subtitle={t("admin.form.identitySubtitle")}
      className="border-t-0 pt-0"
    >

      <div className={editorGrid}>
        <Field label={t("admin.form.searchById")} htmlFor="admin-q-lookup">
          <Input
            id="admin-q-lookup"
            type="text"
            value={questionDraft.lookupId}
            onChange={(event) => updateQuestionDraft({ lookupId: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void editor.loadQuestion(questionDraft.lookupId || questionDraft.id);
              }
            }}
          />
        </Field>

        <Field label={t("admin.form.questionId")} htmlFor="admin-q-id">
          <Input
            id="admin-q-id"
            type="text"
            value={questionDraft.id}
            onChange={(event) => updateQuestionDraft({ id: event.target.value })}
          />
        </Field>

        <Field label={t("admin.form.exam")} htmlFor="admin-q-exam">
          <Select
            id="admin-q-exam"
            value={questionDraft.examId}
            onChange={(event) => updateQuestionDraft({ examId: event.target.value })}
          >
            <option value="">{t("common.filters.selectExam")}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className={editorGrid}>
        {textField("certification", "admin.form.certification", "admin-q-certification")}
        {textField("domain", "admin.form.domain", "admin-q-domain")}

        <Field label={t("admin.form.difficulty")} htmlFor="admin-q-difficulty">
          <Select
            id="admin-q-difficulty"
            value={questionDraft.difficulty}
            onChange={(event) => updateQuestionDraft({ difficulty: event.target.value })}
          >
            <option value="">{t("admin.form.difficultyUnset")}</option>
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t("admin.form.selection")} htmlFor="admin-q-selection-mode">
          <Select
            id="admin-q-selection-mode"
            value={questionDraft.multiSelect ? "true" : "false"}
            onChange={(event) => updateQuestionDraft({ multiSelect: event.target.value === "true" })}
          >
            <option value="false">{t("admin.form.singleSelect")}</option>
            <option value="true">{t("admin.form.multiSelect")}</option>
          </Select>
        </Field>
      </div>

      <div className={editorGrid}>
        {textField("subject", "admin.form.subject", "admin-q-subject")}
        {textField("subtopic", "admin.form.subtopic", "admin-q-subtopic")}
        {textField("subdomain", "admin.form.subdomain", "admin-q-subdomain")}

        <Field label={t("admin.form.pedagogicalFormat")} htmlFor="admin-q-format">
          <Select
            id="admin-q-format"
            value={questionDraft.questionFormat}
            onChange={(event) => updateQuestionDraft({ questionFormat: event.target.value })}
          >
            {QUESTION_FORMAT_OPTIONS.map((option) => (
              <option key={option.value || "auto"} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </Select>
        </Field>

        {textField("objectiveCode", "admin.form.objectiveCode", "admin-q-objective-code")}
        {textField("blueprintCode", "admin.form.blueprintCode", "admin-q-blueprint-code")}
      </div>
    </EditorSection>
  );
}
