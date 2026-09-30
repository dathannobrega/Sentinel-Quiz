"use client";

import { useId, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckIcon, InfoIcon } from "@/components/ui/icons";
import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { CriticBlock, IssueList } from "@/features/quiz-builder/components/ai/ai-draft-card";
import { JobElapsed, JobStepper } from "@/features/quiz-builder/components/ai/ai-job-progress";
import { AiBadge, CountedTextarea, aiErrorMessage } from "@/features/quiz-builder/components/ai/ai-shared";
import { DiffIcon, SparklesIcon, WandIcon } from "@/features/quiz-builder/components/icons";
import {
  CREDITS_PER_IMPROVE,
  INSTRUCTIONS_MAX_CHARS,
  canAfford,
  formatCredits,
  isJobActive,
  proposalChanges,
  type AiUnavailableReason,
  type ProposalChange
} from "@/features/quiz-builder/lib/ai";
import { charLength } from "@/features/quiz-builder/lib/limits";
import { useI18n } from "@/lib/i18n";
import { useAiJob, useCreateAiJob, useSuggestFormat } from "@/lib/query/ai-hooks";
import { cn } from "@/lib/utils/cn";
import type { AiCapabilities, AiImproveAction, LiveItem } from "@/types/api";

// ---------------------------------------------------------------------------
// Provenance ("Gerado por IA")
// ---------------------------------------------------------------------------

