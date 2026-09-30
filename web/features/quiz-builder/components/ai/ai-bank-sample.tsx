"use client";

import { useId, useMemo, useState } from "react";
import { m } from "motion/react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { CountField, DomainsField, FieldLabel, aiErrorMessage } from "@/features/quiz-builder/components/ai/ai-shared";
import { DatabaseIcon, PlusIcon } from "@/features/quiz-builder/components/icons";
import { BANK_SAMPLE_MAX, MAX_DOMAINS } from "@/features/quiz-builder/lib/ai";
import { useI18n } from "@/lib/i18n";
import { useBankSample } from "@/lib/query/ai-hooks";
import { useBankFacets } from "@/lib/query/live-hooks";
import { cn } from "@/lib/utils/cn";
import type { LiveBankSampleOut, LiveFromBankResult } from "@/types/api";

export interface BankSampleForm {
  certification: string;
  domains: string[];
  difficulty: "" | "Easy" | "Medium" | "Hard";
  n: number;
  strategy: "coverage" | "random";
  onlyGuest: boolean;
}

export const DEFAULT_BANK_SAMPLE_FORM: BankSampleForm = {
  certification: "",
  domains: [],
  difficulty: "",
  n: 10,
  strategy: "coverage",
  // Rooms allow guests by default (start dialog), so only guest-eligible questions by default.
  onlyGuest: true
};

interface AiBankSampleProps {
  quizId: string;
  form: BankSampleForm;
  onFormChange: (form: BankSampleForm) => void;
  capacity: number;
  /** The existing from-bank endpoint (Incremento 1), through the editor's mutator. */
  addFromBank: (questionIds: string[]) => Promise<LiveFromBankResult>;
  onDone: () => void;
}

