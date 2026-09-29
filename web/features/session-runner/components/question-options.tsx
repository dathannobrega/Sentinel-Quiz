"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { CheckIcon, StrikeIcon, XIcon } from "@/components/ui/icons";
import { isTypingTarget, type AnswerFeedback, type Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import type { OptionItem } from "@/types/api";

export type OptionState = "correct" | "wrong" | "answer" | null;

export function resolveOptionState(optionKey: string, isSelected: boolean, feedback: Pick<AnswerFeedback, "is_correct" | "correct_keys"> | null): OptionState {
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
  // Without the answer key we only know the selection as a whole is right or wrong.
  return feedback.is_correct ? "correct" : "wrong";
}

const LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h"];

interface OptionFaceProps {
  optionKey: string;
  text: ReactNode;
  multiSelect: boolean;
  selected: boolean;
  eliminated?: boolean;
  state: OptionState;
  /** True once the question is graded or locked: no hover affordance. */
  locked: boolean;
  /** Feedback exists and this option is neither chosen nor the key: recede. */
  receded?: boolean;
  t: Translate;
}

/**
 * The visual answer-sheet row: a bubble (circle = one answer, rounded square = several) that fills
 * when chosen, is crossed out when eliminated, and turns into ✓/✗ when graded. State is always
 * spelled out in text as well.
 */
export function OptionFace({ optionKey, text, multiSelect, selected, eliminated = false, state, locked, receded = false, t }: OptionFaceProps) {
  const bubble = cn(
    "grid size-8 shrink-0 place-items-center border-2 font-mono text-[0.8125rem] font-medium uppercase transition-colors duration-150",
    multiSelect ? "rounded-md" : "rounded-full",
    state === "correct" && "border-success bg-success text-surface",
    state === "wrong" && "border-danger bg-danger text-surface",
    state === "answer" && "border-success text-success",
    !state && selected && "border-primary bg-primary text-on-primary",
    !state && !selected && eliminated && "border-dashed border-line-strong text-fg-subtle",
    !state && !selected && !eliminated && "border-line-strong text-fg-muted group-hover/option:border-fg-subtle group-hover/option:text-fg"
  );

  return (
    <>
      <span aria-hidden="true" className={bubble}>
        {state === "correct" || state === "answer" ? (
          <CheckIcon size={15} strokeWidth={2.2} />
        ) : state === "wrong" ? (
          <XIcon size={14} strokeWidth={2.2} />
        ) : (
          optionKey
        )}
      </span>
      <span className="sr-only">{t("runner.option.optionLabel", { key: optionKey })}: </span>
      <span
        className={cn(
          "min-w-0 flex-1 pt-1 text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]",
          eliminated && !selected && !state ? "text-fg-subtle line-through decoration-fg-subtle/70" : "text-fg",
          receded && "text-fg-muted",
          !locked && "group-hover/option:text-fg"
        )}
      >
        {text}
        {eliminated && !selected && !state ? <span className="sr-only"> ({t("runner.elimination.eliminated")})</span> : null}
      </span>
      {state ? (
        <span
          className={cn(
            "mt-1 inline-flex shrink-0 items-center gap-1 text-[0.8125rem] font-semibold whitespace-nowrap",
            state === "wrong" ? "text-danger" : "text-success"
          )}
        >
          <span aria-hidden="true">{state === "wrong" ? "✗" : "✓"}</span>
          {state === "correct" ? t("runner.option.correct") : state === "wrong" ? t("runner.option.wrong") : t("runner.option.answerKey")}
        </span>
      ) : null}
    </>
  );
}

export function optionRowClassName(state: OptionState, selected: boolean, eliminated: boolean, locked: boolean): string {
  return cn(
    "group/option flex items-start gap-4 rounded-lg border px-4 py-3 text-left transition-[border-color,background-color] duration-150",
    state === "correct" && "border-success/50 bg-success-soft",
    state === "wrong" && "border-danger/50 bg-danger-soft",
    state === "answer" && "border-dashed border-success/70 bg-surface",
    !state && selected && "border-primary bg-primary-soft",
    !state && !selected && eliminated && "border-dashed border-line bg-transparent",
    !state && !selected && !eliminated && "border-line bg-surface",
    !locked && !selected && "hover:border-line-strong",
    locked ? "cursor-default" : "cursor-pointer"
  );
}

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
  /** Enter on an already-chosen single-choice option confirms the answer. */
  onConfirm?: () => void;
  t: Translate;
}

