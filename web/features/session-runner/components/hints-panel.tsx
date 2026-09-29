"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { LightbulbIcon } from "@/components/ui/icons";
import { ReferencesList } from "@/features/session-runner/components/references-list";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import type { QuestionHint } from "@/types/api";

interface HintsPanelProps {
  sessionId: string;
  questionId: string;
  /** Hints are locked once the question has been answered. */
  locked: boolean;
  t: Translate;
}

/**
 * Study-mode progressive hints, inline under the options (the "think" step). Mount with
 * `key={questionId}` so state resets per question.
 */
export function HintsPanel({ sessionId, questionId, locked, t }: HintsPanelProps) {
  const [activeHint, setActiveHint] = useState<QuestionHint | null>(null);
  const [loadingLevel, setLoadingLevel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadHint(level: 1 | 2 | 3) {
    if (locked) {
      return;
    }
    setLoadingLevel(level);
    setError(null);
    try {
      const response = await apiClient.get<QuestionHint>(
        `/study/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/hint?level=${level}`
      );
      if (response.question_id === questionId) {
        setActiveHint(response);
      }
    } catch (loadError) {
      setError(readErrorMessage(loadError, t("runner.errors.hintFailed")));
    } finally {
      setLoadingLevel(null);
    }
  }

  if (locked && !activeHint) {
    return null;
  }

  return (
    <section aria-label={t("runner.labels.hints")} className="flex flex-col gap-3">
      {!locked ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-muted">
            <LightbulbIcon className="text-fg-subtle" />
            {t("runner.hintsInline.prompt")}
          </p>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((level) => (
              <Button
                key={level}
                variant="ghost"
                size="sm"
                aria-pressed={activeHint?.level === level}
                busy={loadingLevel === level}
                disabled={loadingLevel !== null && loadingLevel !== level}
                onClick={() => void loadHint(level)}
                className="aria-pressed:bg-surface-muted aria-pressed:text-fg"
              >
                {t("runner.hints.hintButton", { level })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-[0.8125rem] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <div aria-live="polite">
        {activeHint ? (
          <div className="flex flex-col gap-2 border-l-2 border-warning/60 py-1 pl-4">
            <p className="text-xs font-semibold tracking-wide text-warning uppercase">{t("runner.labels.level", { level: activeHint.level })}</p>
            <p className="font-medium text-fg">{activeHint.title}</p>
            <p className="font-serif text-[0.9375rem] leading-relaxed text-fg">{activeHint.message}</p>
            {activeHint.caution ? <p className="text-[0.8125rem] text-fg-muted">{activeHint.caution}</p> : null}
            <ReferencesList references={activeHint.references} ariaLabel={t("runner.labels.referencesHintAria")} t={t} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
