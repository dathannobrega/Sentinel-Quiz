"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

import { EditorSection } from "@/features/admin/components/question-editor/editor-section";

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
    <EditorSection
      id="admin-editor-options-title"
      title={t("admin.form.optionsTitle")}
      subtitle={t("admin.form.optionsSubtitle")}
      actions={
        <Button
          variant="secondary"
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
      <ul className="flex flex-col gap-2">
        {questionDraft.options.map((option, index) => {
          const position = index + 1;
          return (
            <li
              key={option.rowId}
              className={cn(
                "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 rounded-md border p-2 @xl:grid-cols-[3.25rem_minmax(0,1fr)_auto_auto]",
                option.isCorrect ? "border-success/50 bg-success-soft" : "border-line bg-surface"
              )}
            >
              <Input
                className="text-center font-mono uppercase"
                aria-label={t("admin.form.optionKeyAria", { index: position })}
                type="text"
                maxLength={2}
                value={option.key}
                onChange={(event) => patchOption(option.rowId, { key: event.target.value.toUpperCase() })}
              />
              <Input
                aria-label={t("admin.form.optionTextAria", { index: position })}
                type="text"
                value={option.text}
                onChange={(event) => patchOption(option.rowId, { text: event.target.value })}
              />
              <label className="col-start-2 flex min-h-9 cursor-pointer items-center gap-2 px-1 text-sm font-medium text-fg @xl:col-start-auto">
                <input
                  type="checkbox"
                  className="size-4 accent-success"
                  aria-label={t("admin.form.optionCorrectAria", { index: position })}
                  checked={option.isCorrect}
                  onChange={(event) => patchOption(option.rowId, { isCorrect: event.target.checked })}
                />
                {t("admin.form.optionCorrect")}
              </label>
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-end"
                aria-label={t("admin.form.removeOptionAria", { index: position })}
                disabled={questionDraft.options.length <= 2}
                onClick={() =>
                  setQuestionDraft((current) => ({
                    ...current,
                    options: current.options.length <= 2 ? current.options : current.options.filter((item) => item.rowId !== option.rowId)
                  }))
                }
              >
                {t("admin.form.remove")}
              </Button>
            </li>
          );
        })}
      </ul>
    </EditorSection>
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
    <EditorSection
      id="admin-editor-references-title"
      title={t("admin.form.referencesTitle")}
      subtitle={t("admin.form.referencesSubtitle")}
      actions={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setQuestionDraft((current) => ({ ...current, citations: [...current.citations, createCitationDraft()] }))}
        >
          {t("admin.form.addReference")}
        </Button>
      }
    >
      <ul className="flex flex-col gap-2">
        {questionDraft.citations.map((citation, index) => {
          const position = index + 1;
          const hasExtraMetadata = Object.keys(citation.original).some(
            (key) => !["source", "reference"].includes(key) && hasCitationValue(citation.original[key])
          );

          return (
            <li key={citation.rowId} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2">
              <div className="grid gap-2 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                <Input
                  aria-label={t("admin.form.referenceSourceAria", { index: position })}
                  type="text"
                  value={citation.source}
                  onChange={(event) => patchCitation(citation.rowId, { source: event.target.value })}
                />
                <Input
                  aria-label={t("admin.form.referenceDescriptionAria", { index: position })}
                  type="text"
                  value={citation.reference}
                  onChange={(event) => patchCitation(citation.rowId, { reference: event.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-self-end @xl:self-center"
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
                <div>
                  <Badge>{t("admin.form.metadataPreserved")}</Badge>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </EditorSection>
  );
}
