"use client";

import { forwardRef, useId, useSyncExternalStore, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { AlertIcon, CircleXIcon } from "@/components/ui/icons";
import { Input, Select, textareaClassName } from "@/components/ui/input";
import { Meter } from "@/components/ui/meter";
import { ItemTypeIcon, SparklesIcon } from "@/features/quiz-builder/components/icons";
import { formatCredits } from "@/features/quiz-builder/lib/ai";
import { charLength } from "@/features/quiz-builder/lib/limits";
import {
  isAiAlreadyApplied,
  isAiDisabled,
  isAiDraftBlocked,
  isAiJobNotReady,
  isAiQuotaExceeded,
  isAiTooManyJobs,
  isVersionConflict
} from "@/lib/api/ai-authoring";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { AiCapabilities, AiItemType, AiLanguage, AiLevel } from "@/types/api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Localized message for the AI contract errors (falls back to the backend text). */
export function aiErrorMessage(t: Translate, error: unknown, locale: string): string {
  if (isAiQuotaExceeded(error)) {
    return error.remaining !== null
      ? t("quizAi.errors.quota", { remaining: formatCredits(error.remaining, locale) })
      : t("quizAi.errors.quotaUnknown");
  }
  if (isAiTooManyJobs(error)) return t("quizAi.errors.tooManyJobs");
  if (isAiDisabled(error)) return t("quizAi.errors.disabled");
  if (isAiDraftBlocked(error)) return t("quizAi.errors.draftBlocked");
  if (isAiAlreadyApplied(error)) return t("quizAi.errors.alreadyApplied");
  if (isAiJobNotReady(error)) return t("quizAi.errors.notReady");
  if (isVersionConflict(error)) return t("quizAi.errors.conflict");
  return readErrorMessage(error, t("quizAi.errors.generic"));
}

const AI_BUTTON_SIZES = { sm: "h-8 px-3 text-[0.8125rem]", md: "h-10 px-4 text-sm" } as const;

/**
 * Entry point to the AI features: primary-tinted gradient surface, sparkles icon. Used for
 * "Gerar com IA" in the header, the rail and the empty state.
 */
export const AiButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: "sm" | "md" }>(function AiButton(
  { className, size = "md", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      {...props}
      className={cn(
        "focus-ring ai-surface inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-primary/45 font-medium whitespace-nowrap text-primary select-none",
        "transition-[border-color,box-shadow,color] duration-150 ease-out hover:border-primary hover:shadow-raised",
        "disabled:cursor-not-allowed disabled:border-line disabled:bg-none disabled:text-fg-subtle disabled:shadow-none [&_svg]:shrink-0",
        AI_BUTTON_SIZES[size],
        className
      )}
    />
  );
});

/** "Gerado por IA" label: icon + text (never colour alone). `compact` shows "IA" with the full name for AT. */
export function AiBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useI18n();
  if (compact) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm bg-primary-soft px-1.5 text-[0.6875rem] font-semibold text-primary",
          className
        )}
      >
        <SparklesIcon size={11} />
        <span aria-hidden="true">{t("quizAi.badge.short")}</span>
        <span className="sr-only">{t("quizAi.badge.label")}</span>
      </span>
    );
  }
  return (
    <Badge tone="primary" className={className}>
      <SparklesIcon />
      {t("quizAi.badge.label")}
    </Badge>
  );
}

