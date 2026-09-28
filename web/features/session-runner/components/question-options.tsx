"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { isTypingTarget, type AnswerFeedback, type Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import type { OptionItem } from "@/types/api";

interface QuestionOptionsProps {
  questionId: string;
  options: OptionItem[];
  multiSelect: boolean;
  selectedKeys: string[];
  disabled: boolean;
  /** Feedback to render per-option state for; null hides correctness (e.g. exam-day mode). */
  feedback: AnswerFeedback | null;
  labelledBy: string;
  describedBy?: string;
  onToggle: (optionKey: string) => void;
  t: Translate;
}

type OptionState = "correct" | "wrong" | "answer" | null;

function resolveOptionState(
  optionKey: string,
  isSelected: boolean,
  feedback: AnswerFeedback | null
): OptionState {
  if (!feedback) {
    return null;
  }
  const correctKeys = feedback.correct_keys ?? null;
  if (correctKeys && correctKeys.length) {
    const isCorrectKey = correctKeys.includes(optionKey);
    if (isSelected) {
      return isCorrectKey ? "correct" : "wrong";
    }
    return isCorrectKey ? "answer" : null;
  }
  if (!isSelected) {
    return null;
  }
  if (feedback.is_correct) {
    return "correct";
  }
  // Without the answer key we only know the selection as a whole is wrong.
  return "wrong";
}

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

/**
 * Answer options as a WAI-ARIA radiogroup (single select) or checkbox group (multi select):
 * roving tabindex, arrow/Home/End navigation, Space/Enter to toggle, A–E / 1–5 shortcuts.
 */
export function QuestionOptions({
  questionId,
  options,
  multiSelect,
  selectedKeys,
  disabled,
  feedback,
  labelledBy,
  describedBy,
  onToggle,
  t
}: QuestionOptionsProps) {
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [focus, setFocus] = useState<{ questionId: string; index: number } | null>(null);

  const selectedIndex = options.findIndex((option) => selectedKeys.includes(option.key));
  const focusIndex = focus && focus.questionId === questionId ? focus.index : Math.max(selectedIndex, 0);

  function moveFocus(nextIndex: number) {
    const count = options.length;
    if (!count) {
      return;
    }
    const index = ((nextIndex % count) + count) % count;
    setFocus({ questionId, index });
    optionRefs.current[index]?.focus();
    if (!multiSelect && !disabled) {
      const option = options[index];
      if (option && !selectedKeys.includes(option.key)) {
        onToggle(option.key);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        moveFocus(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(index - 1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus(0);
        break;
      case "End":
        event.preventDefault();
        moveFocus(options.length - 1);
        break;
      case " ":
      case "Enter":
        event.preventDefault();
        if (!disabled) {
          const option = options[index];
          if (option && (multiSelect || !selectedKeys.includes(option.key))) {
            onToggle(option.key);
          }
        }
        break;
      default:
        break;
    }
  }

  // Global shortcuts: A–E / 1–5 pick an option directly (not while typing or with modifiers).
  const shortcutState = useRef({ options, disabled, multiSelect, selectedKeys, onToggle });
  useEffect(() => {
    shortcutState.current = { options, disabled, multiSelect, selectedKeys, onToggle };
  });

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const state = shortcutState.current;
      if (state.disabled || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (isTypingTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      let index = -1;
      if (/^[1-9]$/.test(key)) {
        index = Number(key) - 1;
      } else if (LETTERS.includes(key)) {
        const byKey = state.options.findIndex((option) => option.key.toLowerCase() === key);
        index = byKey >= 0 ? byKey : LETTERS.indexOf(key);
      }
      const option = index >= 0 ? state.options[index] : undefined;
      if (!option) {
        return;
      }
      event.preventDefault();
      if (state.multiSelect || !state.selectedKeys.includes(option.key)) {
        state.onToggle(option.key);
      }
      setFocus({ questionId, index });
      optionRefs.current[index]?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [questionId]);

  return (
    <div
      className="sq-list"
      role={multiSelect ? "group" : "radiogroup"}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled || undefined}
    >
      {options.map((option, index) => {
        const isSelected = selectedKeys.includes(option.key);
        const state = resolveOptionState(option.key, isSelected, feedback);

        return (
          <div
            key={option.key}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            role={multiSelect ? "checkbox" : "radio"}
            aria-checked={isSelected}
            aria-disabled={disabled || undefined}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => {
              setFocus({ questionId, index });
              if (!disabled) {
                onToggle(option.key);
              }
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "sq-list-item sq-runner-option sq-choice-card",
              state === "correct" && "sq-choice-card--correct",
              state === "wrong" && "sq-choice-card--wrong",
              state === "answer" && "sq-choice-card--answer",
              !state && isSelected && "sq-choice-card--selected",
              disabled && "sq-runner-option--locked"
            )}
          >
            <div className="sq-runner-option__body">
              <span className="sq-chip" aria-hidden="true">
                {option.key}
              </span>
              <span className="sq-visually-hidden">{t("runner.option.optionLabel", { key: option.key })}: </span>
              <span>{option.text}</span>
              {state === "correct" ? (
                <span className="sq-choice-card__state sq-choice-card__state--correct">
                  <span aria-hidden="true">✓</span> {t("runner.option.correct")}
                </span>
              ) : null}
              {state === "wrong" ? (
                <span className="sq-choice-card__state sq-choice-card__state--wrong">
                  <span aria-hidden="true">✗</span> {t("runner.option.wrong")}
                </span>
              ) : null}
              {state === "answer" ? (
                <span className="sq-choice-card__state sq-choice-card__state--correct">
                  <span aria-hidden="true">✓</span> {t("runner.option.answerKey")}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