/** F-IA2: deterministic draw from the bank (no AI, no credits) with a coverage preview. */
export function AiBankSample({ quizId, form, onFormChange, capacity, addFromBank, onDone }: AiBankSampleProps) {
  const { t, locale } = useI18n();
  const baseId = useId();
  const facets = useBankFacets();
  const sample = useBankSample();
  const [result, setResult] = useState<LiveBankSampleOut | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<LiveFromBankResult["rejected"]>([]);
  const maxCount = Math.max(0, Math.min(BANK_SAMPLE_MAX, capacity));
  const n = Math.min(form.n, Math.max(1, maxCount));

  const domains = useMemo(
    () =>
      (facets.data?.domains ?? [])
        .filter((entry) => form.certification && entry.certification === form.certification)
        .map((entry) => ({ value: entry.domain, label: `${entry.domain} (${entry.count})` })),
    [facets.data, form.certification]
  );

  const set = (patch: Partial<BankSampleForm>) => {
    onFormChange({ ...form, ...patch });
    setResult(null);
    setRejected([]);
  };

  async function draw() {
    setError(null);
    setRejected([]);
    try {
      const next = await sample.mutateAsync({
        n,
        strategy: form.strategy,
        only_guest_eligible: form.onlyGuest,
        exclude_quiz_id: quizId,
        ...(form.certification ? { certification: form.certification } : {}),
        ...(form.certification && form.domains.length ? { domains: form.domains } : {}),
        ...(form.difficulty ? { difficulty: form.difficulty } : {})
      });
      setResult(next);
    } catch (caught) {
      setResult(null);
      setError(aiErrorMessage(t, caught, locale));
    }
  }

  async function add() {
    if (!result?.question_ids.length) return;
    setAdding(true);
    setError(null);
    try {
      const response = await addFromBank(result.question_ids.slice(0, capacity));
      if (response.rejected.length) {
        setRejected(response.rejected);
        setResult(null);
      } else {
        onDone();
      }
    } catch (caught) {
      setError(aiErrorMessage(t, caught, locale));
    } finally {
      setAdding(false);
    }
  }

  const reasonLabel = (reason: string) => {
    const key = `quizBuilder.bank.reasons.${reason}`;
    const label = t(key);
    return label === key ? reason : label;
  };
  const maxCoverage = Math.max(1, ...(result?.coverage.map((entry) => entry.count) ?? [1]));

  return (
    <div className="flex flex-col gap-5">
      <p className="flex items-start gap-2 rounded-md bg-surface-muted px-3 py-2.5 text-[0.8125rem] leading-snug text-fg-muted">
        <DatabaseIcon className="mt-0.5 shrink-0 text-primary" />
        {t("quizAi.bank.intro")}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${baseId}-cert`}>{t("quizAi.form.certification.label")}</FieldLabel>
          <Select id={`${baseId}-cert`} value={form.certification} onChange={(event) => set({ certification: event.target.value, domains: [] })}>
            <option value="">{t("quizAi.bank.anyCertification")}</option>
            {(facets.data?.certifications ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({entry.count})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={`${baseId}-difficulty`}>{t("quizAi.bank.difficulty")}</FieldLabel>
          <Select
            id={`${baseId}-difficulty`}
            value={form.difficulty}
            onChange={(event) => set({ difficulty: event.target.value as BankSampleForm["difficulty"] })}
          >
            <option value="">{t("quizAi.bank.anyDifficulty")}</option>
            {(["Easy", "Medium", "Hard"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`quizAi.form.level.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <DomainsField
        domains={domains}
        value={form.domains}
        onChange={(value) => set({ domains: value })}
        max={MAX_DOMAINS}
        emptyMessage={t("quizAi.form.domains.pickCertification")}
        hint={t("quizAi.bank.domainsHint")}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <CountField
          id={`${baseId}-n`}
          label={t("quizAi.bank.count")}
          hint={t("quizAi.form.count.hint", { max: maxCount, capacity })}
          value={n}
          max={maxCount}
          disabled={maxCount === 0}
          onChange={(value) => set({ n: value })}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[0.8125rem] font-medium text-fg">{t("quizAi.bank.strategy.label")}</legend>
          {(["coverage", "random"] as const).map((strategy) => (
            <label
              key={strategy}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-focus",
                form.strategy === strategy ? "border-primary bg-primary-soft/50" : "border-line hover:border-line-strong"
              )}
            >
              <input
                type="radio"
                name={`${baseId}-strategy`}
                checked={form.strategy === strategy}
                onChange={() => set({ strategy })}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="flex flex-col">
                <span className="text-[0.8125rem] font-medium text-fg">{t(`quizAi.bank.strategy.${strategy}.name`)}</span>
                <span className="text-xs leading-snug text-fg-muted">{t(`quizAi.bank.strategy.${strategy}.description`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <Checkbox
        id={`${baseId}-guest`}
        checked={form.onlyGuest}
        onChange={(event) => set({ onlyGuest: event.target.checked })}
        label={t("quizAi.bank.onlyGuest")}
        description={t("quizAi.bank.onlyGuestHint")}
      />

      {result ? (
        <section aria-labelledby={`${baseId}-result`} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${baseId}-result`} className="text-sm font-semibold text-fg">
              {result.question_ids.length ? t("quizAi.bank.result.title", { count: result.question_ids.length }) : t("quizAi.bank.result.noneTitle")}
            </h3>
            <span className="nums text-xs text-fg-muted">{t("quizAi.bank.result.available", { available: result.available })}</span>
          </div>
          {result.question_ids.length ? (
            <>
              <h4 className="text-xs font-semibold tracking-[0.04em] text-fg-muted uppercase">{t("quizAi.bank.result.coverage")}</h4>
              <ul className="flex flex-col gap-2">
                {result.coverage.map((entry, index) => (
                  <li key={entry.domain} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                    <span className="truncate text-[0.8125rem] text-fg" title={entry.domain}>
                      {entry.domain}
                    </span>
                    <span className="nums font-mono text-xs text-fg-muted">{t("quizAi.bank.result.domainCount", { count: entry.count })}</span>
                    <span aria-hidden="true" className="col-span-2 h-2 overflow-hidden rounded-full bg-surface-muted">
                      <m.span
                        className="block h-full origin-left rounded-full bg-primary"
                        style={{ width: `${(entry.count / maxCoverage) * 100}%` }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ type: "spring", visualDuration: 0.5, bounce: 0.1, delay: Math.min(index * 0.05, 0.4) }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[0.8125rem] text-fg-muted">{t("quizAi.bank.result.none")}</p>
          )}
        </section>
      ) : null}

      {rejected.length ? (
        <Alert
          tone="warning"
          role="alert"
          title={t("quizAi.bank.result.rejected", { count: rejected.length })}
          message={rejected.map((entry) => `${entry.question_id}: ${reasonLabel(entry.reason)}`).join(" · ")}
        />
      ) : null}
      {error ? <Alert tone="danger" role="alert" message={error} /> : null}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
        {maxCount === 0 ? <p className="mr-auto text-xs text-fg-muted">{t("quizAi.form.full")}</p> : null}
        <Button variant={result?.question_ids.length ? "secondary" : "primary"} onClick={() => void draw()} busy={sample.isPending} disabled={maxCount === 0}>
          <DatabaseIcon />
          {result ? t("quizAi.bank.redraw") : t("quizAi.bank.submit", { count: n })}
        </Button>
        {result?.question_ids.length ? (
          <Button onClick={() => void add()} busy={adding}>
            <PlusIcon />
            {t("quizAi.bank.add", { count: Math.min(result.question_ids.length, capacity) })}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
