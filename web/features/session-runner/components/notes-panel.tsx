"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import type { Translate } from "@/features/session-runner/lib/runner-utils";

interface NotesPanelProps {
  notes: StudyNotesState;
  canReload: boolean;
  t: Translate;
}

export function NotesPanel({ notes, canReload, t }: NotesPanelProps) {
  return (
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{t("runner.labels.notes")}</div>
          <div className="sq-list-meta">{t("runner.labels.notesSubtitle")}</div>
        </div>
        <span className="sq-chip">{notes.scope}</span>
      </div>

      <label htmlFor="study-bookmark" className="sq-checkbox-row sq-gap-top-sm">
        <input
          id="study-bookmark"
          type="checkbox"
          checked={notes.bookmarked}
          disabled={notes.loading}
          onChange={(event) => notes.setBookmarked(event.target.checked)}
        />
        {t("runner.labels.reviewLater")}
      </label>

      <div className="sq-gap-top-sm">
        <Field label={t("runner.labels.note")} htmlFor="study-note">
          <textarea
            id="study-note"
            className="sq-textarea"
            rows={5}
            value={notes.noteText}
            disabled={notes.loading}
            onChange={(event) => notes.setNoteText(event.target.value)}
          />
        </Field>
      </div>

      <div className="sq-actions sq-gap-top-sm">
        <Button
          variant="ghost"
          size="sm"
          busy={notes.saving}
          disabled={!notes.dirty || notes.loading}
          onClick={() => void notes.save()}
        >
          {t("runner.labels.save")}
        </Button>
        <Button variant="ghost" size="sm" disabled={notes.loading || !canReload} onClick={notes.reload}>
          {t("runner.labels.reload")}
        </Button>
      </div>

      {notes.notice ? (
        <div className="sq-list-meta sq-gap-top-sm" role="status" aria-live="polite">
          {notes.notice}
        </div>
      ) : null}
    </div>
  );
}
