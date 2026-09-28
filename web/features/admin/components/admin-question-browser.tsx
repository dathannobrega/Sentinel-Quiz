"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { useI18n } from "@/lib/i18n";
import type { AdminQuestionSummary, Exam } from "@/types/api";

import { summarizePrompt } from "@/features/admin/utils/question-draft";

interface AdminQuestionBrowserProps {
  exams: Exam[];
  examId: string;
  search: string;
  items: AdminQuestionSummary[];
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  selectedQuestionId: string | null;
  canEdit: boolean;
  onExamChange: (examId: string) => void;
  onSearchChange: (search: string) => void;
  onSelect: (questionId: string) => void;
  onNewQuestion: () => void;
}

export function AdminQuestionBrowser({
  exams,
  examId,
  search,
  items,
  isFetching,
  error,
  onRetry,
  selectedQuestionId,
  canEdit,
  onExamChange,
  onSearchChange,
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
              value={examId}
              onChange={(event) => onExamChange(event.target.value)}
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
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </Field>
        </div>

        {error ? <QueryErrorBanner error={error} onRetry={onRetry} retrying={isFetching} /> : null}

        <div className="sq-list-meta" role="status" aria-live="polite">
          {isFetching ? t("admin.browser.refreshingList") : t("admin.browser.foundCount", { count: items.length })}
        </div>

        {items.length ? (
          <div className="sq-list" role="list" aria-label={t("admin.browser.listAriaLabel")}>
            {items.map((item) => {
              const isActive = item.id === selectedQuestionId;
              return (
                <div key={item.id} role="listitem">
                  <button
                    type="button"
                    className="sq-list-item"
                    onClick={() => onSelect(item.id)}
                    aria-pressed={isActive}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      borderColor: isActive ? "rgba(21,122,110,0.3)" : "var(--sq-border)",
                      background: isActive ? "rgba(21,122,110,0.08)" : "rgba(255,255,255,0.78)"
                    }}
                  >
                    <div className="sq-list-title">
                      {item.id} · {item.exam_id}
                    </div>
                    <div className="sq-list-meta">{summarizePrompt(item.prompt)}</div>
                    <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
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
