"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { ArrowLeftIcon, ChevronRightIcon, CircleXIcon } from "@/components/ui/icons";
import { Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs } from "@/components/ui/tabs";
import { LiveMotionProvider } from "@/components/quiz-kit/motion";
import { AiBankSample, DEFAULT_BANK_SAMPLE_FORM, type BankSampleForm } from "@/features/quiz-builder/components/ai/ai-bank-sample";
import { DraftReview } from "@/features/quiz-builder/components/ai/ai-draft-review";
import { JobElapsed, JobProgressPanel } from "@/features/quiz-builder/components/ai/ai-job-progress";
import {
  CountField,
  CountedTextarea,
  CreditsIndicator,
  DomainsField,
  FieldLabel,
  LanguageField,
  LevelField,
  TypesField,
  aiErrorMessage
} from "@/features/quiz-builder/components/ai/ai-shared";
import { DatabaseIcon, SparklesIcon } from "@/features/quiz-builder/components/icons";
import {
  AUDIENCE_MAX_CHARS,
  MAX_DOMAINS,
  SOURCE_MIN_CHARS,
  TITLE_HINT_MAX_CHARS,
  aiLanguageFor,
  aiLimitsFrom,
  canAfford,
  formatCredits,
  generationCost,
  isJobActive,
  sourceFormErrors,
  toFromSourceIn,
  toGenerateIn,
  topicFormErrors,
  type AiFormError,
  type AiSourceForm,
  type AiTopicForm,
  type AiUnavailableReason
} from "@/features/quiz-builder/lib/ai";
import { useI18n } from "@/lib/i18n";
import { useAiJob, useAiJobs, useCreateAiJob } from "@/lib/query/ai-hooks";
import { cn } from "@/lib/utils/cn";
import type { AiCapabilities, AiItemType, AiJob, AiJobStatus, AiLanguage, LiveFromBankResult } from "@/types/api";

export type AiDialogTab = "topic" | "source" | "bank";

interface AiGenerateDialogProps {
  open: boolean;
  onClose: () => void;
  quizId: string;
  quizLanguage: string;
  /** Questions that still fit in the quiz. */
  capacity: number;
  /** AI item types the quiz accepts (intersection of AI and live capabilities). */
  itemTypes: AiItemType[];
  capabilities: AiCapabilities | undefined;
  unavailable: AiUnavailableReason | null;
  initialTab: AiDialogTab;
  /** The generation shown in the dialog (null = forms). Lifted so it survives closing. */
  jobId: string | null;
  onJobChange: (jobId: string | null) => void;
  applyDrafts: (jobId: string, indexes: number[], force: boolean) => Promise<string[]>;
  addFromBank: (questionIds: string[]) => Promise<LiveFromBankResult>;
  onOpenItem: (itemId: string) => void;
}

function defaultTypes(itemTypes: AiItemType[]): AiItemType[] {
  const preferred = itemTypes.filter((type) => type === "single_choice" || type === "multi_choice");
  return preferred.length ? preferred : itemTypes.slice(0, 1);
}

/**
 * "Gerar com IA": topic, pasted text or bank draw → job progress → human review of the drafts.
 * Closing never cancels a job; it keeps running and is reopened from the header button or from
 * "Gerações recentes".
 */
