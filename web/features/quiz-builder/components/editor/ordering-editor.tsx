"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { inputClassName } from "@/components/ui/input";
import { CharCounter } from "@/features/quiz-builder/components/editor/char-counter";
import { PlusIcon, TrashIcon } from "@/features/quiz-builder/components/icons";
import { CHAR_LIMITS, charLimitState } from "@/features/quiz-builder/lib/limits";
import { moveInArray, ORDER_MAX, ORDER_MIN, type LocalIssue } from "@/features/quiz-builder/lib/items";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItemOption, LiveOrderMethod } from "@/types/api";

interface OrderingEditorProps {
  options: LiveItemOption[];
  method: LiveOrderMethod;
  onChange: (options: LiveItemOption[]) => void;
  onMethodChange: (method: LiveOrderMethod) => void;
  readOnly?: boolean;
  /** Method can still change on bank items (grading, not content). */
  methodReadOnly?: boolean;
  issues?: LocalIssue[];
}

/**
 * Ordering items editor (T05). The list IS the answer key: the author writes the items in the
 * correct order (3 to 6) and reorders them with "move up/down" buttons (no drag needed). Participants
 * receive them shuffled. The grading method is Kendall (partial credit) or exact.
 */
export function OrderingEditor({ options, method, onChange, onMethodChange, readOnly = false, methodReadOnly = readOnly, issues = [] }: OrderingEditorProps) {
  const { t } = useI18n();
  const baseId = useId();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const moveRefs = useRef<Array<{ up: HTMLButtonElement | null; down: HTMLButtonElement | null }>>([]);
  const focus = useRef<{ index: number; target: "input" | "up" | "down" } | null>(null);
  const [status, setStatus] = useState("");
  const canAdd = !readOnly && options.length < ORDER_MAX;
  const canRemove = !readOnly && options.length > ORDER_MIN;
  const groupIssue = issues.find((issue) => issue.field === "options");

  useEffect(() => {
    const pending = focus.current;
    if (!pending) {
      return;
    }
    focus.current = null;
    if (pending.target === "input") {
      inputRefs.current[pending.index]?.focus();
      return;
    }
    const buttons = moveRefs.current[pending.index];
    const preferred = buttons?.[pending.target];
    (preferred && !preferred.disabled ? preferred : pending.target === "up" ? buttons?.down : buttons?.up)?.focus();
  });

  function update(index: number, text: string) {
    onChange(options.map((option, current) => (current === index ? { ...option, text } : option)));
  }

  function move(index: number, direction: "up" | "down") {
    const to = direction === "up" ? index - 1 : index + 1;
    if (to < 0 || to >= options.length) {
      return;
    }
    focus.current = { index: to, target: direction };
    onChange(moveInArray(options, index, to));
    const text = options[index]?.text.trim() || t("quizBuilder.ordering.itemN", { n: index + 1 });
    setStatus(t("quizBuilder.ordering.moved", { text, position: to + 1, total: options.length }));
  }

  function remove(index: number) {
    focus.current = { index: Math.max(0, index - 1), target: "input" };
    onChange(options.filter((_, current) => current !== index));
  }

  function add() {
    focus.current = { index: options.length, target: "input" };
    onChange([...options, { key: `new-${options.length}`, text: "", correct: false }]);
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-3" aria-describedby={`${baseId}-hint${groupIssue ? ` ${baseId}-error` : ""}`}>
        <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.ordering.items")}</legend>
        <p id={`${baseId}-hint`} className="-mt-1 text-[0.8125rem] leading-snug text-fg-muted">
          {t("quizBuilder.ordering.hint")}
        </p>
        <ol className="flex flex-col gap-2.5">
          {options.map((option, index) => {
            const inputId = `${baseId}-item-${index}`;
            const counterId = `${inputId}-counter`;
            const errorId = `${inputId}-error`;
            const state = charLimitState(option.text, CHAR_LIMITS.option);
            const issue = issues.find((entry) => entry.field === `options.${index}`);
            const showCounter = state.level !== "ok" || option.text.length > 0;
            const label = option.text.trim() || t("quizBuilder.ordering.itemN", { n: index + 1 });
            return (
              <li key={`${option.key}-${index}`} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 rounded-md border border-line bg-surface p-1.5 pr-2">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-[5px] bg-surface-muted font-mono text-sm font-semibold text-fg">
                    {index + 1}
                  </span>
                  <label htmlFor={inputId} className="sr-only">
                    {t("quizBuilder.ordering.itemLabel", { n: index + 1 })}
                  </label>
                  <input
                    id={inputId}
                    ref={(node) => {
                      inputRefs.current[index] = node;
                    }}
                    value={option.text}
                    readOnly={readOnly}
                    placeholder={t("quizBuilder.ordering.itemPlaceholder", { n: index + 1 })}
                    aria-invalid={issue || state.level === "block" ? true : undefined}
                    aria-describedby={[showCounter ? counterId : null, issue ? errorId : null].filter(Boolean).join(" ") || undefined}
                    onChange={(event) => update(index, event.target.value)}
                    className={cn(inputClassName, "h-9 min-w-0 flex-1 border-transparent bg-transparent hover:border-line read-only:hover:border-transparent")}
                  />
                  {!readOnly ? (
                    <>
                      {(["up", "down"] as const).map((direction) => (
                        <button
                          key={direction}
                          type="button"
                          ref={(node) => {
                            moveRefs.current[index] = { ...(moveRefs.current[index] ?? { up: null, down: null }), [direction]: node };
                          }}
                          onClick={() => move(index, direction)}
                          disabled={direction === "up" ? index === 0 : index === options.length - 1}
                          aria-label={t(direction === "up" ? "quizBuilder.ordering.moveUp" : "quizBuilder.ordering.moveDown", { text: label })}
                          title={t(direction === "up" ? "quizBuilder.ordering.moveUp" : "quizBuilder.ordering.moveDown", { text: label })}
                          className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                        >
                          <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4", direction === "down" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 10l4-4 4 4" />
                          </svg>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        disabled={!canRemove}
                        aria-label={t("quizBuilder.ordering.remove", { text: label })}
                        title={t("quizBuilder.ordering.remove", { text: label })}
                        className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted"
                      >
                        <TrashIcon />
                      </button>
                    </>
                  ) : null}
                </div>
                {showCounter ? <CharCounter id={counterId} state={state} className="px-1" /> : null}
                {issue ? (
                  <p id={errorId} className="px-1 text-xs font-medium text-danger">
                    {t(`quizBuilder.issues.${issue.code}`)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p aria-live="polite" className="sr-only">
          {status}
        </p>
        {groupIssue ? (
          <p id={`${baseId}-error`} role="alert" className="text-[0.8125rem] font-medium text-danger">
            {t(`quizBuilder.issues.${groupIssue.code}`)}
          </p>
        ) : null}
        {!readOnly ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={add} disabled={!canAdd}>
              <PlusIcon />
              {t("quizBuilder.ordering.add")}
            </Button>
            <span className="text-xs text-fg-muted">{t("quizBuilder.ordering.limit", { min: ORDER_MIN, max: ORDER_MAX })}</span>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.ordering.method")}</legend>
        {(["kendall", "exact"] as const).map((value) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 has-focus-visible:outline-2 has-focus-visible:outline-focus",
              method === value ? "border-primary bg-primary-soft/40" : "border-line hover:border-line-strong",
              methodReadOnly && "cursor-not-allowed opacity-80"
            )}
          >
            <input
              type="radio"
              name={`${baseId}-method`}
              checked={method === value}
              disabled={methodReadOnly}
              onChange={() => onMethodChange(value)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[0.8125rem] font-semibold text-fg">{t(`quizBuilder.ordering.methods.${value}.name`)}</span>
              <span className="text-xs leading-snug text-fg-muted">{t(`quizBuilder.ordering.methods.${value}.description`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
