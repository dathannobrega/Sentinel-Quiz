"use client";

import { useId, useState, type FormEvent } from "react";

import { LqButton, LqError, LqInput } from "@/features/quiz-live/components/lq-ui";
import { vibrate } from "@/features/quiz-live/components/live-chrome";
import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import {
  formatNumber,
  formatNumberInput,
  initialSliderValue,
  numericInputError,
  parseLocaleNumber,
  stepDecimals
} from "@/features/quiz-live/lib/numeric";
import type { NumericSpec, PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { useI18n } from "@/lib/i18n";

const FALLBACK_SPEC: NumericSpec = { min: 0, max: 100, step: null, unit: "" };

/**
 * Numeric answer (T06): a text field (`inputmode="decimal"`) read in the UI locale ("1.234,5" in
 * pt-BR, "1,234.5" in en-US) and a range slider kept in sync. Range and unit stay visible; a value
 * outside the range or not a number shows an inline error and cannot be sent. Sends `number` as a
 * JSON number.
 */
export function NumericPad({
  question,
  disabled = false,
  onSubmit
}: {
  question: PublicQuestion;
  disabled?: boolean;
  onSubmit: (answer: LiveAnswerDraft) => void;
}) {
  const { t, locale } = useI18n();
  const spec = question.numeric ?? FALLBACK_SPEC;
  const inputId = useId();
  const sliderId = useId();
  const rangeId = useId();
  const errorId = useId();
  const [text, setText] = useState("");
  const [slider, setSlider] = useState(() => initialSliderValue(spec));
  const [sent, setSent] = useState(false);
  const locked = disabled || sent;
  const unit = spec.unit.trim();
  const digits = stepDecimals(spec.step);
  const error = numericInputError(text, spec, locale);
  const value = parseLocaleNumber(text, locale);
  const ready = value !== null && !error;
  const withUnit = (number: number) => (unit ? `${formatNumber(number, locale, digits)} ${unit}` : formatNumber(number, locale, digits));

  function onText(next: string) {
    setText(next);
    const parsed = parseLocaleNumber(next, locale);
    if (parsed !== null && parsed >= spec.min && parsed <= spec.max) {
      setSlider(parsed);
    }
  }

  function onSlide(next: number) {
    setSlider(next);
    setText(formatNumberInput(next, locale, spec.step));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !ready || value === null) {
      return;
    }
    vibrate(15);
    setSent(true);
    onSubmit({ number: value });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-semibold text-lq-fg">
          {t("quizPlay.numeric.label")}
        </label>
        <div className="flex items-center gap-3">
          <LqInput
            id={inputId}
            value={text}
            onChange={(event) => onText(event.target.value.slice(0, 32))}
            inputMode="decimal"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            placeholder={formatNumberInput(initialSliderValue(spec), locale, spec.step)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${rangeId} ${errorId}` : rangeId}
            disabled={locked}
            className="min-h-16 flex-1 font-lq-mono text-3xl tabular-nums"
          />
          {unit ? <span className="max-w-[40%] shrink-0 font-lq text-2xl font-bold break-words text-lq-fg">{unit}</span> : null}
        </div>
        <p id={rangeId} className="text-sm text-lq-fg-muted">
          {t("quizPlay.numeric.range", { min: withUnit(spec.min), max: withUnit(spec.max) })}
        </p>
        {error ? (
          <LqError id={errorId}>{error === "invalid" ? t("quizPlay.numeric.invalid") : t("quizPlay.numeric.outOfRange", { min: withUnit(spec.min), max: withUnit(spec.max) })}</LqError>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={sliderId} className="text-sm font-semibold text-lq-fg-muted">
          {t("quizPlay.numeric.slider")}
        </label>
        <input
          id={sliderId}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step && spec.step > 0 ? spec.step : "any"}
          value={slider}
          disabled={locked}
          aria-valuetext={withUnit(slider)}
          onChange={(event) => onSlide(Number(event.target.value))}
          className="h-11 w-full cursor-pointer accent-[var(--lq-accent)] disabled:cursor-not-allowed"
        />
        <div aria-hidden="true" className="flex justify-between font-lq-mono text-xs text-lq-fg-muted">
          <span>{withUnit(spec.min)}</span>
          <span>{withUnit(spec.max)}</span>
        </div>
      </div>

      <LqButton type="submit" size="lg" disabled={locked || !ready}>
        {t("quizPlay.question.send")}
      </LqButton>
    </form>
  );
}
