"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { XIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { CHAR_LIMITS, charLength } from "@/features/quiz-builder/lib/limits";
import { normalizeAnswer, type LocalIssue } from "@/features/quiz-builder/lib/items";
import { useI18n } from "@/lib/i18n";

const MAX_ANSWERS = 10;

interface AcceptedAnswersEditorProps {
  answers: string[];
  onChange: (answers: string[]) => void;
  readOnly?: boolean;
  issues?: LocalIssue[];
}

/** Chips of accepted answers for type_answer (1..10, ≤ 60 chars, duplicates by normalized form). */
export function AcceptedAnswersEditor({ answers, onChange, readOnly = false, issues = [] }: AcceptedAnswersEditorProps) {
  const { t } = useI18n();
  const baseId = useId();
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const issue = issues.find((item) => item.field === "accepted_answers");
  const error = localError ?? (issue ? t(`quizBuilder.issues.${issue.code}`) : null);
  const full = answers.length >= MAX_ANSWERS;

  function add() {
    const value = draft.trim();
    if (!value) {
      return;
    }
    if (full) {
      setLocalError(t("quizBuilder.properties.acceptedMax"));
      return;
    }
    if (charLength(value) > CHAR_LIMITS.acceptedAnswer.max) {
      setLocalError(t("quizBuilder.properties.acceptedTooLong"));
      return;
    }
    const normalized = normalizeAnswer(value);
    if (answers.some((answer) => normalizeAnswer(answer) === normalized)) {
      setLocalError(t("quizBuilder.properties.acceptedDuplicate"));
      return;
    }
    onChange([...answers, value]);
    setDraft("");
    setLocalError(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !draft && answers.length) {
      onChange(answers.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${baseId}-input`} className="text-[0.8125rem] font-medium text-fg">
        {t("quizBuilder.properties.accepted")}
      </label>
      <p id={`${baseId}-hint`} className="-mt-1 text-[0.8125rem] leading-snug text-fg-muted">
        {t("quizBuilder.properties.acceptedHint")}
      </p>
      {answers.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("quizBuilder.properties.accepted")}>
          {answers.map((answer, index) => (
            <li
              key={`${answer}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-success/40 bg-success-soft py-0.5 pr-1 pl-3 text-[0.8125rem] text-fg motion-safe:animate-[pop-in_200ms_var(--ease-out)]"
            >
              <span className="truncate">{answer}</span>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => onChange(answers.filter((_, current) => current !== index))}
                  aria-label={t("quizBuilder.properties.acceptedRemove", { answer })}
                  className="focus-ring grid size-6 place-items-center rounded-full text-fg-muted hover:bg-surface hover:text-danger"
                >
                  <XIcon size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!readOnly ? (
        <div className="flex gap-2">
          <Input
            id={`${baseId}-input`}
            value={draft}
            disabled={full}
            placeholder={t("quizBuilder.properties.acceptedPlaceholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${baseId}-hint${error ? ` ${baseId}-error` : ""}`}
            onChange={(event) => {
              setDraft(event.target.value);
              setLocalError(null);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (draft.trim()) add();
            }}
          />
          <Button variant="secondary" onClick={add} disabled={!draft.trim() || full}>
            {t("quizBuilder.properties.acceptedAdd")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p id={`${baseId}-error`} role="alert" className="text-[0.8125rem] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
