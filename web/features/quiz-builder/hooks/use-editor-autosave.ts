"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createAutosaver, mergePatch, type Autosaver, type AutosaveSnapshot, type Patch } from "@/features/quiz-builder/lib/autosave";
import { applyItemPatch, hasBlockingIssue } from "@/features/quiz-builder/lib/items";
import { CHAR_LIMITS, charLength } from "@/features/quiz-builder/lib/limits";
import { isVersionConflict, updateLiveItem, updateLiveQuiz } from "@/lib/api/live-authoring";
import { liveKeys, type QuizMutator } from "@/lib/query/live-hooks";
import type { LiveItemWrite, LiveQuizDetail, LiveQuizSettings, LiveQuizUpdate } from "@/types/api";

/** Autosave key for quiz-level fields (title, description, theme, settings). Items use their id. */
export const QUIZ_KEY = "__quiz__";
export const AUTOSAVE_DELAY_MS = 800;

export type QuizPatch = Omit<LiveQuizUpdate, "expected_version">;

const SETTING_RANGES: Partial<Record<keyof LiveQuizSettings, [number, number]>> = {
  reading_phase_s: [0, 10],
  grace_ms: [0, 1500],
  leaderboard_every: [0, 20]
};

export function isQuizPatchValid(patch: QuizPatch): boolean {
  if (patch.title !== undefined && (!patch.title.trim() || charLength(patch.title) > CHAR_LIMITS.title.max)) {
    return false;
  }
  if (patch.description && charLength(patch.description) > CHAR_LIMITS.description.max) {
    return false;
  }
  for (const [key, range] of Object.entries(SETTING_RANGES)) {
    const value = patch.settings?.[key as keyof LiveQuizSettings];
    if (typeof value === "number" && (!Number.isInteger(value) || value < range[0] || value > range[1])) {
      return false;
    }
  }
  return true;
}

export interface EditorAutosave {
  snapshot: AutosaveSnapshot<Patch>;
  saver: Autosaver<Patch>;
  scheduleItem: (itemId: string, patch: LiveItemWrite) => void;
  scheduleQuiz: (patch: QuizPatch) => void;
  /** pending ⊕ in-flight patch for a key (what the UI must overlay on the server data). */
  overlay: (key: string) => Patch | undefined;
}

export function useEditorAutosave(quizId: string, mutator: QuizMutator): EditorAutosave {
  const queryClient = useQueryClient();
  // `mutator.run` is stable for a given quiz (its deps are the query client, the queue and the id),
  // and the editor is keyed by quiz id, so the autosaver can capture it once.
  const run = mutator.run;

  const [saver] = useState<Autosaver<Patch>>(() =>
    createAutosaver<Patch>({
      delayMs: AUTOSAVE_DELAY_MS,
      merge: mergePatch,
      isConflict: isVersionConflict,
      canSave: (key, patch) => {
        if (key === QUIZ_KEY) {
          return isQuizPatchValid(patch as QuizPatch);
        }
        const quiz = queryClient.getQueryData<LiveQuizDetail>(liveKeys.quiz(quizId));
        const item = quiz?.items.find((entry) => entry.id === key);
        return item ? !hasBlockingIssue(applyItemPatch(item, patch as LiveItemWrite)) : true;
      },
      save: async (key, patch) => {
        if (key === QUIZ_KEY) {
          await run((version) => updateLiveQuiz(quizId, { ...(patch as QuizPatch), expected_version: version }));
          return;
        }
        await run((version) => updateLiveItem(quizId, key, version, patch as LiveItemWrite));
      }
    })
  );

  const snapshot = useSyncExternalStore(saver.subscribe, saver.getSnapshot, saver.getSnapshot);

  useEffect(() => {
    return () => {
      // Leaving the editor: save what is pending right away instead of dropping it.
      void saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    const dirty = Object.keys(snapshot.pending).length > 0 || Object.keys(snapshot.inflight).length > 0;
    if (!dirty) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [snapshot.pending, snapshot.inflight]);

  const scheduleItem = useCallback((itemId: string, patch: LiveItemWrite) => saver.schedule(itemId, patch as Patch), [saver]);
  const scheduleQuiz = useCallback((patch: QuizPatch) => saver.schedule(QUIZ_KEY, patch as Patch), [saver]);
  const overlay = useCallback(
    (key: string): Patch | undefined => {
      const inflight = snapshot.inflight[key];
      const pending = snapshot.pending[key];
      if (!inflight) return pending;
      if (!pending) return inflight;
      return mergePatch(inflight, pending);
    },
    [snapshot]
  );

  return { snapshot, saver, scheduleItem, scheduleQuiz, overlay };
}