/** Remaining daily credits with a small meter; `cost` adds the preview of what a submit spends. */
export function CreditsIndicator({ capabilities, cost, className }: { capabilities: AiCapabilities | undefined; cost?: number; className?: string }) {
  const { t, locale } = useI18n();
  if (!capabilities) return null;
  const { daily_limit: limit, remaining, used_today: used } = capabilities.credits;
  const fmt = (value: number) => formatCredits(value, locale);
  const unlimited = limit === null || remaining === null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[0.8125rem]">
        <span className="inline-flex items-center gap-1.5 font-medium text-fg">
          <SparklesIcon className="text-primary" />
          {unlimited ? t("quizAi.credits.unlimited") : t("quizAi.credits.remaining", { remaining: fmt(remaining), limit: fmt(limit) })}
        </span>
        {cost !== undefined ? (
          <span className="nums text-fg-muted">
            {t("quizAi.credits.cost", { cost: fmt(cost) })}
            {!unlimited && remaining !== null && cost <= remaining ? ` · ${t("quizAi.credits.after", { after: fmt(remaining - cost) })}` : null}
          </span>
        ) : null}
      </div>
      {!unlimited && limit ? <Meter value={(used / limit) * 100} label={t("quizAi.credits.meterLabel")} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------

export function FieldLabel({ htmlFor, children, optional }: { htmlFor?: string; children: ReactNode; optional?: boolean }) {
  const { t } = useI18n();
  return (
    <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-fg">
      {children}
      {optional ? <span className="ml-1.5 font-normal text-fg-subtle">{t("quizAi.form.optional")}</span> : null}
    </label>
  );
}

function FieldMessage({ id, tone, children }: { id: string; tone: "hint" | "error" | "warn"; children: ReactNode }) {
  return (
    <p
      id={id}
      className={cn(
        "flex items-start gap-1.5 text-xs leading-snug",
        tone === "error" ? "font-medium text-danger" : tone === "warn" ? "text-warning" : "text-fg-muted"
      )}
    >
      {tone === "error" ? <CircleXIcon size={14} className="mt-px shrink-0" /> : null}
      {tone === "warn" ? <AlertIcon size={14} className="mt-px shrink-0" /> : null}
      <span>{children}</span>
    </p>
  );
}

interface CountedTextareaProps {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  min?: number;
  rows?: number;
  placeholder?: string;
  optional?: boolean;
  /** Error shown only after the user interacted (or on submit). */
  showErrors?: boolean;
  disabled?: boolean;
  className?: string;
  mono?: boolean;
}

/** Textarea with a live "n / max" counter (and "n more to reach min"), both wired via aria-describedby. */
export function CountedTextarea({
  id,
  label,
  hint,
  value,
  onChange,
  max,
  min,
  rows = 3,
  placeholder,
  optional,
  showErrors,
  disabled,
  className,
  mono
}: CountedTextareaProps) {
  const { t, locale } = useI18n();
  const count = charLength(value.trim() ? value : "");
  const over = count > max;
  const under = min !== undefined && count < min;
  const nf = new Intl.NumberFormat(locale);
  const describedBy = [hint ? `${id}-hint` : null, `${id}-counter`].filter(Boolean).join(" ");
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      {hint ? (
        <p id={`${id}-hint`} className="-mt-0.5 text-xs leading-snug text-fg-muted">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={over || (showErrors && under) ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={cn(textareaClassName, "resize-y", mono && "font-mono text-[0.8125rem]")}
      />
      <div id={`${id}-counter`} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs">
        <span className="min-w-0">
          {over ? (
            <FieldMessage id={`${id}-over`} tone="error">
              {t("quizAi.form.tooLong", { count: nf.format(count - max) })}
            </FieldMessage>
          ) : under && count > 0 ? (
            <FieldMessage id={`${id}-under`} tone={showErrors ? "error" : "hint"}>
              {t("quizAi.form.tooShort", { count: nf.format((min ?? 0) - count), min: nf.format(min ?? 0) })}
            </FieldMessage>
          ) : null}
        </span>
        <span className={cn("nums shrink-0 font-mono tabular-nums", over ? "font-semibold text-danger" : "text-fg-subtle")}>
          {t("quizAi.form.counter", { count: nf.format(count), max: nf.format(max) })}
        </span>
      </div>
    </div>
  );
}

/** Range slider + number input kept in sync (1…max). */
export function CountField({
  id,
  label,
  hint,
  value,
  max,
  onChange,
  disabled
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const safeMax = Math.max(1, max);
  const clamp = (next: number) => Math.min(safeMax, Math.max(1, Math.round(next)));
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={`${id}-input`}>{label}</FieldLabel>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={safeMax}
          step={1}
          value={Math.min(value, safeMax)}
          disabled={disabled}
          aria-label={t("quizAi.form.count.slider")}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(clamp(Number(event.target.value)))}
          className="h-2 min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed"
        />
        <Input
          id={`${id}-input`}
          type="number"
          inputMode="numeric"
          min={1}
          max={safeMax}
          value={value}
          disabled={disabled}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(clamp(next));
          }}
          className="h-9 w-20 text-center font-mono"
        />
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs leading-snug text-fg-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function LevelField({ id, value, onChange, disabled }: { id: string; value: AiLevel; onChange: (value: AiLevel) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{t("quizAi.form.level.label")}</FieldLabel>
      <Select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as AiLevel)}>
        {(["mixed", "Easy", "Medium", "Hard"] as const).map((level) => (
          <option key={level} value={level}>
            {t(`quizAi.form.level.${level}`)}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function LanguageField({
  id,
  value,
  onChange,
  disabled
}: {
  id: string;
  value: AiLanguage;
  onChange: (value: AiLanguage) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id}>{t("quizAi.form.language.label")}</FieldLabel>
      <Select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as AiLanguage)}>
        <option value="pt-BR">{t("quizAi.form.language.ptBR")}</option>
        <option value="en">{t("quizAi.form.language.en")}</option>
      </Select>
    </div>
  );
}

/** Checkbox group of question types (≥ 1 required). */
export function TypesField({
  available,
  value,
  onChange,
  showErrors,
  disabled
}: {
  available: AiItemType[];
  value: AiItemType[];
  onChange: (value: AiItemType[]) => void;
  showErrors?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const invalid = showErrors && value.length === 0;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizAi.form.types.label")}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {available.map((type) => {
          const checked = value.includes(type);
          return (
            <label
              key={type}
              className={cn(
                "flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-[0.8125rem] transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus has-disabled:cursor-not-allowed",
                checked ? "border-primary bg-primary-soft/50 text-fg" : "border-line text-fg-muted hover:border-line-strong"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) =>
                  onChange(event.target.checked ? [...value, type] : value.filter((entry) => entry !== type))
                }
                className="size-4 shrink-0 accent-primary"
              />
              <ItemTypeIcon type={type} className={checked ? "text-primary" : "text-fg-subtle"} />
              <span>{t(`quizBuilder.types.${type}.name`)}</span>
            </label>
          );
        })}
      </div>
      <FieldMessage id={`${id}-hint`} tone={invalid ? "error" : "hint"}>
        {t("quizAi.form.types.hint")}
      </FieldMessage>
    </fieldset>
  );
}

