"use client";

import { useId, useState, type FormEvent } from "react";
import { m } from "motion/react";

import { springs, staggerDelay, staggers, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { OptionBadge, OptionPattern } from "@/components/quiz-kit/option-shape";
import { LqButton, LqInput } from "@/features/quiz-live/components/lq-ui";
import { vibrate } from "@/features/quiz-live/components/live-chrome";
import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import { allowsMultipleChoices, optionLetter, type PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const TYPE_ANSWER_MAX = 60;

function gridFor(question: PublicQuestion): string {
  const count = question.options.length;
  if (question.item_type === "true_false" || count <= 2) {
    return "grid-cols-1 min-[420px]:grid-cols-2";
  }
  return "grid-cols-2";
}

/**
 * Answer input per item type (mobile-first, tactile):
 * - single / true-false / single poll: tap a tile → sent at once (the chosen tile grows, others recede);
 * - multi / multi poll: toggle tiles + "Enviar" with a "selecione N" hint;
 * - type answer: one big input.
 * Each tile carries shape + letter + colour + text (never colour alone) and is ≥ 44 px.
 */
export function AnswerPad({
  question,
  disabled = false,
  onSubmit
}: {
  question: PublicQuestion;
  disabled?: boolean;
  onSubmit: (answer: LiveAnswerDraft) => void;
}) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const multiple = allowsMultipleChoices(question);
  const [selected, setSelected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const hintId = useId();
  const inputId = useId();
  const options = [...question.options].sort((a, b) => a.index - b.index);
  const locked = disabled || picked !== null;

  if (question.item_type === "type_answer") {
    const submitText = (event: FormEvent) => {
      event.preventDefault();
      const value = text.trim();
      if (!value || locked) {
        return;
      }
      vibrate(15);
      setPicked(value);
      onSubmit({ text: value });
    };
    return (
      <form onSubmit={submitText} className="flex flex-col gap-3">
        <label htmlFor={inputId} className="text-sm font-semibold text-lq-fg">
          {t("quizPlay.question.typeLabel")}
        </label>
        <LqInput
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, TYPE_ANSWER_MAX))}
          placeholder={t("quizPlay.question.typePlaceholder")}
          maxLength={TYPE_ANSWER_MAX}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          disabled={locked}
          className="min-h-16 text-2xl"
        />
        <LqButton type="submit" size="lg" disabled={locked || !text.trim()}>
          {t("quizPlay.question.send")}
        </LqButton>
      </form>
    );
  }

  function choose(optionId: string) {
    if (locked) {
      return;
    }
    if (multiple) {
      vibrate(8);
      setSelected((current) => (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]));
      return;
    }
    vibrate(15);
    setPicked(optionId);
    onSubmit({ choice: [optionId] });
  }

  function submitMultiple() {
    if (locked || selected.length === 0) {
      return;
    }
    vibrate(15);
    setPicked(selected.join(","));
    onSubmit({ choice: options.filter((option) => selected.includes(option.id)).map((option) => option.id) });
  }

  const hint = multiple
    ? question.item_type === "multi_choice" && question.select_count
      ? t("quizPlay.question.selectN", { count: question.select_count })
      : t("quizPlay.question.selectAny")
    : t("quizPlay.question.choose");

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p id={hintId} className="text-center text-sm font-semibold text-lq-fg-muted">
        {hint}
        {multiple && selected.length > 0 ? ` · ${t("quizPlay.question.selectedCount", { count: selected.length })}` : null}
      </p>
      <div role="group" aria-describedby={hintId} className={cn("grid flex-1 auto-rows-fr gap-3", gridFor(question))}>
        {options.map((option, position) => {
          const isSelected = multiple ? selected.includes(option.id) : picked === option.id;
          const receded = !multiple && picked !== null && picked !== option.id;
          return (
            <m.button
              key={option.id}
              type="button"
              onClick={() => choose(option.id)}
              disabled={disabled}
              aria-pressed={multiple ? isSelected : undefined}
              aria-label={t("quizPlay.question.option", { letter: optionLetter(option.index), text: option.text })}
              initial={reduced ? false : { y: 16, scale: 0.92 }}
              animate={{ y: 0, scale: isSelected && !multiple ? 1.04 : receded ? 0.94 : 1 }}
              whileTap={locked ? undefined : { scale: 0.96 }}
              transition={{ ...springs.snappy, delay: reduced ? 0 : staggerDelay(position, options.length, staggers.phone) }}
              data-dim={receded || undefined}
              className={cn(
                "lq-tile focus-ring flex min-h-[4.5rem] flex-col items-start justify-between gap-2 overflow-hidden p-3 text-left sm:min-h-24 sm:p-4",
                `lq-slot-${option.index % 6}`,
                question.item_type === "true_false" && "min-h-32 items-center justify-center text-center",
                multiple && isSelected && "outline-[3px] outline-offset-2 outline-lq-fg",
                disabled && "cursor-not-allowed"
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <OptionBadge index={option.index} size={question.item_type === "true_false" ? "lg" : "md"} />
                {multiple ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-7 place-items-center rounded-md border-2 border-current font-lq-mono text-sm",
                      isSelected ? "bg-[var(--lq-on-tile)] text-[var(--lq-tile)]" : ""
                    )}
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                ) : null}
              </span>
              <span className={cn("line-clamp-4 w-full font-lq leading-snug font-bold", question.item_type === "true_false" ? "text-2xl" : "text-base sm:text-lg")}>
                {option.text}
              </span>
              <OptionPattern className="inset-x-0 bottom-0 h-2" />
            </m.button>
          );
        })}
      </div>
      {multiple ? (
        <LqButton size="lg" onClick={submitMultiple} disabled={locked || selected.length === 0}>
          {t("quizPlay.question.send")}
        </LqButton>
      ) : null}
    </div>
  );
}
