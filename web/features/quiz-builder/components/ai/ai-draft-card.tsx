"use client";

import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import { AlertIcon, CheckIcon, CircleCheckIcon, CircleXIcon, ClockIcon, InfoIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { ItemTypeIcon } from "@/features/quiz-builder/components/icons";
import { correctKeys, isDraftBlocked, needsKeyConfirmation } from "@/features/quiz-builder/lib/ai";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { AiCritic, AiDraftItem, AiIssue } from "@/types/api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Localized title for a known issue code (null for codes the UI does not know yet). */
export function issueTitle(t: Translate, code: string): string | null {
  const key = `quizAi.issues.${code}`;
  const label = t(key);
  return label === key ? null : label;
}

function difficultyLabel(t: Translate, value: string): string {
  const key = `quizAi.draft.difficulty.${value}`;
  const label = t(key);
  return label === key ? value : label;
}

function formatKeys(t: Translate, keys: string[]): string {
  return keys.length ? keys.join(", ") : t("quizAi.critic.noKeys");
}

/** Issues as severity badges (icon + word + colour) followed by a localized description. */
export function IssueList({ issues, className }: { issues: AiIssue[]; className?: string }) {
  const { t } = useI18n();
  if (!issues.length) return null;
  const sorted = [...issues].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return (
    <ul className={cn("flex flex-col gap-1.5", className)}>
      {sorted.map((issue, index) => {
        const title = issueTitle(t, issue.code);
        return (
          <li key={`${issue.code}-${index}`} className="flex items-start gap-2 text-[0.8125rem] leading-snug">
            <Badge tone={issue.severity === "error" ? "danger" : "warning"} className="mt-px">
              {issue.severity === "error" ? <CircleXIcon /> : <AlertIcon />}
              {t(`quizAi.severity.${issue.severity}`)}
            </Badge>
            {/* Known codes use the localized text; the backend message (English, technical)
                is only a fallback for codes this UI does not know yet. */}
            <span className="min-w-0 text-fg">
              {title ? <span className="font-medium">{title}</span> : <span className="text-fg-muted">{issue.message}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The blind critic's verdict in plain language: confidence meter (with the written %), what each
 * flag means ("O revisor automático, sem ver o gabarito, escolheu B") and its notes.
 */
export function CriticBlock({ critic, expectedKeys, className }: { critic: AiCritic; expectedKeys: string[]; className?: string }) {
  const { t } = useI18n();
  const id = useId();
  const pct = Math.round(Math.max(0, Math.min(1, critic.confidence)) * 100);
  const flagged = critic.flags.length > 0;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn("flex flex-col gap-2.5 rounded-md border px-3 py-2.5", flagged ? "border-warning/40 bg-warning-soft/40" : "border-line bg-surface-muted/50", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={`${id}-title`} className="text-xs font-semibold tracking-[0.04em] text-fg-muted uppercase">
          {t("quizAi.critic.title")}
        </h4>
        <span className="nums text-xs font-medium text-fg">{t("quizAi.critic.confidence", { pct })}</span>
      </div>
      <Meter value={pct} kind="score" label={t("quizAi.critic.confidenceLabel")} />
      {flagged ? (
        <ul className="flex flex-col gap-1.5">
          {critic.flags.map((flag) => (
            <li key={flag} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-fg">
              <AlertIcon size={15} className="mt-px shrink-0 text-warning" />
              <span>
                <span className="font-semibold">{t(`quizAi.critic.flags.${flag}.title`)}: </span>
                {t(`quizAi.critic.flags.${flag}.message`, { keys: formatKeys(t, critic.solved_keys), expected: formatKeys(t, expectedKeys) })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-start gap-2 text-[0.8125rem] leading-snug text-fg">
          <CircleCheckIcon size={15} className="mt-px shrink-0 text-success" />
          {t("quizAi.critic.agrees", { keys: formatKeys(t, critic.solved_keys) })}
        </p>
      )}
      {critic.notes.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs leading-snug text-fg-muted">
          {critic.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
      {needsKeyConfirmation(critic) ? (
        <p className="flex items-start gap-2 text-xs leading-snug text-fg-muted">
          <InfoIcon size={14} className="mt-px shrink-0" />
          {t("quizAi.critic.needsConfirm")}
        </p>
      ) : null}
    </section>
  );
}

interface DraftCardProps {
  draft: AiDraftItem;
  number: number;
  selected: boolean;
  forced: boolean;
  /** Selecting is not possible (quiz full) — only for unselected, not applied drafts. */
  selectionDisabled: boolean;
  criticEnabled: boolean;
  onToggle: () => void;
  onForce: () => void;
}

export function DraftCard({ draft, number, selected, forced, selectionDisabled, criticEnabled, onToggle, onForce }: DraftCardProps) {
  const { t } = useI18n();
  const id = useId();
  const blocked = isDraftBlocked(draft);
  const keys = correctKeys(draft);
  const checkboxDisabled = draft.applied || (blocked && !forced) || (!selected && selectionDisabled);
  const describedBy = [`${id}-prompt`, `${id}-state`].join(" ");

  let stateLabel: string;
  if (draft.applied) stateLabel = t("quizAi.draft.state.applied");
  else if (blocked && forced) stateLabel = t("quizAi.draft.state.forced");
  else if (blocked) stateLabel = t("quizAi.draft.state.blocked");
  else stateLabel = selected ? t("quizAi.draft.state.selected") : t("quizAi.draft.state.notSelected");

  return (
    <article
      aria-labelledby={`${id}-title`}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border bg-surface p-4 transition-[border-color,box-shadow,background-color] duration-200",
        draft.applied
          ? "border-success/40 bg-success-soft/25"
          : selected
            ? "border-primary shadow-raised ring-1 ring-primary/30"
            : blocked
              ? "border-danger/35"
              : "border-line hover:border-line-strong"
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex min-w-0 cursor-pointer items-center gap-2.5 has-disabled:cursor-not-allowed">
          <input
            type="checkbox"
            checked={draft.applied || selected}
            disabled={checkboxDisabled}
            onChange={onToggle}
            aria-describedby={describedBy}
            className="size-[1.125rem] shrink-0 accent-primary"
          />
          <h3 id={`${id}-title`} className="text-sm font-semibold text-fg">
            {t("quizAi.draft.label", { number })}
          </h3>
        </label>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <Badge tone="neutral">
            <ItemTypeIcon type={draft.item_type} />
            {t(`quizBuilder.types.${draft.item_type}.name`)}
          </Badge>
          {draft.domain ? (
            <Badge tone="neutral" className="max-w-[14rem] truncate" title={draft.domain}>
              {draft.domain}
            </Badge>
          ) : null}
          {draft.difficulty ? <Badge tone="neutral">{difficultyLabel(t, draft.difficulty)}</Badge> : null}
          <Badge tone="neutral">
            <ClockIcon />
            <span className="nums">{t("quizAi.draft.seconds", { seconds: draft.time_limit_s })}</span>
          </Badge>
        </span>
        <span id={`${id}-state`} className="shrink-0">
          {draft.applied ? (
            <Badge tone="success">
              <CircleCheckIcon />
              {stateLabel}
            </Badge>
          ) : blocked ? (
            <Badge tone={forced ? "warning" : "danger"}>
              {forced ? <AlertIcon /> : <CircleXIcon />}
              {stateLabel}
            </Badge>
          ) : (
            <span className="sr-only">{stateLabel}</span>
          )}
        </span>
      </header>

      <p id={`${id}-prompt`} className="text-[0.9375rem] leading-snug font-medium text-fg">
        {draft.prompt}
      </p>

      {draft.item_type === "type_answer" ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-fg-muted">{t("quizAi.draft.acceptedAnswers")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {draft.accepted_answers.map((answer) => (
              <li key={answer} className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success-soft px-2 py-1 text-[0.8125rem] text-fg">
                <CheckIcon size={13} className="text-success" />
                {answer}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul aria-label={t("quizAi.draft.optionsLabel")} className="grid gap-1.5 sm:grid-cols-2">
          {draft.options.map((option) => (
            <li
              key={option.key}
              className={cn(
                "flex flex-col gap-1 rounded-md border px-2.5 py-2 text-[0.8125rem]",
                option.correct ? "border-success/50 bg-success-soft/60" : "border-line bg-surface"
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-sm font-mono text-[0.6875rem] font-semibold",
                    option.correct ? "bg-success text-on-primary" : "bg-surface-muted text-fg-muted"
                  )}
                >
                  {option.key}
                </span>
                <span className="min-w-0 flex-1 leading-snug text-fg">
                  <span className="sr-only">{option.key}) </span>
                  {option.text}
                </span>
                {option.correct ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
                    <CheckIcon size={13} />
                    {t("quizAi.draft.correct")}
                  </span>
                ) : null}
              </div>
              {!option.correct && option.why_wrong ? (
                <details className="group/why pl-7">
                  <summary className="focus-ring inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-xs text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
                    <InfoIcon size={12} />
                    {t("quizAi.draft.whyWrong", { key: option.key })}
                  </summary>
                  <p className="mt-1 text-xs leading-snug text-fg-muted">{option.why_wrong}</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {draft.explanation ? (
        <details className="rounded-md bg-surface-muted/60 px-3 py-2">
          <summary className="focus-ring cursor-pointer rounded-sm text-xs font-semibold text-fg-muted hover:text-fg">{t("quizAi.draft.explanation")}</summary>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-fg">{draft.explanation}</p>
        </details>
      ) : null}

      <IssueList issues={draft.issues} />

      {draft.critic ? (
        <CriticBlock critic={draft.critic} expectedKeys={keys} />
      ) : criticEnabled ? (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <InfoIcon size={13} />
          {t("quizAi.critic.none")}
        </p>
      ) : null}

      {blocked && !draft.applied ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-xs leading-snug text-fg-muted">{forced ? t("quizAi.draft.forcedHint") : t("quizAi.draft.blockedHint")}</p>
          <button
            type="button"
            aria-pressed={forced}
            disabled={!forced && selectionDisabled}
            onClick={onForce}
            className={cn(
              "focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              forced ? "border-warning bg-warning-soft text-fg" : "border-line-strong text-fg hover:bg-surface-muted"
            )}
          >
            {forced ? <CheckIcon size={13} /> : <AlertIcon size={13} />}
            {forced ? t("quizAi.draft.undoForce") : t("quizAi.draft.forceAdd")}
          </button>
        </div>
      ) : null}
    </article>
  );
}
