"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { formatScope, type Translate } from "@/features/session-runner/lib/runner-utils";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import { runnerKeys, useStudyQuestionStateQuery } from "@/lib/query/runner-hooks";
import { formatDateTime } from "@/lib/utils/format";
import type { StudyState } from "@/types/api";

const AUTOSAVE_DELAY_MS = 900;

interface Draft {
  questionId: string;
  bookmarked: boolean;
  noteText: string;
}

export interface StudyNotesState {
  bookmarked: boolean;
  noteText: string;
  scope: string;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  notice: string | null;
  setBookmarked: (value: boolean) => void;
  setNoteText: (value: string) => void;
  /** Persists pending changes. Resolves false when saving failed. */
  save: () => Promise<boolean>;
  reload: () => void;
}

/** Bookmark + note for the current study question, with debounced autosave. */
export function useStudyNotes(questionId: string | null, t: Translate): StudyNotesState {
  const queryClient = useQueryClient();
  const query = useStudyQuestionStateQuery(questionId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ questionId: string; text: string } | null>(null);

  const serverState = query.data && query.data.question_id === questionId ? query.data : null;
  const activeDraft = draft && draft.questionId === questionId ? draft : null;
  const bookmarked = activeDraft ? activeDraft.bookmarked : serverState?.bookmarked ?? false;
  const noteText = activeDraft ? activeDraft.noteText : serverState?.note_text ?? "";
  const dirty = !!activeDraft;
  const scope = formatScope(serverState?.scope, t);

  let derivedNotice: string | null = null;
  if (notice && notice.questionId === questionId) {
    derivedNotice = notice.text;
  } else if (query.isPending && questionId) {
    derivedNotice = t("runner.notices.loadingStudyState");
  } else if (query.isError) {
    derivedNotice = readErrorMessage(query.error, t("runner.errors.notesFailed"));
  } else if (serverState) {
    derivedNotice = serverState.updated_at
      ? t("runner.notices.syncedAt", { date: formatDateTime(serverState.updated_at), scope })
      : t("runner.notices.noSavedNotes", { scope });
  }

  const updateDraft = useCallback(
    (patch: Partial<Omit<Draft, "questionId">>) => {
      if (!questionId) {
        return;
      }
      setDraft((current) => {
        const base =
          current && current.questionId === questionId
            ? current
            : { questionId, bookmarked, noteText };
        return { ...base, ...patch };
      });
      setNotice({ questionId, text: t("runner.studyState.pendingChanges") });
    },
    [bookmarked, noteText, questionId, t]
  );

  const latest = useRef({ activeDraft, saving, questionId });
  useEffect(() => {
    latest.current = { activeDraft, saving, questionId };
  });

  const save = useCallback(async (): Promise<boolean> => {
    const { activeDraft: pending, questionId: targetId } = latest.current;
    if (!pending || !targetId) {
      return true;
    }
    setSaving(true);
    setNotice({ questionId: targetId, text: t("runner.notices.savingStudyState") });
    try {
      const response = await apiClient.put<StudyState>(`/study/questions/${encodeURIComponent(targetId)}/state`, {
        bookmarked: pending.bookmarked,
        note_text: pending.noteText.trim() ? pending.noteText : null
      });
      queryClient.setQueryData(runnerKeys.studyState(targetId), response);
      // Only clear the draft if nothing changed while the request was in flight.
      setDraft((current) =>
        current && current.questionId === targetId && current.bookmarked === pending.bookmarked && current.noteText === pending.noteText
          ? null
          : current
      );
      const savedScope = formatScope(response.scope, t);
      setNotice({
        questionId: targetId,
        text: response.updated_at
          ? t("runner.notices.savedAt", { date: formatDateTime(response.updated_at), scope: savedScope })
          : t("runner.notices.syncedStatus", { scope: savedScope })
      });
      return true;
    } catch (error) {
      setNotice({
        questionId: targetId,
        text: t("runner.notices.saveFailed", { error: readErrorMessage(error, t("runner.errors.actionFailed")) })
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [queryClient, t]);

  // Debounced autosave while there are pending edits.
  useEffect(() => {
    if (!activeDraft || saving) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void save();
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [activeDraft, save, saving]);

  const reload = useCallback(() => {
    setDraft(null);
    setNotice(null);
    void query.refetch();
  }, [query]);

  return {
    bookmarked,
    noteText,
    scope,
    dirty,
    loading: query.isPending && !!questionId,
    saving,
    notice: derivedNotice,
    setBookmarked: (value) => updateDraft({ bookmarked: value }),
    setNoteText: (value) => updateDraft({ noteText: value }),
    save,
    reload
  };
}
