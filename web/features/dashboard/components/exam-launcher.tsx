"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field } from "@/components/ui/field";
import { CheckIcon } from "@/components/ui/icons";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { PBQ_MAX_COUNT } from "@/features/session-runner/lib/pbq-utils";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { DomainCatalogEntry, Exam } from "@/types/api";

import type {
  DashboardNotice,
  LaunchFormValues,
  LaunchPresetKey
} from "@/features/dashboard/types";

const PRESETS: LaunchPresetKey[] = [
  "placement",
  "daily_review",
  "quick_15",
  "comptia_exam",
  "sprint_25",
  "custom"
];

interface ExamLauncherProps {
  exams: Exam[];
  domains: DomainCatalogEntry[];
  values: LaunchFormValues;
  notice: DashboardNotice | null;
  pending: boolean;
  selectedPresetKey: LaunchPresetKey;
  presetSummary: string;
  onChange: (
    field: keyof LaunchFormValues,
    value: LaunchFormValues[keyof LaunchFormValues]
  ) => void;
  onApplyPreset: (presetKey: LaunchPresetKey) => void;
  onSubmit: () => void;
}

/**
 * Session launcher: pick a preset (or tune the settings), read the summary, start.
 * One primary action; advanced filters are progressive disclosure.
 */
export function ExamLauncher({
  exams,
  domains,
  values,
  notice,
  pending,
  selectedPresetKey,
  presetSummary,
  onChange,
  onApplyPreset,
  onSubmit
}: ExamLauncherProps) {
  const { t } = useI18n();
  const isStudy = values.mode === "study";
  const canLaunch = values.totalQuestions > 0;
  const advancedCount = [
    values.bookmarkedOnly,
    values.notesOnly,
    values.incorrectOnly,
    values.unseenOnly,
    values.lowConfidenceOnly
  ].filter(Boolean).length;
  const examTitle =
    exams.find((exam) => exam.id === values.examId)?.title ??
    t("common.filters.mixedRandom");

  const summaryRows: Array<[string, string]> = [
    [t("launcher.fields.certification"), examTitle],
    [
      t("launcher.fields.mode"),
      isStudy ? t("common.labels.study") : t("common.labels.exam")
    ],
    [t("launcher.fields.questions"), String(values.totalQuestions || 0)],
    [
      t("launcher.fields.timeMinutes"),
      isStudy
        ? t("launcher.summary.noTimer")
        : t("launcher.summary.minutes", { count: values.timeLimitMinutes })
    ],
    [
      t("launcher.fields.pbqCount"),
      values.pbqCount
        ? t("launcher.pbqCount.option", { count: values.pbqCount })
        : t("launcher.pbqCount.none")
    ]
  ];
  if (!isStudy) {
    summaryRows.push([
      t("launcher.fields.experienceMode"),
      values.experienceMode === "exam_day"
        ? t("launcher.experienceModes.examDay")
        : t("launcher.experienceModes.standard")
    ]);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <Section
        className="min-w-0 lg:col-start-1"
        title={t("launcher.presets.title")}
        description={t("launcher.card.subtitle")}
      >
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="group"
          aria-label={t("launcher.presets.title")}
        >
          {PRESETS.map((presetKey) => {
            const active = selectedPresetKey === presetKey;
            return (
              <button
                key={presetKey}
                type="button"
                aria-pressed={active}
                onClick={() => onApplyPreset(presetKey)}
                className={cn(
                  "focus-ring group flex items-start gap-3 rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-primary bg-primary-soft"
                    : "border-line bg-surface hover:border-line-strong"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                    active
                      ? "border-primary bg-primary text-on-primary"
                      : "border-line-strong group-hover:border-fg-subtle"
                  )}
                >
                  {active ? <CheckIcon size={11} strokeWidth={2.6} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-fg">
                    {t(`launcher.presets.items.${presetKey}.title`)}
                  </span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-fg-muted">
                    {t(`launcher.presets.items.${presetKey}.summary`)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <aside
        className="flex flex-col gap-5 rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        aria-labelledby="launch-summary-title"
      >
        <div>
          <h2
            id="launch-summary-title"
            className="text-base font-semibold text-fg"
          >
            {t("launcher.summary.title")}
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-snug text-fg-muted">
            <span className="font-medium text-fg">
              {t(`launcher.presets.items.${selectedPresetKey}.title`)}
            </span>{" "}
            · {presetSummary}
          </p>
        </div>
        <dl className="flex flex-col divide-y divide-line border-y border-line text-sm">
          {summaryRows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 py-2.5"
            >
              <dt className="text-fg-muted">{label}</dt>
              <dd className="nums text-right font-medium text-fg">{value}</dd>
            </div>
          ))}
        </dl>
        {notice ? (
          <Alert
            tone={notice.tone}
            title={notice.title}
            message={notice.message}
          />
        ) : null}
        <Button
          size="lg"
          busy={pending}
          disabled={!canLaunch}
          onClick={onSubmit}
        >
          {isStudy
            ? t("launcher.actions.createStudyBlock")
            : t("launcher.actions.createExam")}
        </Button>
      </aside>

      <Section
        className="min-w-0 lg:col-start-1"
        title={t("launcher.summary.settings")}
      >
        <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
          <Field label={t("launcher.fields.certification")} htmlFor="exam-id">
            <Select
              id="exam-id"
              value={values.examId}
              onChange={(event) => onChange("examId", event.target.value)}
            >
              <option value="">{t("common.filters.mixedRandom")}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t("launcher.fields.mode")} htmlFor="session-mode">
            <Select
              id="session-mode"
              value={values.mode}
              onChange={(event) =>
                onChange("mode", event.target.value as LaunchFormValues["mode"])
              }
            >
              <option value="exam">{t("common.labels.exam")}</option>
              <option value="study">{t("common.labels.study")}</option>
            </Select>
          </Field>

          <Field
            label={t("launcher.fields.questions")}
            htmlFor="total-questions"
          >
            <Input
              id="total-questions"
              type="number"
              inputMode="numeric"
              min={1}
              max={isStudy ? 120 : 180}
              value={values.totalQuestions}
              onChange={(event) =>
                onChange("totalQuestions", Number(event.target.value || 0))
              }
            />
          </Field>

          <Field
            label={t("launcher.fields.pbqCount")}
            htmlFor="pbq-count"
            hint={t("launcher.fields.pbqCountHint")}
          >
            <Select
              id="pbq-count"
              value={values.pbqCount}
              onChange={(event) =>
                onChange("pbqCount", Number(event.target.value))
              }
            >
              {Array.from({ length: PBQ_MAX_COUNT + 1 }, (_, count) => (
                <option key={count} value={count}>
                  {count === 0
                    ? t("launcher.pbqCount.none")
                    : t("launcher.pbqCount.option", { count })}
                </option>
              ))}
            </Select>
          </Field>

          {!isStudy ? (
            <Field
              label={t("launcher.fields.experienceMode")}
              htmlFor="experience-mode"
              hint={t("launcher.fields.experienceModeHint")}
            >
              <Select
                id="experience-mode"
                value={values.experienceMode}
                onChange={(event) =>
                  onChange(
                    "experienceMode",
                    event.target.value as LaunchFormValues["experienceMode"]
                  )
                }
              >
                <option value="standard">
                  {t("launcher.experienceModes.standard")}
                </option>
                <option value="exam_day">
                  {t("launcher.experienceModes.examDay")}
                </option>
              </Select>
            </Field>
          ) : null}

          {!isStudy ? (
            <Field
              label={t("launcher.fields.timeMinutes")}
              htmlFor="time-limit-minutes"
            >
              <Input
                id="time-limit-minutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={360}
                value={values.timeLimitMinutes}
                onChange={(event) =>
                  onChange("timeLimitMinutes", Number(event.target.value || 0))
                }
              />
            </Field>
          ) : null}
        </div>

        <Disclosure
          summary={t("launcher.fields.advancedFilters")}
          hint={
            advancedCount
              ? t("launcher.advanced.active")
              : t("launcher.advanced.optional")
          }
          meta={
            advancedCount ? (
              <span className="nums rounded-sm bg-primary-soft px-1.5 text-xs font-medium text-primary">
                {advancedCount}
              </span>
            ) : null
          }
          defaultOpen={advancedCount > 0}
        >
          <div className="flex flex-col gap-5">
            <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
              <Field label={t("launcher.fields.domain")} htmlFor="exam-domain">
                <Select
                  id="exam-domain"
                  value={values.domain}
                  onChange={(event) => onChange("domain", event.target.value)}
                  disabled={!domains.length}
                >
                  <option value="">{t("common.filters.allDomains")}</option>
                  {domains.map((domain) => (
                    <option
                      key={`${domain.value}-${domain.label}`}
                      value={domain.value}
                    >
                      {domain.label} ({domain.question_count})
                    </option>
                  ))}
                </Select>
              </Field>

              {isStudy ? (
                <Field
                  label={t("launcher.fields.strategy")}
                  htmlFor="study-strategy"
                >
                  <Select
                    id="study-strategy"
                    value={values.studyStrategy}
                    onChange={(event) =>
                      onChange(
                        "studyStrategy",
                        event.target.value as LaunchFormValues["studyStrategy"]
                      )
                    }
                  >
                    <option value="standard">
                      {t("common.strategies.standard")}
                    </option>
                    <option value="adaptive">
                      {t("common.strategies.adaptive")}
                    </option>
                  </Select>
                </Field>
              ) : (
                <Field
                  label={t("launcher.fields.strategy")}
                  htmlFor="exam-strategy"
                >
                  <Select
                    id="exam-strategy"
                    value={values.examStrategy}
                    onChange={(event) =>
                      onChange(
                        "examStrategy",
                        event.target.value as LaunchFormValues["examStrategy"]
                      )
                    }
                  >
                    <option value="standard">
                      {t("common.strategies.standard")}
                    </option>
                    <option value="adaptive">
                      {t("common.strategies.adaptive")}
                    </option>
                  </Select>
                </Field>
              )}

              <Field
                label={t("launcher.fields.difficulty")}
                htmlFor="difficulty-query"
              >
                <Input
                  id="difficulty-query"
                  type="text"
                  value={values.difficultyQuery}
                  onChange={(event) =>
                    onChange("difficultyQuery", event.target.value)
                  }
                />
              </Field>

              <Field label={t("launcher.fields.tags")} htmlFor="tag-query">
                <Input
                  id="tag-query"
                  type="text"
                  value={values.tagQuery}
                  onChange={(event) => onChange("tagQuery", event.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-x-4 sm:grid-cols-2">
              {(
                [
                  ["bookmarkedOnly", t("launcher.filters.bookmarked")],
                  ["notesOnly", t("launcher.filters.notes")],
                  ["incorrectOnly", t("launcher.filters.incorrect")],
                  ["unseenOnly", t("launcher.filters.unseen")],
                  ["lowConfidenceOnly", t("launcher.filters.lowConfidence")]
                ] as const
              ).map(([field, label]) => (
                <Checkbox
                  key={field}
                  id={`launch-filter-${field}`}
                  checked={values[field]}
                  onChange={(event) => onChange(field, event.target.checked)}
                  label={label}
                />
              ))}
            </div>
          </div>
        </Disclosure>
      </Section>
    </div>
  );
}
