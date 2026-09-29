"use client";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Checkbox, Textarea } from "@/components/ui/input";
import type { StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import type { Translate } from "@/features/session-runner/lib/runner-utils";

interface NotesPanelProps {
  notes: StudyNotesState;
  canReload: boolean;
  t: Translate;
}

/** Bookmark + personal note for the current question (the error notebook entry). */
export function NotesPanel({ notes, canReload, t }: NotesPanelProps) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="study-notes-title">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 id="study-notes-title" className="text-sm font-semibold text-fg">
            {t("runner.labels.notes")}
          </h2>
          <p className="text-xs text-fg-muted">{t("runner.labels.notesSubtitle")}</p>
        </div>
        <span className="text-xs text-fg-subtle">{notes.scope}</span>
      </div>

      <Checkbox
        id="study-bookmark"
        checked={notes.bookmarked}
        disabled={notes.loading}
        onChange={(event) => notes.setBookmarked(event.target.checked)}
        label={t("runner.labels.reviewLater")}
      />

      <Field label={t("runner.labels.note")} htmlFor="study-note">
        <Textarea
          id="study-note"
          rows={5}
          value={notes.noteText}
          disabled={notes.loading}
          onChange={(event) => notes.setNoteText(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" busy={notes.saving} disabled={!notes.dirty || notes.loading} onClick={() => void notes.save()}>
          {t("runner.labels.save")}
        </Button>
        <Button variant="ghost" size="sm" disabled={notes.loading || !canReload} onClick={notes.reload}>
          {t("runner.labels.reload")}
        </Button>
      </div>

      {notes.notice ? (
        <p className="text-xs text-fg-muted" role="status" aria-live="polite">
          {notes.notice}
        </p>
      ) : null}
    </section>
  );
}
