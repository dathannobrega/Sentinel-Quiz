"use client";

import { useId, useState, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, textareaClassName } from "@/components/ui/input";
import { AiProvenance, KeyConfirmation, SuggestTime } from "@/features/quiz-builder/components/ai/ai-item-panel";
import { AcceptedAnswersEditor } from "@/features/quiz-builder/components/editor/accepted-answers-editor";
import { CharCounter } from "@/features/quiz-builder/components/editor/char-counter";
import { NumericEditor } from "@/features/quiz-builder/components/editor/numeric-editor";
import { OptionEditor } from "@/features/quiz-builder/components/editor/option-editor";
import { OrderingEditor } from "@/features/quiz-builder/components/editor/ordering-editor";
import { DatabaseIcon, ItemTypeIcon } from "@/features/quiz-builder/components/icons";
import { CHAR_LIMITS, TIME_LIMIT, charLimitState, clampTimeLimit, type CharLimit } from "@/features/quiz-builder/lib/limits";
import {
  MAX_WORDS_MAX,
  MAX_WORDS_MIN,
  OPTION_TYPES,
  SCORED_TYPES,
  TIMED_TYPES,
  isBankItem,
  optionsToWrite,
  type LocalIssue
} from "@/features/quiz-builder/lib/items";
import { themeStageStyle } from "@/features/quiz-builder/lib/themes";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveItem, LiveItemWrite, LiveLimits, LiveThemeKey } from "@/types/api";

interface ItemPropertiesProps {
  item: LiveItem;
  issues: LocalIssue[];
  themeKey: LiveThemeKey;
  limits: LiveLimits;
  readOnly: boolean;
  reviewing: boolean;
  onPatch: (patch: LiveItemWrite) => void;
  /** `confirmKey` is true when the host ticked "Conferi o gabarito" (AI items flagged by the critic). */
  onReview: (confirmKey: boolean) => void;
  /** "Melhorar com IA" panel (Incremento 2), rendered by the editor when AI is available. */
  aiPanel?: ReactNode;
  /** Shows "Sugerir tempo" next to the time limit (needs /api/ai). */
  suggestTime?: boolean;
}