/** AI metadata of an item: model, issues found at generation time and the critic's verdict. */
export function AiProvenance({ item }: { item: LiveItem }) {
  const { t } = useI18n();
  const meta = item.ai;
  const expected = item.options.filter((option) => option.correct).map((option) => option.key);
  return (
    <details className="group/prov ai-surface rounded-md border border-primary/25">
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 [&::-webkit-details-marker]:hidden">
        <AiBadge />
        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
          {meta?.model ? t("quizAi.provenance.model", { model: meta.model }) : t("quizAi.provenance.noMeta")}
        </span>
        <span className="text-xs font-medium text-primary group-open/prov:hidden">{t("quizAi.provenance.show")}</span>
        <span className="hidden text-xs font-medium text-primary group-open/prov:inline">{t("quizAi.provenance.hide")}</span>
      </summary>
      <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
        <p className="text-xs leading-snug text-fg-muted">{t("quizAi.provenance.message")}</p>
        {meta?.issues.length ? <IssueList issues={meta.issues} /> : null}
        {meta?.critic ? <CriticBlock critic={meta.critic} expectedKeys={expected} /> : null}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Answer-key confirmation gate (review of critic-flagged AI items)
// ---------------------------------------------------------------------------

/**
 * Items flagged by the critic (key_mismatch / ambiguous) can only be approved after the host ticks
 * "Conferi o gabarito desta questão"; the review then sends confirm_key: true.
 */
export function KeyConfirmation({
  item,
  checked,
  onChange,
  disabled
}: {
  item: LiveItem;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const critic = item.ai?.critic;
  const correct = item.options.filter((option) => option.correct).map((option) => option.key);
  const reasons: string[] = [];
  if (critic?.flags.includes("key_mismatch")) {
    reasons.push(t("quizAi.keyConfirm.mismatch", { keys: critic.solved_keys.join(", ") || "—", expected: correct.join(", ") || "—" }));
  }
  if (critic?.flags.includes("ambiguous")) reasons.push(t("quizAi.keyConfirm.ambiguous"));
  if (!reasons.length) reasons.push(t("quizAi.keyConfirm.generic"));
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-surface px-3 py-2.5">
      <p id={`${id}-why`} className="text-xs leading-snug text-fg-muted">
        {reasons.join(" ")}
      </p>
      <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem] font-medium text-fg has-disabled:cursor-not-allowed">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={`${id}-why`}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        {t("quizAi.keyConfirm.label")}
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time suggestion
// ---------------------------------------------------------------------------

/** "Sugerir tempo": deterministic suggestion with its rationale; applying goes through the normal item patch. */
export function SuggestTime({ item, min, max, onApply, disabled }: { item: LiveItem; min: number; max: number; onApply: (seconds: number) => void; disabled?: boolean }) {
  const { t, locale } = useI18n();
  const suggest = useSuggestFormat();
  const [dismissed, setDismissed] = useState(true);
  const result = dismissed ? null : suggest.data;
  const seconds = result ? Math.min(max, Math.max(min, Math.round(result.time_limit_s))) : null;

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="-ml-2 self-start"
        busy={suggest.isPending}
        disabled={disabled || !item.prompt.trim()}
        onClick={() => {
          setDismissed(false);
          suggest.mutate({
            item_type: item.item_type,
            prompt: item.prompt,
            ...(item.options.length ? { options: item.options.map((option) => option.text) } : {})
          });
        }}
      >
        <SparklesIcon className="text-primary" />
        {t("quizAi.suggestTime.button")}
      </Button>
      <div aria-live="polite">
        {!dismissed && suggest.isError ? <p className="text-xs font-medium text-danger">{aiErrorMessage(t, suggest.error, locale)}</p> : null}
        {result && seconds !== null ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary/25 bg-primary-soft/40 px-3 py-2.5">
            <p className="text-[0.8125rem] font-semibold text-fg">{t("quizAi.suggestTime.result", { seconds })}</p>
            {result.rationale ? <p className="text-xs leading-snug text-fg-muted">{result.rationale}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={item.time_limit_s === seconds}
                onClick={() => {
                  onApply(seconds);
                  setDismissed(true);
                }}
              >
                {item.time_limit_s === seconds ? t("quizAi.suggestTime.same") : t("quizAi.suggestTime.apply", { seconds })}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
                {t("quizAi.suggestTime.dismiss")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Improve with AI
// ---------------------------------------------------------------------------

function actionsFor(item: LiveItem): AiImproveAction[] {
  const actions: AiImproveAction[] = ["rewrite"];
  if (item.item_type === "single_choice" || item.item_type === "multi_choice") actions.push("distractors");
  actions.push("explain");
  return actions;
}

interface ItemAiPanelProps {
  item: LiveItem;
  quizId: string;
  capabilities: AiCapabilities | undefined;
  unavailable: AiUnavailableReason | null;
  /** Improvement job for this item (kept by the editor so it survives switching items). */
  jobId: string | null;
  onJobStarted: (jobId: string) => void;
  onClear: () => void;
  /** Applies the proposal (POST /jobs/{id}/apply with indexes [0]) through the editor's mutator. */
  onApply: (jobId: string) => Promise<void>;
}

/** "Melhorar com IA": rewrite / new distractors / explanation → inline progress → before/after → apply or discard. */
export function ItemAiPanel({ item, quizId, capabilities, unavailable, jobId, onJobStarted, onClear, onApply }: ItemAiPanelProps) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const actions = actionsFor(item);
  const [action, setAction] = useState<AiImproveAction>(actions[0] ?? "rewrite");
  const [instructions, setInstructions] = useState("");
  const [open, setOpen] = useState(Boolean(jobId));
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [applying, setApplying] = useState(false);
  const create = useCreateAiJob();
  const jobQuery = useAiJob(jobId);
  const job = jobQuery.data;
  const effectiveAction = actions.includes(action) ? action : "rewrite";
  const cost = CREDITS_PER_IMPROVE;
  const affordable = canAfford(capabilities, cost);
  const tooLong = charLength(instructions) > INSTRUCTIONS_MAX_CHARS;

  let disabledReason: string | null = null;
  if (unavailable) disabledReason = t(`quizAi.unavailable.${unavailable}.title`);
  else if (!affordable) disabledReason = t("quizAi.improve.noCredits");
  else if (!item.prompt.trim()) disabledReason = t("quizAi.improve.needsPrompt");

  async function start() {
    setError(null);
    setApplied(false);
    try {
      const created = await create.mutateAsync({
        kind: "improve",
        itemId: item.id,
        input: { quiz_id: quizId, action: effectiveAction, ...(instructions.trim() ? { instructions: instructions.trim() } : {}) }
      });
      onJobStarted(created.id);
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    }
  }

  async function apply() {
    if (!jobId) return;
    setApplying(true);
    setError(null);
    try {
      await onApply(jobId);
      setApplied(true);
      onClear();
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    } finally {
      setApplying(false);
    }
  }

  const proposal = job?.status === "succeeded" && job.result?.type === "improvement" ? job.result.proposal : null;
  const changes = proposal ? proposalChanges(item, proposal) : [];

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="ai-surface rounded-lg border border-primary/25"
    >
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2.5 rounded-lg px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
          <WandIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{t("quizAi.improve.title")}</span>
          <span className="block text-xs text-fg-muted">{t("quizAi.improve.description")}</span>
        </span>
        {job && isJobActive(job.status) ? <Badge tone="primary">{t("quizAi.status.running")}</Badge> : null}
        {proposal ? <Badge tone="success">{t("quizAi.improve.ready")}</Badge> : null}
      </summary>

      <LiveMotionProvider>
        <div className="flex flex-col gap-4 px-3.5 pt-1 pb-4">
          {applied ? <Alert tone="success" message={t("quizAi.improve.applied")} /> : null}

          {!jobId ? (
            <>
              <fieldset className="flex flex-col gap-1.5" disabled={Boolean(unavailable)}>
                <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizAi.improve.actionsLabel")}</legend>
                {actions.map((value) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border bg-surface px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus has-disabled:cursor-not-allowed",
                      effectiveAction === value ? "border-primary" : "border-line hover:border-line-strong"
                    )}
                  >
                    <input
                      type="radio"
                      name={`${baseId}-action`}
                      checked={effectiveAction === value}
                      onChange={() => setAction(value)}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex flex-col">
                      <span className="text-[0.8125rem] font-medium text-fg">{t(`quizAi.improve.actions.${value}.name`)}</span>
                      <span className="text-xs leading-snug text-fg-muted">{t(`quizAi.improve.actions.${value}.description`)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <CountedTextarea
                id={`${baseId}-instructions`}
                label={t("quizAi.improve.instructions.label")}
                placeholder={t("quizAi.improve.instructions.placeholder")}
                value={instructions}
                max={INSTRUCTIONS_MAX_CHARS}
                rows={2}
                optional
                disabled={Boolean(unavailable)}
                onChange={setInstructions}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="nums text-xs text-fg-muted">
                  {t("quizAi.credits.cost", { cost: formatCredits(cost, locale) })}
                </span>
                <Button size="sm" onClick={() => void start()} busy={create.isPending} disabled={Boolean(disabledReason) || tooLong}>
                  <SparklesIcon />
                  {t(`quizAi.improve.submit.${effectiveAction}`)}
                </Button>
              </div>
              {disabledReason ? <p className="text-xs text-fg-muted">{disabledReason}</p> : null}
            </>
          ) : !job ? (
            jobQuery.isError ? (
              <Alert
                tone="danger"
                role="alert"
                message={aiErrorMessage(t, jobQuery.error, locale)}
                action={
                  <Button size="sm" variant="secondary" onClick={onClear}>
                    {t("quizAi.improve.discard")}
                  </Button>
                }
              />
            ) : (
              <p className="text-xs text-fg-muted">{t("quizAi.job.running.queued")}</p>
            )
          ) : isJobActive(job.status) ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[0.8125rem] font-medium text-fg">{t("quizAi.improve.running")}</p>
                <JobElapsed job={job} />
              </div>
              <JobStepper job={job} compact />
              <div aria-hidden="true" className="ai-shimmer flex flex-col gap-1.5 rounded-md border border-line bg-surface p-3">
                <span className="h-3 w-10/12 rounded-sm bg-surface-muted" />
                <span className="h-3 w-7/12 rounded-sm bg-surface-muted" />
              </div>
            </div>
          ) : job.status === "failed" || job.result?.type === "degraded" ? (
            <Alert
              tone="danger"
              role="alert"
              title={t("quizAi.improve.failed")}
              message={job.error_message || t(job.result?.type === "degraded" ? "quizAi.improve.unavailableNow" : "quizAi.job.failed.message")}
              action={
                <Button size="sm" variant="secondary" onClick={onClear}>
                  {t("quizAi.improve.again")}
                </Button>
              }
            />
          ) : proposal ? (
            <section aria-labelledby={`${baseId}-proposal`} className="flex flex-col gap-3" aria-live="polite">
              <h4 id={`${baseId}-proposal`} className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-fg">
                <DiffIcon className="text-primary" />
                {t("quizAi.improve.proposal")}
              </h4>
              {job.injection_suspected ? <Alert tone="warning" title={t("quizAi.injection.title")} message={t("quizAi.injection.message")} /> : null}
              {changes.length ? changes.map((change) => <ChangeView key={change.field} change={change} />) : <p className="text-xs text-fg-muted">{t("quizAi.improve.noChanges")}</p>}
              <p className="flex items-start gap-1.5 text-xs leading-snug text-fg-muted">
                <InfoIcon size={13} className="mt-px shrink-0" />
                {t("quizAi.improve.reviewNote")}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void apply()} busy={applying} disabled={!changes.length}>
                  <CheckIcon />
                  {t("quizAi.improve.apply")}
                </Button>
                <Button size="sm" variant="secondary" onClick={onClear} disabled={applying}>
                  {t("quizAi.improve.discard")}
                </Button>
              </div>
            </section>
          ) : (
            <Alert tone="neutral" message={t("quizAi.job.noResult")} action={<Button size="sm" variant="secondary" onClick={onClear}>{t("quizAi.improve.again")}</Button>} />
          )}

          {error ? <Alert tone="danger" role="alert" message={error} /> : null}
        </div>
      </LiveMotionProvider>
    </details>
  );
}

function ChangeView({ change }: { change: ProposalChange }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold tracking-[0.04em] text-fg-muted uppercase">{t(`quizAi.improve.fields.${change.field}`)}</p>
      <div className="grid gap-2">
        <DiffSide label={t("quizAi.improve.before")} tone="before">
          {change.field === "options" ? <OptionsList options={change.before} /> : <TextValue value={change.before} />}
        </DiffSide>
        <DiffSide label={t("quizAi.improve.after")} tone="after">
          {change.field === "options" ? <OptionsList options={change.after} /> : <TextValue value={change.after} />}
        </DiffSide>
      </div>
    </div>
  );
}

function DiffSide({ label, tone, children }: { label: string; tone: "before" | "after"; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-md border px-3 py-2", tone === "before" ? "border-line bg-surface-muted/60" : "border-primary/40 bg-surface")}>
      <p className={cn("mb-1 text-[0.6875rem] font-semibold tracking-[0.06em] uppercase", tone === "before" ? "text-fg-subtle" : "text-primary")}>{label}</p>
      {children}
    </div>
  );
}

function TextValue({ value }: { value: string }) {
  const { t } = useI18n();
  return value.trim() ? (
    <p className="text-[0.8125rem] leading-snug whitespace-pre-wrap text-fg">{value}</p>
  ) : (
    <p className="text-[0.8125rem] text-fg-subtle italic">{t("quizAi.improve.empty")}</p>
  );
}

function OptionsList({ options }: { options: Array<{ key: string; text: string; correct: boolean }> }) {
  const { t } = useI18n();
  return (
    <ul className="flex flex-col gap-1">
      {options.map((option) => (
        <li key={option.key} className="flex items-start gap-2 text-[0.8125rem] leading-snug text-fg">
          <span className="w-4 shrink-0 font-mono text-xs font-semibold text-fg-muted">{option.key}</span>
          <span className="min-w-0 flex-1">{option.text}</span>
          {option.correct ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-success">
              <CheckIcon size={12} />
              {t("quizAi.draft.correct")}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