/** Multi-select of domains as toggle chips (native checkboxes), capped at `max`. */
export function DomainsField({
  domains,
  value,
  onChange,
  max,
  emptyMessage,
  hint,
  disabled
}: {
  domains: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  max: number;
  emptyMessage: string;
  hint: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const full = value.length >= max;
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-[0.8125rem] font-medium text-fg">
        <span>
          {t("quizAi.form.domains.label")}
          <span className="ml-1.5 font-normal text-fg-subtle">{t("quizAi.form.optional")}</span>
        </span>
        {value.length ? <span className="nums text-xs font-normal text-fg-muted">{t("quizAi.form.domains.selected", { count: value.length, max })}</span> : null}
      </legend>
      {domains.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-2.5 text-xs text-fg-muted">{emptyMessage}</p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto p-0.5">
          {domains.map((domain) => {
            const checked = value.includes(domain.value);
            return (
              <label
                key={domain.value}
                className={cn(
                  "inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus has-disabled:cursor-not-allowed has-disabled:opacity-60",
                  checked ? "border-primary bg-primary-soft text-fg" : "border-line text-fg-muted hover:border-line-strong hover:text-fg"
                )}
              >
                <input
                  type="checkbox"
                  className="size-3.5 shrink-0 accent-primary"
                  checked={checked}
                  disabled={disabled || (!checked && full)}
                  onChange={(event) =>
                    onChange(event.target.checked ? [...value, domain.value] : value.filter((entry) => entry !== domain.value))
                  }
                />
                <span className="truncate">{domain.label}</span>
              </label>
            );
          })}
        </div>
      )}
      <FieldMessage id={`${id}-hint`} tone={full ? "warn" : "hint"}>
        {full ? t("quizAi.form.domains.max", { max }) : hint}
      </FieldMessage>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

function subscribeSecond(listener: () => void) {
  const timer = window.setInterval(listener, 1000);
  return () => window.clearInterval(timer);
}
const nowSecond = () => Math.floor(Date.now() / 1000) * 1000;
const serverNow = () => 0;

/** Wall clock that re-renders once per second while `active` (elapsed time of running jobs). */
export function useNow(active: boolean): number {
  return useSyncExternalStore(active ? subscribeSecond : noopSubscribe, nowSecond, serverNow);
}
function noopSubscribe() {
  return () => undefined;
}
