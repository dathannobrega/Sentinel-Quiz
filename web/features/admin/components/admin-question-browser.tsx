"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { AdminQuestionStatusFilter, AdminQuestionSummary, Exam } from "@/types/api";

import type { AdminFlagFilter, AdminQuestionFilters } from "@/features/admin/types";
import { deactivatedReasonKey, summarizePrompt } from "@/features/admin/utils/question-draft";

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

/** Master list of the question bank: filter bar + selectable rows. */
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
  const activeLifecycleFilters =
    (filters.status !== "active" ? 1 : 0) + (filters.needsReview !== "any" ? 1 : 0) + (filters.explanationMissing !== "any" ? 1 : 0);

  return (
    <Section
      title={t("admin.browser.title")}
      description={t("admin.browser.subtitle")}
      actions={
        <Button variant="secondary" size="sm" disabled={!canEdit} onClick={onNewQuestion}>
          {t("admin.browser.newQuestion")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t("admin.browser.search")} htmlFor="admin-question-search" hint={t("admin.browser.searchHint")}>
          <Input id="admin-question-search" type="search" value={filters.search} onChange={(event) => onFiltersChange({ search: event.target.value })} />
        </Field>

        <Field label={t("admin.browser.exam")} htmlFor="browser-exam-filter">
          <Select id="browser-exam-filter" value={filters.examId} onChange={(event) => onFiltersChange({ examId: event.target.value })}>
            <option value="">{t("common.filters.all")}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </Select>
        </Field>

        <Disclosure
          variant="plain"
          className="border-t border-b border-line"
          summary={t("admin.browser.moreFilters")}
          meta={activeLifecycleFilters ? <Badge tone="primary">{activeLifecycleFilters}</Badge> : null}
          defaultOpen={activeLifecycleFilters > 0}
          contentClassName="flex flex-col gap-3"
        >
          <Field label={t("admin.lifecycle.statusFilter")} htmlFor="browser-status-filter">
            <Select
              id="browser-status-filter"
              value={filters.status}
              onChange={(event) => onFiltersChange({ status: event.target.value as AdminQuestionStatusFilter })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("admin.lifecycle.needsReviewFilter")} htmlFor="browser-needs-review-filter">
              <Select
                id="browser-needs-review-filter"
                value={filters.needsReview}
                onChange={(event) => onFiltersChange({ needsReview: event.target.value as AdminFlagFilter })}
              >
                {FLAG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("admin.lifecycle.explanationMissingFilter")} htmlFor="browser-explanation-missing-filter">
              <Select
                id="browser-explanation-missing-filter"
                value={filters.explanationMissing}
                onChange={(event) => onFiltersChange({ explanationMissing: event.target.value as AdminFlagFilter })}
              >
                {FLAG_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Disclosure>
      </div>

      {error ? <QueryErrorBanner error={error} onRetry={onRetry} retrying={isFetching} /> : null}

      <p className="nums text-[0.8125rem] text-fg-muted" role="status" aria-live="polite">
        {isFetching ? t("admin.browser.refreshingList") : t("admin.browser.foundCount", { count: items.length })}
      </p>

      {items.length ? (
        <ul
          className="-mx-1 flex flex-col gap-1 overflow-y-auto px-1 pb-1 lg:max-h-[calc(100dvh-26rem)]"
          aria-label={t("admin.browser.listAriaLabel")}
        >
          {items.map((item) => {
            const isSelected = item.id === selectedQuestionId;
            const isInactive = item.is_active === false;
            const meta = [
              item.certification,
              item.domain,
              item.difficulty,
              item.editorial_status,
              item.draft_version_number ? t("admin.browser.draftVersion", { version: item.draft_version_number }) : null,
              item.published_version_number ? t("admin.browser.publishedVersion", { version: item.published_version_number }) : null,
              t("admin.browser.correctOptions", { correct: item.correct_count, count: item.option_count }),
              item.multi_select ? t("admin.browser.multi") : t("admin.browser.single"),
              item.loaded_from === "draft" ? t("admin.browser.draft") : null
            ].filter(Boolean);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "focus-ring flex w-full flex-col gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                    isSelected ? "border-primary bg-primary-soft" : "border-transparent hover:bg-surface-muted",
                    isInactive && !isSelected && "opacity-70"
                  )}
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="truncate font-mono text-xs text-fg-muted">{item.id}</span>
                    <span className="shrink-0 truncate font-mono text-xs text-fg-subtle">{item.exam_id}</span>
                  </span>
                  <span className="line-clamp-2 text-sm leading-snug text-fg">{summarizePrompt(item.prompt)}</span>
                  {isInactive || item.needs_review || item.explanation_missing ? (
                    <span className="flex flex-wrap gap-1">
                      {isInactive ? (
                        <Badge tone="danger" title={t(deactivatedReasonKey(item.deactivated_reason))}>
                          {t("admin.lifecycle.inactiveBadge")}
                        </Badge>
                      ) : null}
                      {item.needs_review ? <Badge tone="warning">{t("admin.lifecycle.needsReview")}</Badge> : null}
                      {item.explanation_missing ? <Badge tone="warning">{t("admin.lifecycle.explanationMissing")}</Badge> : null}
                    </span>
                  ) : null}
                  <span className="text-xs leading-snug text-fg-subtle">{meta.join(" · ")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState size="compact" description={t("admin.browser.empty")} />
      )}
    </Section>
  );
}
