"use client";

import { useId, useRef, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { inputClassName } from "@/components/ui/input";
import { CharCounter } from "@/features/quiz-builder/components/editor/char-counter";
import { PlusIcon, TrashIcon } from "@/features/quiz-builder/components/icons";
import { CHAR_LIMITS, charLimitState } from "@/features/quiz-builder/lib/limits";
import { OPTIONS_MAX, OPTIONS_MIN, type LocalIssue } from "@/features/quiz-builder/lib/items";
import { ANSWER_LETTERS, ANSWER_SHAPES } from "@/features/quiz-builder/lib/themes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItemOption, LiveItemType } from "@/types/api";

interface OptionEditorProps {
  type: Extract<LiveItemType, "single_choice" | "multi_choice" | "true_false" | "poll">;
  options: LiveItemOption[];
  onChange: (options: LiveItemOption[]) => void;
  readOnly?: boolean;
  issues?: LocalIssue[];
  min?: number;
  max?: number;
}

/**
 * Answer options editor.
 * - single_choice: ≥ 1 correct (contract allows several; any of them scores) — checkboxes.
 * - multi_choice: ≥ 1 correct — checkboxes.
 * - true_false: exactly one correct, fixed T/F rows — radio semantics, no add/remove.
 * - poll: no correct toggle.
 */
export function OptionEditor({
  type,
  options,
  onChange,
  readOnly = false,
  issues = [],
  min = OPTIONS_MIN,
  max = OPTIONS_MAX
}: OptionEditorProps) {
  const { t } = useI18n();
  const baseId = useId();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndex = useRef<number | null>(null);
  const fixed = type === "true_false";
  const hasCorrect = type !== "poll";
  const canAdd = !readOnly && !fixed && options.length < max;
  const canRemove = !readOnly && !fixed && options.length > min;

  useEffect(() => {
    if (focusIndex.current !== null) {
      inputRefs.current[focusIndex.current]?.focus();
      focusIndex.current = null;
    }
  });

  const hint =
    type === "single_choice"
      ? t("quizBuilder.properties.optionsHintSingle")
      : type === "multi_choice"
        ? t("quizBuilder.properties.optionsHintMulti")
        : type === "true_false"
          ? t("quizBuilder.properties.optionsHintTrueFalse")
          : t("quizBuilder.properties.optionsHintPoll");

  const groupIssue = issues.find((issue) => issue.field === "options");

  function update(index: number, patch: Partial<LiveItemOption>) {
    onChange(options.map((option, current) => (current === index ? { ...option, ...patch } : option)));
  }

  function toggleCorrect(index: number) {
    if (fixed) {
      onChange(options.map((option, current) => ({ ...option, correct: current === index })));
      return;
    }
    update(index, { correct: !options[index]?.correct });
  }

  function remove(index: number) {
    focusIndex.current = Math.max(0, index - 1);
    onChange(options.filter((_, current) => current !== index));
  }

  function add() {
    focusIndex.current = options.length;
    onChange([...options, { key: `new-${options.length}`, text: "", correct: false }]);
  }

  return (
    <fieldset className="flex flex-col gap-3" aria-describedby={`${baseId}-hint${groupIssue ? ` ${baseId}-error` : ""}`}>
      <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.properties.options")}</legend>
      <p id={`${baseId}-hint`} className="-mt-1 text-[0.8125rem] leading-snug text-fg-muted">
        {hint}
      </p>
      <ol className="flex flex-col gap-2.5">
        {options.map((option, index) => {
          const letter = ANSWER_LETTERS[index] ?? String(index + 1);
          const shape = ANSWER_SHAPES[index] ?? "";
          const inputId = `${baseId}-option-${index}`;
          const counterId = `${inputId}-counter`;
          const errorId = `${inputId}-error`;
          const state = charLimitState(option.text, CHAR_LIMITS.option);
          const optionIssue = issues.find((issue) => issue.field === `options.${index}`);
          const showCounter = state.level !== "ok" || option.text.length > 0;
          return (
            <li key={`${option.key}-${index}`} className="flex flex-col gap-1">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border bg-surface p-1.5 pr-2 transition-colors",
                  option.correct && hasCorrect ? "border-success/50 bg-success-soft/40" : "border-line"
                )}
              >
                <span
                  aria-hidden="true"
                  className="grid size-8 shrink-0 place-items-center rounded-[5px] text-sm font-semibold"
                  style={{ background: `var(--qb-answer-${index + 1}, #cbd5e1)`, color: `var(--qb-on-answer-${index + 1}, #0b0d12)` }}
                >
                  <span className="text-[0.625rem] leading-none">{shape}</span>
                  <span className="sr-only">{letter}</span>
                </span>
                <span aria-hidden="true" className="w-3 shrink-0 font-mono text-xs font-semibold text-fg-muted">
                  {letter}
                </span>
                <label htmlFor={inputId} className="sr-only">
                  {t("quizBuilder.properties.optionLabel", { letter })}
                </label>
                <input
                  id={inputId}
                  ref={(node) => {
                    inputRefs.current[index] = node;
                  }}
                  value={option.text}
                  readOnly={readOnly || fixed}
                  placeholder={t("quizBuilder.properties.optionPlaceholder", { letter })}
                  aria-invalid={optionIssue || state.level === "block" ? true : undefined}
                  aria-describedby={[showCounter ? counterId : null, optionIssue ? errorId : null].filter(Boolean).join(" ") || undefined}
                  onChange={(event) => update(index, { text: event.target.value })}
                  className={cn(inputClassName, "h-9 min-w-0 flex-1 border-transparent bg-transparent hover:border-line read-only:hover:border-transparent")}
                />
                {hasCorrect ? (
                  <label
                    className={cn(
                      "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium select-none has-focus-visible:outline-2 has-focus-visible:outline-focus",
                      option.correct ? "bg-success-soft text-success" : "text-fg-muted hover:bg-surface-muted",
                      readOnly && "cursor-not-allowed"
                    )}
                  >
                    <input
                      type={fixed ? "radio" : "checkbox"}
                      name={fixed ? `${baseId}-correct` : undefined}
                      checked={option.correct}
                      disabled={readOnly}
                      onChange={() => toggleCorrect(index)}
                      aria-label={t("quizBuilder.properties.markCorrect", { letter })}
                      className="size-4 accent-[var(--color-success)]"
                    />
                    {option.correct ? <CheckIcon size={14} aria-hidden="true" /> : null}
                    <span aria-hidden="true">{t("quizBuilder.properties.correct")}</span>
                  </label>
                ) : null}
                {!fixed ? (
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={!canRemove}
                    aria-label={t("quizBuilder.properties.removeOption", { letter })}
                    title={t("quizBuilder.properties.removeOption", { letter })}
                    className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
              {showCounter ? <CharCounter id={counterId} state={state} className="px-1" /> : null}
              {optionIssue ? (
                <p id={errorId} className="px-1 text-xs font-medium text-danger">
                  {t(`quizBuilder.issues.${optionIssue.code}`)}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {groupIssue ? (
        <p id={`${baseId}-error`} role="alert" className="text-[0.8125rem] font-medium text-danger">
          {t(`quizBuilder.issues.${groupIssue.code}`)}
        </p>
      ) : null}
      {!fixed && !readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={add} disabled={!canAdd}>
            <PlusIcon />
            {t("quizBuilder.properties.addOption")}
          </Button>
          <span className="text-xs text-fg-muted">{t("quizBuilder.properties.optionsLimit", { min, max })}</span>
        </div>
      ) : null}
    </fieldset>
  );
}