export function AiGenerateDialog(props: AiGenerateDialogProps) {
  const { open, onClose, quizLanguage, itemTypes, capacity } = props;
  const { t } = useI18n();
  const language: AiLanguage = aiLanguageFor(quizLanguage);
  // Focus follows the view switch (forms ⇄ job) inside the modal; the first open keeps the
  // dialog's own initial focus.
  const [focusForms, setFocusForms] = useState(false);
  const maxN = Math.max(0, Math.min(props.capabilities?.limits.max_items ?? 20, capacity));
  const initialN = Math.min(10, Math.max(1, maxN));

  // Form state lives here (the dialog stays mounted) so closing never loses a pasted text.
  const [topicForm, setTopicForm] = useState<AiTopicForm>(() => ({
    topic: "",
    certification: "",
    domains: [],
    audience: "",
    level: "mixed",
    n: initialN,
    types: defaultTypes(itemTypes),
    language
  }));
  const [sourceForm, setSourceForm] = useState<AiSourceForm>(() => ({
    text: "",
    titleHint: "",
    level: "mixed",
    n: Math.min(5, Math.max(1, maxN)),
    types: defaultTypes(itemTypes),
    language
  }));
  const [bankForm, setBankForm] = useState<BankSampleForm>(DEFAULT_BANK_SAMPLE_FORM);
  const [expected, setExpected] = useState<Record<string, number>>({});

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={
        <span className="inline-flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary-soft text-primary">
            <SparklesIcon />
          </span>
          {t("quizAi.dialog.title")}
        </span>
      }
      description={t("quizAi.dialog.description")}
      className="h-[min(58rem,calc(100dvh-2rem))] w-[min(68rem,calc(100vw-2rem))]"
      showCloseButton
    >
      {open ? (
        <LiveMotionProvider>
          {props.jobId ? (
            <JobView
              key={props.jobId}
              jobId={props.jobId}
              expected={expected[props.jobId] ?? 3}
              capacity={capacity}
              criticEnabled={props.capabilities?.critic_enabled ?? true}
              onBack={() => {
                setFocusForms(true);
                props.onJobChange(null);
              }}
              applyDrafts={props.applyDrafts}
              addFromBank={props.addFromBank}
              onOpenItem={props.onOpenItem}
            />
          ) : (
            <FormsView
              {...props}
              maxN={maxN}
              focusOnMount={focusForms}
              topicForm={topicForm}
              setTopicForm={setTopicForm}
              sourceForm={sourceForm}
              setSourceForm={setSourceForm}
              bankForm={bankForm}
              setBankForm={setBankForm}
              onStarted={(job, n) => {
                setExpected((current) => ({ ...current, [job.id]: n }));
                props.onJobChange(job.id);
              }}
            />
          )}
        </LiveMotionProvider>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

interface FormsViewProps extends AiGenerateDialogProps {
  maxN: number;
  focusOnMount: boolean;
  topicForm: AiTopicForm;
  setTopicForm: (form: AiTopicForm) => void;
  sourceForm: AiSourceForm;
  setSourceForm: (form: AiSourceForm) => void;
  bankForm: BankSampleForm;
  setBankForm: (form: BankSampleForm) => void;
  onStarted: (job: AiJob, n: number) => void;
}

function FormsView(props: FormsViewProps) {
  const { t } = useI18n();
  const { unavailable } = props;
  const aiOff = Boolean(unavailable);
  const rootRef = useRef<HTMLDivElement>(null);
  const focusOnMount = props.focusOnMount;
  useEffect(() => {
    if (focusOnMount) rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusOnMount]);

  return (
    <div ref={rootRef} className="flex flex-col gap-5">
      {unavailable ? <UnavailableNotice reason={unavailable} /> : null}
      <Tabs
        key={`${props.initialTab}-${aiOff}`}
        ariaLabel={t("quizAi.dialog.tabsLabel")}
        defaultValue={aiOff && props.initialTab !== "bank" ? "bank" : props.initialTab}
        items={[
          {
            id: "topic",
            label: t("quizAi.dialog.tabs.topic"),
            content: <TopicForm {...props} />
          },
          {
            id: "source",
            label: t("quizAi.dialog.tabs.source"),
            content: <SourceForm {...props} />
          },
          {
            id: "bank",
            label: t("quizAi.dialog.tabs.bank"),
            badge: t("quizAi.dialog.noAi"),
            content: (
              <AiBankSample
                quizId={props.quizId}
                form={props.bankForm}
                onFormChange={props.setBankForm}
                capacity={props.capacity}
                addFromBank={props.addFromBank}
                onDone={props.onClose}
              />
            )
          }
        ]}
      />
      <RecentJobs quizId={props.quizId} onOpen={(jobId) => props.onJobChange(jobId)} />
    </div>
  );
}

function UnavailableNotice({ reason }: { reason: AiUnavailableReason }) {
  const { t } = useI18n();
  return (
    <Alert
      tone={reason === "quota_exhausted" ? "warning" : "neutral"}
      title={t(`quizAi.unavailable.${reason}.title`)}
      message={`${t(`quizAi.unavailable.${reason}.message`)} ${t("quizAi.unavailable.bankStillWorks")}`}
    />
  );
}

function FormErrors({ errors, id }: { errors: AiFormError[]; id: string }) {
  const { t } = useI18n();
  if (!errors.length) return null;
  return (
    <div id={id} role="alert" className="flex flex-col gap-1 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-[0.8125rem]">
      <p className="flex items-center gap-1.5 font-semibold text-fg">
        <CircleXIcon size={15} className="text-danger" />
        {t("quizAi.form.errorsTitle")}
      </p>
      <ul className="list-disc pl-6 text-fg-muted">
        {errors.map((error) => (
          <li key={error}>{t(`quizAi.form.errors.${error}`)}</li>
        ))}
      </ul>
    </div>
  );
}

/** Footer shared by the AI tabs: credits + cost preview, errors, submit. */
function SubmitBar({
  capabilities,
  cost,
  disabledReason,
  error,
  busy,
  label,
  onSubmit
}: {
  capabilities: AiCapabilities | undefined;
  cost: number;
  disabledReason: string | null;
  error: string | null;
  busy: boolean;
  label: string;
  onSubmit: () => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {error ? <Alert tone="danger" role="alert" message={error} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <CreditsIndicator capabilities={capabilities} cost={cost} className="w-full max-w-sm" />
        <div className="flex flex-col items-end gap-1">
          <Button onClick={onSubmit} busy={busy} disabled={Boolean(disabledReason)} aria-describedby={disabledReason ? `${id}-reason` : undefined} className="min-w-48">
            <SparklesIcon />
            {label}
          </Button>
          {disabledReason ? (
            <p id={`${id}-reason`} className="max-w-xs text-right text-xs leading-snug text-fg-muted">
              {disabledReason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function useSubmitGuards(props: FormsViewProps, n: number) {
  const { t, locale } = useI18n();
  const cost = generationCost(n);
  let disabledReason: string | null = null;
  if (props.unavailable) disabledReason = t(`quizAi.unavailable.${props.unavailable}.title`);
  else if (props.maxN === 0) disabledReason = t("quizAi.form.full");
  else if (!canAfford(props.capabilities, cost)) {
    const remaining = props.capabilities?.credits.remaining ?? 0;
    disabledReason = t("quizAi.credits.insufficient", { remaining: formatCredits(remaining, locale), max: Math.floor(remaining) });
  }
  return { cost, disabledReason };
}

function submitLabel(t: (key: string, values?: Record<string, string | number>) => string, n: number) {
  return n === 1 ? t("quizAi.form.submitOne") : t("quizAi.form.submit", { count: n });
}

function TopicForm(props: FormsViewProps) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const { topicForm: form, setTopicForm: setForm, capabilities, maxN } = props;
  const limits = aiLimitsFrom(capabilities);
  const create = useCreateAiJob();
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Math.min(form.n, Math.max(1, maxN));
  const errors = topicFormErrors({ ...form, n }, limits, Math.max(1, maxN));
  const { cost, disabledReason } = useSubmitGuards(props, n);
  const disabled = Boolean(props.unavailable);
  const certifications = useMemo(() => capabilities?.certifications ?? [], [capabilities]);
  const domains = useMemo(
    () => (certifications.find((entry) => entry.id === form.certification)?.domains ?? []).map((domain) => ({ value: domain, label: domain })),
    [certifications, form.certification]
  );
  const set = (patch: Partial<AiTopicForm>) => setForm({ ...form, ...patch });

  async function submit() {
    setError(null);
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    try {
      const job = await create.mutateAsync({ kind: "generate", input: toGenerateIn(props.quizId, { ...form, n }) });
      props.onStarted(job, n);
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={disabled} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CountedTextarea
            id={`${baseId}-topic`}
            label={t("quizAi.form.topic.label")}
            hint={t("quizAi.form.topic.hint")}
            placeholder={t("quizAi.form.topic.placeholder")}
            value={form.topic}
            max={limits.topicMaxChars}
            rows={4}
            onChange={(topic) => set({ topic })}
            showErrors={showErrors}
          />
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={`${baseId}-cert`}>{t("quizAi.form.certification.label")}</FieldLabel>
            <Select id={`${baseId}-cert`} value={form.certification} onChange={(event) => set({ certification: event.target.value, domains: [] })}>
              <option value="">{t("quizAi.form.certification.none")}</option>
              {certifications.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
            <p className="text-xs leading-snug text-fg-muted">{t("quizAi.form.certification.hint")}</p>
          </div>
          <DomainsField
            domains={domains}
            value={form.domains}
            onChange={(value) => set({ domains: value })}
            max={MAX_DOMAINS}
            emptyMessage={t("quizAi.form.domains.pickCertification")}
            hint={t("quizAi.form.domains.hint")}
          />
          <CountedTextarea
            id={`${baseId}-audience`}
            label={t("quizAi.form.audience.label")}
            hint={t("quizAi.form.audience.hint")}
            placeholder={t("quizAi.form.audience.placeholder")}
            value={form.audience}
            max={AUDIENCE_MAX_CHARS}
            rows={2}
            optional
            onChange={(audience) => set({ audience })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CountField
            id={`${baseId}-n`}
            label={t("quizAi.form.count.label")}
            hint={t("quizAi.form.count.hint", { max: maxN, capacity: props.capacity })}
            value={n}
            max={maxN}
            onChange={(value) => set({ n: value })}
          />
          <LevelField id={`${baseId}-level`} value={form.level} onChange={(level) => set({ level })} />
          <TypesField available={props.itemTypes} value={form.types} onChange={(types) => set({ types })} showErrors={showErrors} />
          <LanguageField id={`${baseId}-lang`} value={form.language} onChange={(language) => set({ language })} />
        </div>
      </fieldset>
      {showErrors ? <FormErrors id={`${baseId}-errors`} errors={errors} /> : null}
      <SubmitBar
        capabilities={capabilities}
        cost={cost}
        disabledReason={disabledReason}
        error={error}
        busy={create.isPending}
        label={submitLabel(t, n)}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function SourceForm(props: FormsViewProps) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const { sourceForm: form, setSourceForm: setForm, capabilities, maxN } = props;
  const limits = aiLimitsFrom(capabilities);
  const create = useCreateAiJob();
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Math.min(form.n, Math.max(1, maxN));
  const errors = sourceFormErrors({ ...form, n }, limits, Math.max(1, maxN));
  const { cost, disabledReason } = useSubmitGuards(props, n);
  const set = (patch: Partial<AiSourceForm>) => setForm({ ...form, ...patch });

  async function submit() {
    setError(null);
    if (errors.length) {
      setShowErrors(true);
      return;
    }
    try {
      const job = await create.mutateAsync({ kind: "from_source", input: toFromSourceIn(props.quizId, { ...form, n }) });
      props.onStarted(job, n);
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <fieldset disabled={Boolean(props.unavailable)} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CountedTextarea
            id={`${baseId}-source`}
            label={t("quizAi.form.source.label")}
            hint={t("quizAi.form.source.hint", { min: SOURCE_MIN_CHARS, max: new Intl.NumberFormat(locale).format(limits.sourceMaxChars) })}
            placeholder={t("quizAi.form.source.placeholder")}
            value={form.text}
            min={SOURCE_MIN_CHARS}
            max={limits.sourceMaxChars}
            rows={12}
            onChange={(text) => set({ text })}
            showErrors={showErrors}
          />
          <p className="-mt-2 text-xs leading-snug text-fg-muted">{t("quizAi.form.source.privacy")}</p>
          <CountedTextarea
            id={`${baseId}-title`}
            label={t("quizAi.form.titleHint.label")}
            hint={t("quizAi.form.titleHint.hint")}
            value={form.titleHint}
            max={TITLE_HINT_MAX_CHARS}
            rows={1}
            optional
            onChange={(titleHint) => set({ titleHint: titleHint.replace(/\n/g, " ") })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <CountField
            id={`${baseId}-n`}
            label={t("quizAi.form.count.label")}
            hint={t("quizAi.form.count.hint", { max: maxN, capacity: props.capacity })}
            value={n}
            max={maxN}
            onChange={(value) => set({ n: value })}
          />
          <LevelField id={`${baseId}-level`} value={form.level} onChange={(level) => set({ level })} />
          <TypesField available={props.itemTypes} value={form.types} onChange={(types) => set({ types })} showErrors={showErrors} />
          <LanguageField id={`${baseId}-lang`} value={form.language} onChange={(language) => set({ language })} />
        </div>
      </fieldset>
      {showErrors ? <FormErrors id={`${baseId}-errors`} errors={errors} /> : null}
      <SubmitBar
        capabilities={capabilities}
        cost={cost}
        disabledReason={disabledReason}
        error={error}
        busy={create.isPending}
        label={submitLabel(t, n)}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent jobs
// ---------------------------------------------------------------------------

const STATUS_TONES: Record<AiJobStatus, BadgeTone> = {
  queued: "neutral",
  running: "primary",
  succeeded: "success",
  failed: "danger",
  degraded: "warning"
};

export function JobStatusBadge({ status }: { status: AiJobStatus }) {
  const { t } = useI18n();
  return (
    <Badge tone={STATUS_TONES[status]}>
      {isJobActive(status) ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current motion-safe:animate-[pulse-soft_1.2s_ease-in-out_infinite]" /> : null}
      {t(`quizAi.status.${status}`)}
    </Badge>
  );
}

function RecentJobs({ quizId, onOpen }: { quizId: string; onOpen: (jobId: string) => void }) {
  const { t, locale } = useI18n();
  const jobs = useAiJobs(quizId);
  const list = (jobs.data ?? []).filter((job) => job.kind !== "improve");
  const time = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });
  return (
    <Disclosure
      summary={t("quizAi.recent.title")}
      hint={jobs.data ? t("quizAi.recent.count", { count: list.length }) : undefined}
      meta={list.some((job) => isJobActive(job.status)) ? <JobStatusBadge status="running" /> : undefined}
    >
      {jobs.isPending ? (
        <Skeleton height={48} />
      ) : jobs.isError ? (
        <p className="text-[0.8125rem] text-fg-muted">{t("quizAi.recent.loadError")}</p>
      ) : list.length === 0 ? (
        <p className="text-[0.8125rem] text-fg-muted">{t("quizAi.recent.empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => onOpen(job.id)}
                className="focus-ring group flex w-full items-center gap-3 rounded-md px-1 py-2.5 text-left hover:bg-surface-muted"
              >
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", job.kind === "from_source" ? "bg-surface-muted text-fg-muted" : "bg-primary-soft text-primary")}>
                  {job.kind === "from_source" ? <DatabaseIcon /> : <SparklesIcon />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[0.8125rem] font-medium text-fg">{t(`quizAi.kind.${job.kind}`)}</span>
                  <span className="nums text-xs text-fg-muted">
                    {time.format(new Date(job.created_at))} · {t("quizAi.recent.credits", { credits: formatCredits(job.credits, locale) })}
                  </span>
                </span>
                <JobStatusBadge status={job.status} />
                <ChevronRightIcon className="shrink-0 text-fg-subtle group-hover:text-fg" />
                <span className="sr-only">{t("quizAi.recent.open")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Disclosure>
  );
}

// ---------------------------------------------------------------------------
// Job view
// ---------------------------------------------------------------------------

interface JobViewProps {
  jobId: string;
  expected: number;
  capacity: number;
  criticEnabled: boolean;
  onBack: () => void;
  applyDrafts: (jobId: string, indexes: number[], force: boolean) => Promise<string[]>;
  addFromBank: (questionIds: string[]) => Promise<LiveFromBankResult>;
  onOpenItem: (itemId: string) => void;
}

function JobView({ jobId, expected, capacity, criticEnabled, onBack, applyDrafts, addFromBank, onOpenItem }: JobViewProps) {
  const { t, locale } = useI18n();
  const query = useAiJob(jobId);
  const job = query.data;
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus();
  }, []);

  let body: ReactNode;
  if (!job) {
    body = query.isError ? (
      <Alert tone="danger" role="alert" title={t("quizAi.job.loadError")} message={aiErrorMessage(t, query.error, locale)} />
    ) : (
      <div aria-busy="true" className="flex flex-col gap-3">
        <Skeleton height={140} />
        <Skeleton height={120} />
      </div>
    );
  } else if (isJobActive(job.status)) {
    body = <JobProgressPanel job={job} expected={expected} />;
  } else if (job.status === "failed") {
    body = (
      <Alert
        tone="danger"
        role="alert"
        title={t("quizAi.job.failed.title")}
        message={`${job.error_message || t("quizAi.job.failed.message")} ${t("quizAi.job.failed.refunded")}`}
        action={
          <Button size="sm" variant="secondary" onClick={onBack}>
            {t("quizAi.job.failed.retry")}
          </Button>
        }
      />
    );
  } else if (job.result?.type === "degraded") {
    body = <DegradedResult questionIds={job.result.bank_question_ids} capacity={capacity} addFromBank={addFromBank} onDone={onOpenItem} />;
  } else if (job.result?.type === "drafts") {
    body = (
      <DraftReview
        key={job.id}
        drafts={job.result.items}
        summary={job.result.summary}
        capacity={capacity}
        criticEnabled={criticEnabled}
        onApply={(indexes, force) => applyDrafts(job.id, indexes, force)}
        onOpenItem={onOpenItem}
      />
    );
  } else {
    body = <Alert tone="neutral" message={t("quizAi.job.noResult")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button ref={backRef} size="sm" variant="ghost" onClick={onBack} className="-ml-2">
          <ArrowLeftIcon />
          {t("quizAi.job.back")}
        </Button>
        {job ? (
          <>
            <h3 className="text-sm font-semibold text-fg">{t(`quizAi.kind.${job.kind}`)}</h3>
            <JobStatusBadge status={job.status} />
            <JobElapsed job={job} />
            <span className="nums ml-auto text-xs text-fg-muted">
              {t("quizAi.recent.credits", { credits: formatCredits(job.credits, locale) })}
              {job.model ? ` · ${job.model}` : ""}
            </span>
          </>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">
        {job && !isJobActive(job.status) ? t(`quizAi.job.finished.${job.status}`) : ""}
      </p>
      {job?.injection_suspected ? (
        <Alert tone="warning" title={t("quizAi.injection.title")} message={t("quizAi.injection.message")} />
      ) : null}
      {body}
    </div>
  );
}

function DegradedResult({
  questionIds,
  capacity,
  addFromBank,
  onDone
}: {
  questionIds: string[];
  capacity: number;
  addFromBank: (questionIds: string[]) => Promise<LiveFromBankResult>;
  onDone: (itemId: string) => void;
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const ids = questionIds.slice(0, Math.max(0, capacity));

  async function add() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await addFromBank(ids);
      const added = ids.length - result.rejected.length;
      setMessage({
        tone: result.rejected.length ? "warning" : "success",
        text: result.rejected.length
          ? t("quizAi.degraded.partial", { added, rejected: result.rejected.length })
          : t("quizAi.degraded.added", { count: added })
      });
      const first = result.quiz.items.find((item) => item.source_question_id && ids.includes(item.source_question_id));
      if (first && !result.rejected.length) onDone(first.id);
    } catch (caught) {
      setMessage({ tone: "danger", text: aiErrorMessage(t, caught, locale) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert
        tone="warning"
        title={t("quizAi.degraded.title")}
        message={questionIds.length ? t("quizAi.degraded.message", { count: questionIds.length }) : t("quizAi.degraded.none")}
        action={
          ids.length ? (
            <Button size="sm" onClick={() => void add()} busy={busy}>
              <DatabaseIcon />
              {t("quizAi.degraded.add", { count: ids.length })}
            </Button>
          ) : null
        }
      />
      {message ? <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"} message={message.text} /> : null}
    </div>
  );
}
