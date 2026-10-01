"use client";

import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { LqButton, LqInput } from "@/features/quiz-live/components/lq-ui";
import { vibrate } from "@/features/quiz-live/components/live-chrome";
import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import { WORD_MAX_LENGTH, WORDS_PER_PERSON_MAX, type PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { cleanWords } from "@/features/quiz-live/lib/word-cloud";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/** Clamp of the item's `max_words` (1..3; older payloads without it get 1). */
export function wordSlots(question: Pick<PublicQuestion, "max_words">): number {
  const value = Math.round(Number(question.max_words ?? 1));
  return Math.min(WORDS_PER_PERSON_MAX, Math.max(1, Number.isFinite(value) ? value : 1));
}

/**
 * Word cloud answer (T08): one field per allowed word (1..3), each up to 25 characters with a
 * counter. Enter moves to the next field and sends from the last one. Repeated words (ignoring case
 * and accents) count once, as on the server. Sends `words`.
 */
export function WordCloudPad({
  question,
  disabled = false,
  onSubmit
}: {
  question: PublicQuestion;
  disabled?: boolean;
  onSubmit: (answer: LiveAnswerDraft) => void;
}) {
  const { t } = useI18n();
  const slots = wordSlots(question);
  const baseId = useId();
  const [values, setValues] = useState<string[]>(() => Array.from({ length: slots }, () => ""));
  const [sent, setSent] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const locked = disabled || sent;
  const words = cleanWords(values, slots);
  const filled = values.filter((value) => value.trim()).length;
  const repeated = filled > words.length;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (locked || !words.length) {
      return;
    }
    vibrate(15);
    setSent(true);
    onSubmit({ words });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key !== "Enter" || index >= slots - 1) {
      return;
    }
    event.preventDefault();
    inputs.current[index + 1]?.focus();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-lq-fg-muted">
        {slots === 1 ? t("quizPlay.words.hintOne") : t("quizPlay.words.hintMany", { count: slots })}
      </p>
      {values.map((value, index) => {
        const inputId = `${baseId}-${index}`;
        const length = Array.from(value).length;
        return (
          <div key={index} className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm font-semibold text-lq-fg">
              {slots === 1 ? t("quizPlay.words.labelOne") : t("quizPlay.words.label", { n: index + 1 })}
            </label>
            <LqInput
              id={inputId}
              ref={(node) => {
                inputs.current[index] = node;
              }}
              value={value}
              onChange={(event) => {
                const next = Array.from(event.target.value).slice(0, WORD_MAX_LENGTH).join("");
                setValues((current) => current.map((entry, position) => (position === index ? next : entry)));
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              maxLength={WORD_MAX_LENGTH}
              placeholder={t("quizPlay.words.placeholder")}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint={index < slots - 1 ? "next" : "send"}
              aria-describedby={`${inputId}-counter`}
              disabled={locked}
              className="min-h-14 text-xl"
            />
            <span id={`${inputId}-counter`} className={cn("self-end font-lq-mono text-xs tabular-nums", length >= WORD_MAX_LENGTH ? "text-lq-warning" : "text-lq-fg-muted")}>
              {t("quizPlay.words.counter", { count: length, max: WORD_MAX_LENGTH })}
            </span>
          </div>
        );
      })}
      {repeated ? (
        <p role="status" className="text-sm text-lq-fg-muted">
          {t("quizPlay.words.repeated")}
        </p>
      ) : null}
      <LqButton type="submit" size="lg" disabled={locked || !words.length}>
        {words.length > 1 ? t("quizPlay.words.sendMany", { count: words.length }) : t("quizPlay.question.send")}
      </LqButton>
    </form>
  );
}
