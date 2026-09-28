"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useI18n } from "@/lib/i18n";
import { StatusBanner } from "@/components/ui/status-banner";
import type { DomainCatalogEntry, Exam } from "@/types/api";

import type { DashboardNotice, LaunchFormValues } from "@/features/dashboard/types";
import type { LaunchPresetKey } from "@/features/dashboard/types";

interface ExamLauncherProps {
  exams: Exam[];
  domains: DomainCatalogEntry[];
  values: LaunchFormValues;
  notice: DashboardNotice | null;
  pending: boolean;
  selectedPresetKey: LaunchPresetKey;
  presetSummary: string;
  onChange: (field: keyof LaunchFormValues, value: LaunchFormValues[keyof LaunchFormValues]) => void;
  onApplyPreset: (presetKey: LaunchPresetKey) => void;
  onSubmit: () => void;
}

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
  const hasAdvancedFilters =
    values.bookmarkedOnly || values.notesOnly || values.incorrectOnly || values.unseenOnly || values.lowConfidenceOnly;

  return (
    <Card
      title={t("launcher.card.title")}
      subtitle={t("launcher.card.subtitle")}
    >
      <div className="sq-surface-block">
        {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        <div className="sq-page-stack">
          <div className="sq-list-title">{t("launcher.presets.title")}</div>
          <div className="sq-grid-2">
            {([
              "placement",
              "daily_review",
              "quick_15",
              "comptia_exam",
              "sprint_25",
              "custom"
            ] as LaunchPresetKey[]).map((presetKey) => (
              <button
                key={presetKey}
                type="button"
                className="sq-surface-block"
                aria-pressed={selectedPresetKey === presetKey}
                onClick={() => onApplyPreset(presetKey)}
                style={{
                  textAlign: "left",
                  border:
                    selectedPresetKey === presetKey
                      ? "1px solid rgba(14, 116, 144, 0.55)"
                      : "1px solid rgba(148, 163, 184, 0.18)",
                  cursor: "pointer"
                }}
              >
                <div className="sq-list-title">{t(`launcher.presets.items.${presetKey}.title`)}</div>
                <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-2)" }}>
                  {t(`launcher.presets.items.${presetKey}.summary`)}
                </div>
              </button>
            ))}
          </div>
          <div className="sq-list-item">
            <div className="sq-list-title">{t("launcher.presets.summaryTitle")}</div>
            <div className="sq-list-meta">{presetSummary}</div>
          </div>
        </div>

        <div className="sq-form-grid">
          <Field label={t("launcher.fields.certification")} htmlFor="exam-id">
            <select
              id="exam-id"
              className="sq-select"
              value={values.examId}
              onChange={(event) => onChange("examId", event.target.value)}
            >
              <option value="">{t("common.filters.mixedRandom")}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("launcher.fields.mode")} htmlFor="session-mode">
            <select
              id="session-mode"
              className="sq-select"
              value={values.mode}
              onChange={(event) => onChange("mode", event.target.value as LaunchFormValues["mode"])}
            >
              <option value="exam">{t("common.labels.exam")}</option>
              <option value="study">{t("common.labels.study")}</option>
            </select>
          </Field>

          <Field label={t("launcher.fields.questions")} htmlFor="total-questions">
            <input
              id="total-questions"
              className="sq-input"
              type="number"
              min={1}
              max={isStudy ? 120 : 180}
              value={values.totalQuestions}
              onChange={(event) => onChange("totalQuestions", Number(event.target.value || 0))}
            />
          </Field>

          {!isStudy ? (
            <Field
              label={t("launcher.fields.experienceMode")}
              htmlFor="experience-mode"
              hint={t("launcher.fields.experienceModeHint")}
            >
              <select
                id="experience-mode"
                className="sq-select"
                value={values.experienceMode}
                onChange={(event) => onChange("experienceMode", event.target.value as LaunchFormValues["experienceMode"])}
              >
                <option value="standard">{t("launcher.experienceModes.standard")}</option>
                <option value="exam_day">{t("launcher.experienceModes.examDay")}</option>
              </select>
            </Field>
          ) : null}

          {!isStudy ? (
            <Field label={t("launcher.fields.timeMinutes")} htmlFor="time-limit-minutes">
              <input
                id="time-limit-minutes"
                className="sq-input"
                type="number"
                min={5}
                max={360}
                value={values.timeLimitMinutes}
                onChange={(event) => onChange("timeLimitMinutes", Number(event.target.value || 0))}
              />
            </Field>
          ) : null}
        </div>

        <details className="sq-disclosure sq-list-item" open={hasAdvancedFilters ? true : undefined}>
          <summary className="sq-disclosure__summary">
            {t("launcher.fields.advancedFilters")}
            <span className="sq-chip">{hasAdvancedFilters ? t("launcher.advanced.active") : t("launcher.advanced.optional")}</span>
          </summary>

          <div className="sq-stack-md">
            <div className="sq-form-grid">
              <Field label={t("launcher.fields.domain")} htmlFor="exam-domain">
                <select
                  id="exam-domain"
                  className="sq-select"
                  value={values.domain}
                  onChange={(event) => onChange("domain", event.target.value)}
                  disabled={!domains.length}
                >
                  <option value="">{t("common.filters.allDomains")}</option>
                  {domains.map((domain) => (
                    <option key={`${domain.value}-${domain.label}`} value={domain.value}>
                      {domain.label} ({domain.question_count})
                    </option>
                  ))}
                </select>
              </Field>

              {isStudy ? (
                <Field label={t("launcher.fields.strategy")} htmlFor="study-strategy">
                  <select
                    id="study-strategy"
                    className="sq-select"
                    value={values.studyStrategy}
                    onChange={(event) => onChange("studyStrategy", event.target.value as LaunchFormValues["studyStrategy"])}
                  >
                    <option value="standard">{t("common.strategies.standard")}</option>
                    <option value="adaptive">{t("common.strategies.adaptive")}</option>
                  </select>
                </Field>
              ) : (
                <Field label={t("launcher.fields.strategy")} htmlFor="exam-strategy">
                  <select
                    id="exam-strategy"
                    className="sq-select"
                    value={values.examStrategy}
                    onChange={(event) => onChange("examStrategy", event.target.value as LaunchFormValues["examStrategy"])}
                  >
                    <option value="standard">{t("common.strategies.standard")}</option>
                    <option value="adaptive">{t("common.strategies.adaptive")}</option>
                  </select>
                </Field>
              )}

              <Field label={t("launcher.fields.difficulty")} htmlFor="difficulty-query">
                <input
                  id="difficulty-query"
                  className="sq-input"
                  type="text"
                  value={values.difficultyQuery}
                  onChange={(event) => onChange("difficultyQuery", event.target.value)}
                />
              </Field>

              <Field label={t("launcher.fields.tags")} htmlFor="tag-query">
                <input
                  id="tag-query"
                  className="sq-input"
                  type="text"
                  value={values.tagQuery}
                  onChange={(event) => onChange("tagQuery", event.target.value)}
                />
              </Field>
            </div>

            <div className="sq-checkbox-grid">
              {[
                ["bookmarkedOnly", t("launcher.filters.bookmarked")],
                ["notesOnly", t("launcher.filters.notes")],
                ["incorrectOnly", t("launcher.filters.incorrect")],
                ["unseenOnly", t("launcher.filters.unseen")],
                ["lowConfidenceOnly", t("launcher.filters.lowConfidence")]
              ].map(([field, label]) => (
                <label key={field} className="sq-checkbox-row">
                  <input
                    type="checkbox"
                    checked={values[field as keyof LaunchFormValues] as boolean}
                    onChange={(event) => onChange(field as keyof LaunchFormValues, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </details>

        <div className="sq-actions">
          <Button busy={pending} disabled={!canLaunch} onClick={onSubmit}>
            {isStudy ? t("launcher.actions.createStudyBlock") : t("launcher.actions.createExam")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