export function ItemProperties({ item, issues, themeKey, limits, readOnly, reviewing, onPatch, onReview, aiPanel, suggestTime }: ItemPropertiesProps) {
  const { t } = useI18n();
  const baseId = useId();
  const [keyConfirmed, setKeyConfirmed] = useState(false);
  const needsKeyConfirmation = Boolean(item.ai?.requires_key_confirmation);
  const fromBank = isBankItem(item);
  const contentLocked = readOnly || fromBank;
  const type = item.item_type;

  return (
    <div className="flex flex-col gap-6" style={themeStageStyle(themeKey)}>
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-surface-muted text-fg">
            <ItemTypeIcon type={type} size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-fg-muted">{t("quizBuilder.properties.type")}</p>
            <h2 className="text-[0.9375rem] font-semibold text-fg">{t(`quizBuilder.types.${type}.name`)}</h2>
          </div>
        </div>
        {fromBank || item.license_scope !== "own" || item.domain ? (
          <div className="flex flex-wrap gap-1.5">
            {fromBank ? (
              <Badge tone="primary">
                <DatabaseIcon />
                {t("quizBuilder.rail.bank")}
              </Badge>
            ) : null}
            {item.license_scope !== "own" ? <Badge tone={item.license_scope === "pending_audit" ? "warning" : "neutral"}>{t(`quizBuilder.license.${item.license_scope}`)}</Badge> : null}
            {item.domain ? (
              <Badge tone="neutral" className="max-w-full truncate">
                {item.certification ? t("quizBuilder.properties.source", { certification: item.certification, domain: item.domain }) : item.domain}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </header>

      {item.source_kind === "ai" ? <AiProvenance item={item} /> : null}

      {item.review_state === "needs_review" ? (
        <div className="flex flex-col gap-2">
          <Alert
            tone="warning"
            title={item.source_kind === "ai" ? t("quizAi.review.itemTitle") : t("quizBuilder.properties.review.title")}
            message={item.source_kind === "ai" ? t("quizAi.review.itemMessage") : t("quizBuilder.properties.review.message")}
          />
          {needsKeyConfirmation && !readOnly ? (
            <>
              <KeyConfirmation item={item} checked={keyConfirmed} onChange={setKeyConfirmed} disabled={reviewing} />
              {!keyConfirmed ? (
                <p id={`${baseId}-key-required`} className="sr-only">
                  {t("quizAi.keyConfirm.required")}
                </p>
              ) : null}
            </>
          ) : null}
          {/* Below the notice (not inside it): the properties column is narrow, and the
              order reads as the workflow — check the key, then approve. */}
          {!readOnly ? (
            <Button
              size="sm"
              className="self-start"
              busy={reviewing}
              disabled={needsKeyConfirmation && !keyConfirmed}
              aria-describedby={needsKeyConfirmation && !keyConfirmed ? `${baseId}-key-required` : undefined}
              onClick={() => onReview(needsKeyConfirmation && keyConfirmed)}
            >
              {t("quizBuilder.properties.review.action")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {aiPanel}

      {fromBank ? (
        <Alert tone="neutral" title={t("quizBuilder.properties.bankReadOnly.title")} message={t("quizBuilder.properties.bankReadOnly.message")} />
      ) : null}

      {type === "leaderboard" ? <p className="text-sm text-fg-muted">{t("quizBuilder.properties.leaderboardInfo")}</p> : null}

      {type !== "leaderboard" ? (
        <LimitedTextarea
          id={`${baseId}-prompt`}
          label={t("quizBuilder.properties.prompt")}
          hint={t("quizBuilder.properties.promptHint")}
          value={item.prompt}
          limit={CHAR_LIMITS.prompt}
          rows={3}
          readOnly={contentLocked}
          error={issueText(t, issues, "prompt")}
          onChange={(value) => onPatch({ prompt: value })}
          large
        />
      ) : null}

      {OPTION_TYPES.has(type) ? (
        <OptionEditor
          type={type as "single_choice" | "multi_choice" | "true_false" | "poll"}
          options={item.options}
          readOnly={contentLocked}
          issues={issues}
          min={limits.options_min}
          max={limits.options_max}
          onChange={(options) => onPatch({ options: optionsToWrite(options) })}
        />
      ) : null}

      {type === "ordering" ? (
        <OrderingEditor
          options={item.options}
          method={item.order_method ?? "kendall"}
          readOnly={contentLocked}
          methodReadOnly={readOnly}
          issues={issues}
          onChange={(options) => onPatch({ options: optionsToWrite(options) })}
          onMethodChange={(method) => onPatch({ order_method: method })}
        />
      ) : null}

      {type === "numeric" ? <NumericEditor numeric={item.numeric} readOnly={contentLocked} issues={issues} onPatch={onPatch} /> : null}

      {type === "word_cloud" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.wordCloud.maxWords")}</legend>
          <div className="inline-flex self-start rounded-md bg-surface-muted p-0.5">
            {Array.from({ length: MAX_WORDS_MAX - MAX_WORDS_MIN + 1 }, (_, index) => index + MAX_WORDS_MIN).map((value) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-[5px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                  (item.max_words ?? 1) === value ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${baseId}-max-words`}
                  checked={(item.max_words ?? 1) === value}
                  disabled={readOnly}
                  onChange={() => onPatch({ max_words: value })}
                />
                {value}
              </label>
            ))}
          </div>
          <p className="text-xs leading-snug text-fg-muted">{t("quizBuilder.wordCloud.hint")}</p>
        </fieldset>
      ) : null}

      {type === "multi_choice" ? (
        <Checkbox
          id={`${baseId}-aon`}
          checked={item.all_or_nothing}
          disabled={readOnly}
          onChange={(event) => onPatch({ all_or_nothing: event.target.checked })}
          label={t("quizBuilder.properties.allOrNothing")}
          description={t("quizBuilder.properties.allOrNothingHint")}
        />
      ) : null}

      {type === "poll" ? (
        <Checkbox
          id={`${baseId}-multiple`}
          checked={item.allow_multiple}
          disabled={readOnly}
          onChange={(event) => onPatch({ allow_multiple: event.target.checked })}
          label={t("quizBuilder.properties.allowMultiple")}
        />
      ) : null}

      {type === "type_answer" ? (
        <AcceptedAnswersEditor
          answers={item.accepted_answers}
          readOnly={contentLocked}
          issues={issues}
          onChange={(answers) => onPatch({ accepted_answers: answers })}
        />
      ) : null}

      {type === "content" ? (
        <LimitedTextarea
          id={`${baseId}-body`}
          label={t("quizBuilder.properties.body")}
          hint={t("quizBuilder.properties.bodyHint")}
          value={item.body ?? ""}
          limit={CHAR_LIMITS.body}
          rows={6}
          readOnly={readOnly}
          error={issueText(t, issues, "body")}
          onChange={(value) => onPatch({ body: value })}
        />
      ) : null}

      {TIMED_TYPES.has(type) ? (
        <TimingSection item={item} limits={limits} readOnly={readOnly} onPatch={onPatch} suggestTime={suggestTime} />
      ) : null}

      {type !== "leaderboard" ? (
        <section className="flex flex-col gap-4 border-t border-line pt-5">
          <h3 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.properties.extra")}</h3>
          {SCORED_TYPES.has(type) ? (
            <LimitedTextarea
              id={`${baseId}-explanation`}
              label={t("quizBuilder.properties.explanation")}
              hint={t("quizBuilder.properties.explanationHint")}
              value={item.explanation ?? ""}
              limit={CHAR_LIMITS.explanation}
              rows={3}
              readOnly={contentLocked}
              onChange={(value) => onPatch({ explanation: value })}
              quietCounter
            />
          ) : null}
          <LimitedTextarea
            id={`${baseId}-notes`}
            label={t("quizBuilder.properties.notes")}
            hint={t("quizBuilder.properties.notesHint")}
            value={item.presenter_notes ?? ""}
            limit={CHAR_LIMITS.presenterNotes}
            rows={3}
            readOnly={readOnly}
            onChange={(value) => onPatch({ presenter_notes: value })}
            quietCounter
          />
        </section>
      ) : null}
    </div>
  );
}

function issueText(t: (key: string) => string, issues: LocalIssue[], field: string): string | null {
  const issue = issues.find((entry) => entry.field === field);
  return issue ? t(`quizBuilder.issues.${issue.code}`) : null;
}

interface LimitedTextareaProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  limit: CharLimit;
  rows: number;
  readOnly?: boolean;
  error?: string | null;
  onChange: (value: string) => void;
  large?: boolean;
  /** Show the counter only near the limit. */
  quietCounter?: boolean;
}

function LimitedTextarea({ id, label, hint, value, limit, rows, readOnly, error, onChange, large, quietCounter }: LimitedTextareaProps) {
  const state = charLimitState(value, limit);
  const showCounter = !quietCounter || state.length > limit.max * 0.8;
  const describedBy = [hint ? `${id}-hint` : null, showCounter ? `${id}-counter` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="-mt-0.5 text-xs leading-snug text-fg-muted">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        value={value}
        rows={rows}
        readOnly={readOnly}
        aria-invalid={error || state.level === "block" ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(textareaClassName, "min-h-0 resize-y", large && "text-[0.9375rem] font-medium", readOnly && "bg-surface-muted")}
      />
      {showCounter ? <CharCounter id={`${id}-counter`} state={state} /> : null}
      {error ? (
        <p id={`${id}-error`} className="text-[0.8125rem] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TimingSection({
  item,
  limits,
  readOnly,
  onPatch,
  suggestTime
}: {
  item: LiveItem;
  limits: LiveLimits;
  readOnly: boolean;
  onPatch: (patch: LiveItemWrite) => void;
  suggestTime?: boolean;
}) {
  const { t } = useI18n();
  const baseId = useId();
  const min = limits.time_limit_min ?? TIME_LIMIT.min;
  const max = limits.time_limit_max ?? TIME_LIMIT.max;
  const hasTimer = item.time_limit_s !== null;
  const [secondsDraft, setSecondsDraft] = useState<string | null>(null);
  const shown = secondsDraft ?? String(item.time_limit_s ?? 20);
  const parsed = Number(shown);
  const secondsError = hasTimer && (!shown.trim() || !Number.isInteger(parsed) || parsed < min || parsed > max);
  const scored = SCORED_TYPES.has(item.item_type);
  const presets = TIME_LIMIT.presets.filter((value) => value >= min && value <= max);

  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5">
      <h3 className="text-[0.8125rem] font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("quizBuilder.properties.timing")}</h3>
      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.properties.timeLimit")}</legend>
        <div className="inline-flex self-start rounded-md bg-surface-muted p-0.5">
          {[true, false].map((withTimer) => (
            <label
              key={String(withTimer)}
              className={cn(
                "cursor-pointer rounded-[5px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                hasTimer === withTimer ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
              )}
            >
              <input
                type="radio"
                className="sr-only"
                name={`${baseId}-timer`}
                checked={hasTimer === withTimer}
                disabled={readOnly}
                onChange={() => {
                  setSecondsDraft(null);
                  onPatch({ time_limit_s: withTimer ? clampTimeLimit(Number(shown) || 20, min, max) : null });
                }}
              />
              {withTimer ? t("quizBuilder.properties.timer") : t("quizBuilder.properties.noTimer")}
            </label>
          ))}
        </div>
        {hasTimer ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${baseId}-seconds`} className="sr-only">
                {t("quizBuilder.properties.seconds")}
              </label>
              <Input
                id={`${baseId}-seconds`}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                step={1}
                className="h-9 w-24"
                value={shown}
                disabled={readOnly}
                aria-invalid={secondsError || undefined}
                aria-describedby={`${baseId}-seconds-hint`}
                onChange={(event) => {
                  const next = event.target.value;
                  setSecondsDraft(next);
                  const value = Number(next);
                  if (next.trim() && Number.isInteger(value) && value >= min && value <= max) {
                    onPatch({ time_limit_s: value });
                  }
                }}
                onBlur={() => {
                  if (secondsError) {
                    const clamped = clampTimeLimit(Number(shown) || min, min, max);
                    setSecondsDraft(null);
                    onPatch({ time_limit_s: clamped });
                  } else {
                    setSecondsDraft(null);
                  }
                }}
              />
              <span className="text-[0.8125rem] text-fg-muted">s</span>
              <div className="flex flex-wrap gap-1">
                {presets.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={readOnly}
                    aria-pressed={item.time_limit_s === value}
                    onClick={() => {
                      setSecondsDraft(null);
                      onPatch({ time_limit_s: value });
                    }}
                    className={cn(
                      "focus-ring h-7 rounded-md px-2 font-mono text-xs transition-colors",
                      item.time_limit_s === value ? "bg-primary text-on-primary" : "bg-surface-muted text-fg-muted hover:text-fg"
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <p id={`${baseId}-seconds-hint`} className={cn("text-xs", secondsError ? "font-medium text-danger" : "text-fg-muted")}>
              {t("quizBuilder.properties.secondsRange", { min, max })}
            </p>
            {suggestTime && !readOnly ? (
              <SuggestTime
                item={item}
                min={min}
                max={max}
                onApply={(seconds) => {
                  setSecondsDraft(null);
                  onPatch({ time_limit_s: seconds });
                }}
              />
            ) : null}
          </div>
        ) : (
          <p className="text-xs leading-snug text-fg-muted">{t("quizBuilder.properties.noTimerHint")}</p>
        )}
      </fieldset>

      {scored ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizBuilder.properties.points")}</legend>
          <div className="inline-flex self-start rounded-md bg-surface-muted p-0.5">
            {([0, 1, 2] as const).map((value) => (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-[5px] px-3 py-1.5 text-[0.8125rem] font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                  item.points_multiplier === value ? "bg-surface text-fg shadow-raised" : "text-fg-muted hover:text-fg"
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${baseId}-points`}
                  checked={item.points_multiplier === value}
                  disabled={readOnly}
                  onChange={() => onPatch({ points_multiplier: value })}
                />
                <span className="font-mono">{value}×</span> {t(`quizBuilder.properties.pointsOptions.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </section>
  );
}
