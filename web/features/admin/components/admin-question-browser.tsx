"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { useI18n } from "@/lib/i18n";
import type { AdminQuestionStatusFilter, AdminQuestionSummary, Exam } from "@/types/api";

import type { AdminFlagFilter, AdminQuestionFilters } from "@/features/admin/types";
import { WARNING_CHIP_STYLE, deactivatedReasonKey, summarizePrompt } from "@/features/admin/utils/question-draft";

const STATUS_OPTIONS: Array<{ value: AdminQuestionStatusFilter; labelKey: string }> = [
  { value: "active", labelKey: "admin.lifecycle.statusActive" },
  { value: "inactive", labelKey: "admin.lifecycle.statusInactive" },
  { value: "all", labelKey: "admin.lifecycle.statusAll" }
];

const FLAG_OPTIONS: Array<{ value: AdminFlagFilter; labelKey: string }> = [
  { value: "any", labelKey: "admin.lifecycle.flagAny" },
  { value: "yes", labelKey: "admin.lifecycle.flagYes" },
  { value: "no", labelKey: "admin.lifecycle.flagNo" }
];

interface AdminQuestionBrowserProps {
  exams: Exam[];
  filters: AdminQuestionFilters;
  items: AdminQuestionSummary[];
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  selectedQuestionId: string | null;
  canEdit: boolean;
  onFiltersChange: (patch: Partial<AdminQuestionFilters>) => void;
  onSelect: (questionId: string) => void;
  onNewQuestion: () => void;
}

export function AdminQuestionBrowser({
  exams,
  filters,
  items,
  isFetching,
  error,
  onRetry,
  selectedQuestionId,
  canEdit,
  onFiltersChange,
  onSelect,
  onNewQuestion
}: AdminQuestionBrowserProps) {
  const { t } = useI18n();

  return (
    <Card
      title={t("admin.browser.title")}
      subtitle={t("admin.browser.subtitle")}
      actions={
        <Button variant="secondary" size="sm" disabled={!canEdit} onClick={onNewQuestion}>
          {t("admin.browser.newQuestion")}
        </Button>
      }
    >
      <div className="sq-surface-block">
        <div className="sq-form-grid">
          <Field label={t("admin.browser.exam")} htmlFor="browser-exam-filter">
            <select
              id="browser-exam-filter"
              className="sq-select"
              value={filters.examId}
              onChange={(event) => onFiltersChange({ examId: event.target.value })}
            >
              <option value="">{t("common.filters.all")}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("admin.browser.search")} htmlFor="admin-question-search" hint={t("admin.browser.searchHint")}>
            <input
              id="admin-question-search"
              className="sq-input"
              type="search"
              value={filters.search}
              onChange={(event) => onFiltersChange({ search: event.target.value })}
            />
          </Field>

          <Field label={t("admin.lifecycle.statusFilter")} htmlFor="browser-status-filter">
            <select
              id="browser-status-filter"
              className="sq-select"
              value={filters.status}
              onChange={(event) => onFiltersChange({ status: event.target.value as AdminQuestionStatusFilter })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("admin.lifecycle.needsReviewFilter")} htmlFor="browser-needs-review-filter">
            <select
              id="browser-needs-review-filter"
              className="sq-select"
              value={filters.needsReview}
              onChange={(event) => onFiltersChange({ needsReview: event.target.value as AdminFlagFilter })}
            >
              {FLAG_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("admin.lifecycle.explanationMissingFilter")} htmlFor="browser-explanation-missing-filter">
            <select
              id="browser-explanation-missing-filter"
              className="sq-select"
              value={filters.explanationMissing}
              onChange={(event) => onFiltersChange({ explanationMissing: event.target.value as AdminFlagFilter })}
            >
              {FLAG_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {error ? <QueryErrorBanner error={error} onRetry={onRetry} retrying={isFetching} /> : null}

        <div className="sq-list-meta" role="status" aria-live="polite">
          {isFetching ? t("admin.browser.refreshingList") : t("admin.browser.foundCount", { count: items.length })}
        </div>

        {items.length ? (
          <div className="sq-list" role="list" aria-label={t("admin.browser.listAriaLabel")}>
            {items.map((item) => {
              const isSelected = item.id === selectedQuestionId;
              const isInactive = item.is_active === false;
              return (
                <div key={item.id} role="listitem">
                  <button
                    type="button"
                    className="sq-list-item"
                    onClick={() => onSelect(item.id)}
                    aria-pressed={isSelected}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      opacity: isInactive ? 0.75 : undefined,
                      borderColor: isSelected ? "rgba(21,122,110,0.3)" : "var(--sq-border)",
                      background: isSelected ? "rgba(21,122,110,0.08)" : "rgba(255,255,255,0.78)"
                    }}
                  >
                    <div className="sq-list-title">
                      {item.id} · {item.exam_id}
                    </div>
                    <div className="sq-list-meta">{summarizePrompt(item.prompt)}</div>
                    <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
                      {isInactive ? (
                        <span className="sq-chip sq-chip--danger" title={t(deactivatedReasonKey(item.deactivated_reason))}>
                          {t("admin.lifecycle.inactiveBadge")}
                        </span>
                      ) : null}
                      {item.needs_review ? (
                        <span className="sq-chip" style={WARNING_CHIP_STYLE}>
                          {t("admin.lifecycle.needsReview")}
                        </span>
                      ) : null}
                      {item.explanation_missing ? (
                        <span className="sq-chip" style={WARNING_CHIP_STYLE}>
                          {t("admin.lifecycle.explanationMissing")}
                        </span>
                      ) : null}
                      {item.certification ? <span className="sq-chip">{item.certification}</span> : null}
                      {item.domain ? <span className="sq-chip">{item.domain}</span> : null}
                      {item.difficulty ? <span className="sq-chip">{item.difficulty}</span> : null}
                      {item.editorial_status ? <span className="sq-chip">{item.editorial_status}</span> : null}
                      {item.draft_version_number ? (
                        <span className="sq-chip">{t("admin.browser.draftVersion", { version: item.draft_version_number })}</span>
                      ) : null}
                      {item.published_version_number ? (
                        <span className="sq-chip">
                          {t("admin.browser.publishedVersion", { version: item.published_version_number })}
                        </span>
                      ) : null}
                      <span className="sq-chip">
                        {t("admin.browser.correctOptions", { correct: item.correct_count, count: item.option_count })}
                      </span>
                      <span className="sq-chip">{item.multi_select ? t("admin.browser.multi") : t("admin.browser.single")}</span>
                      {item.loaded_from === "draft" ? <span className="sq-chip">{t("admin.browser.draft")}</span> : null}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sq-empty">{t("admin.browser.empty")}</div>
        )}
      </div>
    </Card>
  );
}
