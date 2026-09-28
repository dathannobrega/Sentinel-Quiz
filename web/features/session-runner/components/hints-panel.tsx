"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
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

/** Study-mode progressive hints. Mount with `key={questionId}` so state resets per question. */
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

  return (
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{t("runner.labels.hints")}</div>
          <div className="sq-list-meta">{t("runner.labels.hintsSubtitle")}</div>
        </div>
        <span className="sq-chip">
          {activeHint ? t("runner.labels.level", { level: activeHint.level }) : t("common.status.closed")}
        </span>
      </div>

      <div className="sq-actions sq-gap-top-sm">
        {([1, 2, 3] as const).map((level) => (
          <Button
            key={level}
            variant="ghost"
            size="sm"
            busy={loadingLevel === level}
            disabled={locked || (loadingLevel !== null && loadingLevel !== level)}
            onClick={() => void loadHint(level)}
          >
            {t("runner.hints.hintButton", { level })}
          </Button>
        ))}
      </div>

      {error ? (
        <div className="sq-list-meta sq-gap-top-sm" role="alert">
          {error}
        </div>
      ) : null}

      <div aria-live="polite">
        {activeHint ? (
          <div className="sq-stack-sm sq-gap-top-sm">
            <div className="sq-list-title">{activeHint.title}</div>
            <div className="sq-list-meta">{activeHint.message}</div>
            <div className="sq-list-meta">{activeHint.caution}</div>
            <ReferencesList references={activeHint.references} ariaLabel={t("runner.labels.referencesHintAria")} t={t} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
