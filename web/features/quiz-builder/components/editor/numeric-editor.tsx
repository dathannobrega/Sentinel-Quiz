"use client";

import { useId, useState } from "react";

import { Checkbox, Input } from "@/components/ui/input";
import { formatNumber, formatNumberInput, parseLocaleNumber } from "@/features/quiz-live/lib/numeric";
import { DEFAULT_NUMERIC, NUMERIC_UNIT_MAX, type LocalIssue } from "@/features/quiz-builder/lib/items";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItemNumeric, LiveItemWrite } from "@/types/api";

type NumberKey = "min" | "max" | "step" | "value" | "tolerance";

/**
 * Numeric item settings (T06): range, optional step, unit, correct value, tolerance and partial
 * credit. Numbers are typed in the UI locale ("1.234,5" in pt-BR) and saved as JSON numbers; the
 * range and value rules show inline (the server re-checks on publish).
 */
export function NumericEditor({
  numeric,
  readOnly = false,
  issues = [],
  onPatch
}: {
  numeric: LiveItemNumeric | undefined;
  readOnly?: boolean;
  issues?: LocalIssue[];
  onPatch: (patch: LiveItemWrite) => void;
}) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const current = { ...DEFAULT_NUMERIC, ...numeric };
  const unit = current.unit.trim();
  const issueFor = (field: string) => {
    const issue = issues.find((entry) => entry.field === field);
    return issue ? t(`quizBuilder.issues.${issue.code}`) : null;
  };
  const example = formatNumber(1234.5, locale, 1);
  const tolerance = current.tolerance;
  const partialBand = tolerance > 0 ? formatNumber(tolerance * 3, locale) : null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[0.8125rem] font-medium text-fg">{t("quizBuilder.numeric.title")}</h3>
        <p className="text-xs leading-snug text-fg-muted">{t("quizBuilder.numeric.hint", { example })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField id={`${baseId}-min`} label={t("quizBuilder.numeric.min")} value={current.min} field="min" readOnly={readOnly} onPatch={onPatch} />
        <NumberField id={`${baseId}-max`} label={t("quizBuilder.numeric.max")} value={current.max} field="max" readOnly={readOnly} onPatch={onPatch} />
      </div>
      {issueFor("range") ? (
        <p role="alert" className="-mt-2 text-[0.8125rem] font-medium text-danger">
          {issueFor("range")}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={`${baseId}-step`}
          label={t("quizBuilder.numeric.step")}
          hint={t("quizBuilder.numeric.stepHint")}
          value={current.step}
          field="step"
          optional
          readOnly={readOnly}
          error={issueFor("step")}
          onPatch={onPatch}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${baseId}-unit`} className="text-[0.8125rem] font-medium text-fg">
            {t("quizBuilder.numeric.unit")}
          </label>
          <Input
            id={`${baseId}-unit`}
            value={current.unit}
            maxLength={NUMERIC_UNIT_MAX}
            readOnly={readOnly}
            placeholder={t("quizBuilder.numeric.unitPlaceholder")}
            aria-describedby={`${baseId}-unit-hint`}
            onChange={(event) => onPatch({ unit: event.target.value.slice(0, NUMERIC_UNIT_MAX) })}
            className="h-9"
          />
          <p id={`${baseId}-unit-hint`} className="text-xs text-fg-muted">
            {t("quizBuilder.numeric.unitHint", { max: NUMERIC_UNIT_MAX })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id={`${baseId}-value`}
          label={t("quizBuilder.numeric.value")}
          suffix={unit}
          value={current.value}
          field="value"
          optional
          readOnly={readOnly}
          error={issueFor("value")}
          onPatch={onPatch}
        />
        <NumberField
          id={`${baseId}-tolerance`}
          label={t("quizBuilder.numeric.tolerance")}
          hint={t("quizBuilder.numeric.toleranceHint")}
          suffix={unit}
          value={current.tolerance}
          field="tolerance"
          min={0}
          readOnly={readOnly}
          error={issueFor("tolerance")}
          onPatch={onPatch}
        />
      </div>

      <Checkbox
        id={`${baseId}-partial`}
        checked={current.partial}
        disabled={readOnly}
        onChange={(event) => onPatch({ partial: event.target.checked })}
        label={t("quizBuilder.numeric.partial")}
        description={
          partialBand
            ? t("quizBuilder.numeric.partialHint", { band: unit ? `${partialBand} ${unit}` : partialBand })
            : t("quizBuilder.numeric.partialHintExact")
        }
      />
    </section>
  );
}

/**
 * A number typed in the UI locale. The draft keeps what the person typed; valid numbers are saved
 * as they type, and leaving the field reformats it (or restores the saved value when invalid).
 */
function NumberField({
  id,
  label,
  hint,
  suffix,
  value,
  field,
  optional = false,
  min,
  readOnly,
  error,
  onPatch
}: {
  id: string;
  label: string;
  hint?: string;
  suffix?: string;
  value: number | null;
  field: NumberKey;
  /** Empty = null (step: free input; value: not set yet). */
  optional?: boolean;
  min?: number;
  readOnly: boolean;
  error?: string | null;
  onPatch: (patch: LiveItemWrite) => void;
}) {
  const { t, locale } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : formatNumberInput(value, locale, null));
  const parsed = parseLocaleNumber(shown, locale);
  const invalid = shown.trim() !== "" && (parsed === null || (min !== undefined && parsed < min));
  const empty = !shown.trim();
  const localError = invalid ? t("quizBuilder.numeric.invalid") : empty && !optional ? t("quizBuilder.numeric.required") : null;
  const message = localError ?? error ?? null;
  const describedBy = [hint ? `${id}-hint` : null, message ? `${id}-error` : null].filter(Boolean).join(" ");

  function change(next: string) {
    setDraft(next);
    if (!next.trim()) {
      if (optional) {
        onPatch({ [field]: null } as LiveItemWrite);
      }
      return;
    }
    const number = parseLocaleNumber(next, locale);
    if (number !== null && (min === undefined || number >= min)) {
      onPatch({ [field]: number } as LiveItemWrite);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={shown}
          inputMode="decimal"
          autoComplete="off"
          readOnly={readOnly}
          aria-invalid={message ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(event) => change(event.target.value.slice(0, 32))}
          onBlur={() => setDraft(null)}
          className={cn("h-9 min-w-0 flex-1 font-mono", readOnly && "bg-surface-muted")}
        />
        {suffix ? <span className="max-w-[5rem] shrink-0 truncate text-[0.8125rem] text-fg-muted">{suffix}</span> : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="text-xs font-medium text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
