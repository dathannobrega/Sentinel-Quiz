"use client";

import { Field } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import type { Exam } from "@/types/api";

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
        <input
          id={id}
          className="sq-input"
          type="text"
          value={questionDraft[field]}
          onChange={(event) => updateQuestionDraft({ [field]: event.target.value } as Partial<QuestionDraft>)}
        />
      </Field>
    );
  }

  return (
    <section className="sq-editor-section" aria-labelledby="admin-editor-identity-title">
      <div className="sq-editor-section__header">
        <div>
          <h3 id="admin-editor-identity-title" className="sq-section-title">
            {t("admin.form.identityTitle")}
          </h3>
          <p className="sq-section-subtitle">{t("admin.form.identitySubtitle")}</p>
        </div>
      </div>

      <div className="sq-editor-grid sq-editor-grid--identity">
        <Field label={t("admin.form.searchById")} htmlFor="admin-q-lookup">
          <input
            id="admin-q-lookup"
            className="sq-input"
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
          <input
            id="admin-q-id"
            className="sq-input"
            type="text"
            value={questionDraft.id}
            onChange={(event) => updateQuestionDraft({ id: event.target.value })}
          />
        </Field>

        <Field label={t("admin.form.exam")} htmlFor="admin-q-exam">
          <select
            id="admin-q-exam"
            className="sq-select"
            value={questionDraft.examId}
            onChange={(event) => updateQuestionDraft({ examId: event.target.value })}
          >
            <option value="">{t("common.filters.selectExam")}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="sq-editor-grid sq-editor-grid--identity">
        {textField("certification", "admin.form.certification", "admin-q-certification")}
        {textField("domain", "admin.form.domain", "admin-q-domain")}

        <Field label={t("admin.form.difficulty")} htmlFor="admin-q-difficulty">
          <select
            id="admin-q-difficulty"
            className="sq-select"
            value={questionDraft.difficulty}
            onChange={(event) => updateQuestionDraft({ difficulty: event.target.value })}
          >
            <option value="">{t("admin.form.difficultyUnset")}</option>
            {DIFFICULTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("admin.form.selection")} htmlFor="admin-q-selection-mode">
          <select
            id="admin-q-selection-mode"
            className="sq-select"
            value={questionDraft.multiSelect ? "true" : "false"}
            onChange={(event) => updateQuestionDraft({ multiSelect: event.target.value === "true" })}
          >
            <option value="false">{t("admin.form.singleSelect")}</option>
            <option value="true">{t("admin.form.multiSelect")}</option>
          </select>
        </Field>
      </div>

      <div className="sq-editor-grid sq-editor-grid--identity">
        {textField("subject", "admin.form.subject", "admin-q-subject")}
        {textField("subtopic", "admin.form.subtopic", "admin-q-subtopic")}
        {textField("subdomain", "admin.form.subdomain", "admin-q-subdomain")}

        <Field label={t("admin.form.pedagogicalFormat")} htmlFor="admin-q-format">
          <select
            id="admin-q-format"
            className="sq-select"
            value={questionDraft.questionFormat}
            onChange={(event) => updateQuestionDraft({ questionFormat: event.target.value })}
          >
            {QUESTION_FORMAT_OPTIONS.map((option) => (
              <option key={option.value || "auto"} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </Field>

        {textField("objectiveCode", "admin.form.objectiveCode", "admin-q-objective-code")}
        {textField("blueprintCode", "admin.form.blueprintCode", "admin-q-blueprint-code")}
      </div>
    </section>
  );
}