/**
 * Answer options as a WAI-ARIA radiogroup (single select) or checkbox group (multi select):
 * roving tabindex, arrow/Home/End navigation, Space/Enter to toggle, A–H / 1–9 shortcuts,
 * X to eliminate the focused option (local study aid, never submitted).
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
  onConfirm,
  t
}: QuestionOptionsProps) {
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [focus, setFocus] = useState<{ questionId: string; index: number } | null>(null);
  const [eliminatedState, setEliminatedState] = useState<{ questionId: string; keys: string[] }>({ questionId, keys: [] });
  const eliminated = eliminatedState.questionId === questionId ? eliminatedState.keys : [];
  const canEliminate = !disabled && !feedback;

  const selectedIndex = options.findIndex((option) => selectedKeys.includes(option.key));
  const focusIndex = focus && focus.questionId === questionId ? focus.index : Math.max(selectedIndex, 0);

  function toggleElimination(optionKey: string) {
    if (!canEliminate) {
      return;
    }
    const isEliminated = eliminated.includes(optionKey);
    setEliminatedState({
      questionId,
      keys: isEliminated ? eliminated.filter((key) => key !== optionKey) : [...eliminated, optionKey]
    });
    // Ruling out the chosen option clears the choice.
    if (!isEliminated && selectedKeys.includes(optionKey)) {
      onToggle(optionKey);
    }
  }

  function choose(optionKey: string) {
    if (eliminated.includes(optionKey)) {
      setEliminatedState({ questionId, keys: eliminated.filter((key) => key !== optionKey) });
    }
    onToggle(optionKey);
  }

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
        choose(option.key);
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>, index: number) {
    const option = options[index];
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
        // Modified Enter (Ctrl/⌘+Enter) is the runner's global "confirm": let it bubble.
        if (event.ctrlKey || event.metaKey || event.altKey) {
          break;
        }
        event.preventDefault();
        if (disabled || !option) {
          break;
        }
        if (multiSelect || !selectedKeys.includes(option.key)) {
          choose(option.key);
        } else if (event.key === "Enter") {
          onConfirm?.();
        }
        break;
      case "x":
      case "X":
        if (!event.altKey && !event.ctrlKey && !event.metaKey && option) {
          event.preventDefault();
          toggleElimination(option.key);
        }
        break;
      default:
        break;
    }
  }

  // Global shortcuts: A–H / 1–9 pick an option directly (not while typing or with modifiers).
  const shortcutState = useRef({ options, disabled, multiSelect, selectedKeys, choose });
  useEffect(() => {
    shortcutState.current = { options, disabled, multiSelect, selectedKeys, choose };
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
        state.choose(option.key);
      }
      setFocus({ questionId, index });
      optionRefs.current[index]?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [questionId]);

  const rows = { gridRow: `1 / span ${Math.max(options.length, 1)}` };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-1 gap-y-2">
      <div
        className="col-start-1 grid grid-rows-subgrid"
        style={rows}
        role={multiSelect ? "group" : "radiogroup"}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
      >
        {options.map((option, index) => {
          const isSelected = selectedKeys.includes(option.key);
          const isEliminated = eliminated.includes(option.key);
          const state = resolveOptionState(option.key, isSelected, feedback);
          const locked = disabled || !!feedback;

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
              data-option-key={option.key}
              onClick={() => {
                setFocus({ questionId, index });
                if (!disabled) {
                  choose(option.key);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn("focus-ring", optionRowClassName(state, isSelected, isEliminated, locked))}
            >
              <OptionFace
                optionKey={option.key}
                text={option.text}
                multiSelect={multiSelect}
                selected={isSelected}
                eliminated={isEliminated}
                state={state}
                locked={locked}
                receded={!!feedback && !state && !isSelected}
                t={t}
              />
            </div>
          );
        })}
      </div>

      {canEliminate ? (
        <div className="col-start-2 grid grid-rows-subgrid" style={rows}>
          {options.map((option) => {
            const isEliminated = eliminated.includes(option.key);
            const label = isEliminated
              ? t("runner.elimination.restore", { key: option.key })
              : t("runner.elimination.eliminate", { key: option.key });
            return (
              // Pointer shortcut; the keyboard path is X on the focused option (one tab stop for the group).
              <button
                key={option.key}
                type="button"
                tabIndex={-1}
                aria-label={label}
                aria-pressed={isEliminated}
                title={label}
                onClick={() => toggleElimination(option.key)}
                className={cn(
                  "mt-1.5 inline-grid size-9 place-items-center self-start rounded-md transition-colors",
                  isEliminated ? "bg-surface-muted text-fg" : "text-fg-subtle hover:bg-surface-muted hover:text-fg"
                )}
              >
                <StrikeIcon />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
