"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

import type { AdminQuestionEditorState } from "@/features/admin/hooks/use-admin-question-editor";
import type { CitationDraft, OptionDraft } from "@/features/admin/types";
import {
  createCitationDraft,
  createOptionDraft,
  hasCitationValue,
  nextOptionKey
} from "@/features/admin/utils/question-draft";

export function EditorOptionsCard({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const { questionDraft, setQuestionDraft } = editor;

  function patchOption(rowId: string, patch: Partial<OptionDraft>) {
    setQuestionDraft((current) => ({
      ...current,
      options: current.options.map((item) => (item.rowId === rowId ? { ...item, ...patch } : item))
    }));
  }

  return (
    <Card
      title={t("admin.form.optionsTitle")}
      subtitle={t("admin.form.optionsSubtitle")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setQuestionDraft((current) => ({
              ...current,
              options: [...current.options, createOptionDraft(nextOptionKey(current.options))]
            }))
          }
        >
          {t("admin.form.addOption")}
        </Button>
      }
    >
      <div className="sq-list">
        {questionDraft.options.map((option, index) => {
          const position = index + 1;
          return (
            <div key={option.rowId} className="sq-list-item sq-editor-option-row">
              <div className="sq-editor-option-grid">
                <input
                  className="sq-input"
                  aria-label={t("admin.form.optionKeyAria", { index: position })}
                  type="text"
                  maxLength={2}
                  value={option.key}
                  onChange={(event) => patchOption(option.rowId, { key: event.target.value.toUpperCase() })}
                />

                <input
                  className="sq-input"
                  aria-label={t("admin.form.optionTextAria", { index: position })}
                  type="text"
                  value={option.text}
                  onChange={(event) => patchOption(option.rowId, { text: event.target.value })}
                />

                <label className="sq-editor-checkbox">
                  <input
                    type="checkbox"
                    aria-label={t("admin.form.optionCorrectAria", { index: position })}
                    checked={option.isCorrect}
                    onChange={(event) => patchOption(option.rowId, { isCorrect: event.target.checked })}
                  />
                  {t("admin.form.optionCorrect")}
                </label>

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("admin.form.removeOptionAria", { index: position })}
                  disabled={questionDraft.options.length <= 2}
                  onClick={() =>
                    setQuestionDraft((current) => ({
                      ...current,
                      options:
                        current.options.length <= 2 ? current.options : current.options.filter((item) => item.rowId !== option.rowId)
                    }))
                  }
                >
                  {t("admin.form.remove")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function EditorReferencesCard({ editor }: { editor: AdminQuestionEditorState }) {
  const { t } = useI18n();
  const { questionDraft, setQuestionDraft } = editor;

  function patchCitation(rowId: string, patch: Partial<CitationDraft>) {
    setQuestionDraft((current) => ({
      ...current,
      citations: current.citations.map((item) => (item.rowId === rowId ? { ...item, ...patch } : item))
    }));
  }

  return (
    <Card
      title={t("admin.form.referencesTitle")}
      subtitle={t("admin.form.referencesSubtitle")}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setQuestionDraft((current) => ({ ...current, citations: [...current.citations, createCitationDraft()] }))}
        >
          {t("admin.form.addReference")}
        </Button>
      }
    >
      <div className="sq-list">
        {questionDraft.citations.map((citation, index) => {
          const position = index + 1;
          const hasExtraMetadata = Object.keys(citation.original).some(
            (key) => !["source", "reference"].includes(key) && hasCitationValue(citation.original[key])
          );

          return (
            <div key={citation.rowId} className="sq-list-item sq-editor-reference-row">
              <div className="sq-editor-reference-grid">
                <input
                  className="sq-input"
                  aria-label={t("admin.form.referenceSourceAria", { index: position })}
                  type="text"
                  value={citation.source}
                  onChange={(event) => patchCitation(citation.rowId, { source: event.target.value })}
                />

                <input
                  className="sq-input"
                  aria-label={t("admin.form.referenceDescriptionAria", { index: position })}
                  type="text"
                  value={citation.reference}
                  onChange={(event) => patchCitation(citation.rowId, { reference: event.target.value })}
                />

                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("admin.form.removeReferenceAria", { index: position })}
                  onClick={() =>
                    setQuestionDraft((current) => {
                      const remaining = current.citations.filter((item) => item.rowId !== citation.rowId);
                      return { ...current, citations: remaining.length ? remaining : [createCitationDraft()] };
                    })
                  }
                >
                  {t("admin.form.remove")}
                </Button>
              </div>

              {hasExtraMetadata ? (
                <div className="sq-chip-row">
                  <span className="sq-chip">{t("admin.form.metadataPreserved")}</span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
