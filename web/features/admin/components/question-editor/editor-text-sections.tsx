"use client";

import type { ReactNode } from "react";

import { Field } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";

import type { AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import { joinTextList, normalizeTags, splitTextareaLines } from "@/features/admin/utils/question-draft";

function EditorSection({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="sq-editor-section" aria-labelledby={id}>
      <div className="sq-editor-section__header">
        <div>
          <h3 id={id} className="sq-section-title">
            {title}
          </h3>
          <p className="sq-section-subtitle">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** Prompt, tags, rationales and telemetry fields of the question editor. */
export function EditorTextSections({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const { questionDraft, updateQuestionDraft } = editor;

  return (
    <>
      <EditorSection id="admin-editor-content-title" title={t("admin.form.contentTitle")} subtitle={t("admin.form.contentSubtitle")}>
        <Field label={t("admin.form.prompt")} htmlFor="admin-q-prompt">
          <textarea
            id="admin-q-prompt"
            className="sq-textarea"
            rows={7}
            value={questionDraft.prompt}
            onChange={(event) => updateQuestionDraft({ prompt: event.target.value })}
          />
        </Field>

        <div className="sq-editor-grid sq-editor-grid--split">
          <Field label={t("admin.form.tags")} htmlFor="admin-q-tags" hint={t("admin.form.tagsHint")}>
            <input
              id="admin-q-tags"
              className="sq-input"
              type="text"
              value={questionDraft.tagsText}
              onChange={(event) => updateQuestionDraft({ tagsText: event.target.value })}
            />
          </Field>

          <Field label={t("admin.form.correctRationale")} htmlFor="admin-q-justification" hint={t("admin.form.correctRationaleHint")}>
            <textarea
              id="admin-q-justification"
              className="sq-textarea"
              rows={6}
              value={questionDraft.correctRationale}
              onChange={(event) =>
                updateQuestionDraft({ correctRationale: event.target.value, justification: event.target.value })
              }
            />
          </Field>
        </div>

        <div className="sq-editor-grid sq-editor-grid--split">
          <Field label={t("admin.form.keywords")} htmlFor="admin-q-keywords" hint={t("admin.form.keywordsHint")}>
            <input
              id="admin-q-keywords"
              className="sq-input"
              type="text"
              value={joinTextList(questionDraft.keywords)}
              onChange={(event) => updateQuestionDraft({ keywords: normalizeTags(event.target.value) })}
            />
          </Field>

          <Field label={t("admin.form.traps")} htmlFor="admin-q-traps" hint={t("admin.form.trapsHint")}>
            <input
              id="admin-q-traps"
              className="sq-input"
              type="text"
              value={joinTextList(questionDraft.trapPatterns)}
              onChange={(event) => updateQuestionDraft({ trapPatterns: normalizeTags(event.target.value) })}
            />
          </Field>
        </div>
      </EditorSection>

      <EditorSection id="admin-editor-rationale-title" title={t("admin.form.rationaleTitle")} subtitle={t("admin.form.rationaleSubtitle")}>
        <div className="sq-editor-grid sq-editor-grid--split">
          <Field
            label={t("admin.form.incorrectRationales")}
            htmlFor="admin-q-incorrect-rationales"
            hint={t("admin.form.incorrectRationalesHint")}
          >
            <textarea
              id="admin-q-incorrect-rationales"
              className="sq-textarea"
              rows={5}
              value={questionDraft.incorrectRationales.join("\n")}
              onChange={(event) => updateQuestionDraft({ incorrectRationales: splitTextareaLines(event.target.value) })}
            />
          </Field>

          <Field
            label={t("admin.form.legacyJustification")}
            htmlFor="admin-q-legacy-justification"
            hint={t("admin.form.legacyJustificationHint")}
          >
            <textarea
              id="admin-q-legacy-justification"
              className="sq-textarea"
              rows={5}
              value={questionDraft.justification}
              onChange={(event) => updateQuestionDraft({ justification: event.target.value })}
            />
          </Field>
        </div>
      </EditorSection>

      <EditorSection id="admin-editor-telemetry-title" title={t("admin.form.telemetryTitle")} subtitle={t("admin.form.telemetrySubtitle")}>
        <div className="sq-editor-grid sq-editor-grid--identity">
          <Field label={t("admin.form.avgTime")} htmlFor="admin-q-avg-time">
            <input
              id="admin-q-avg-time"
              className="sq-input"
              type="number"
              min={0}
              step="1"
              value={questionDraft.avgTimeSeconds}
              onChange={(event) => updateQuestionDraft({ avgTimeSeconds: event.target.value })}
            />
          </Field>

          <Field label={t("admin.form.globalAccuracy")} htmlFor="admin-q-global-accuracy">
            <input
              id="admin-q-global-accuracy"
              className="sq-input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={questionDraft.globalAccuracyPercent}
              onChange={(event) => updateQuestionDraft({ globalAccuracyPercent: event.target.value })}
            />
          </Field>
        </div>

        <Field label={t("admin.form.changeSummary")} htmlFor="admin-q-change-summary" hint={t("admin.form.changeSummaryHint")}>
          <textarea
            id="admin-q-change-summary"
            className="sq-textarea"
            rows={3}
            value={questionDraft.changeSummary}
            onChange={(event) => updateQuestionDraft({ changeSummary: event.target.value })}
          />
        </Field>
      </EditorSection>
    </>
  );
}
