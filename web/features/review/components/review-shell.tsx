"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils/format";
import type { Exam, ReviewQueueSnapshot, SessionResponse, StudySessionRequest } from "@/types/api";

const DEFAULT_REVIEW_QUEUE: ReviewQueueSnapshot = {
  due_count: 0,
  total_count: 0,
  next_due_at: null,
  recommended_batch_size: 0,
  state_breakdown: {
    due_now: 0,
    overdue: 0,
    at_risk: 0,
    scheduled: 0,
    mastered: 0
  },
  upcoming_load: [],
  goals: {
    daily_review_target: 0,
    weekly_review_target: 0,
    new_question_budget: 0
  },
  applied_filters: {},
  items: []
};

function readReviewError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function describeQueueState(
  item: ReviewQueueSnapshot["items"][number],
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  if (item.is_overdue) {
    return t("review.queueState.overdue", { days: item.overdue_days });
  }
  if (item.state === "due_now") {
    return t("review.queueState.dueToday");
  }
  if (item.state === "at_risk") {
    return t("review.queueState.atRisk");
  }
  if (item.state === "mastered") {
    return t("review.queueState.mastered");
  }
  return item.due_at
    ? t("review.queueState.scheduledFor", { date: formatDateTime(item.due_at) })
    : t("review.queueState.scheduled");
}

function buildReviewQueueQuery(
  examId: string,
  reviewState: string,
  bookmarksOnly: boolean,
  notesOnly: boolean,
  domains: string[]
): string {
  const params = new URLSearchParams();
  if (examId) {
    params.set("exam_id", examId);
  }
  domains.forEach((domain) => params.append("domains", domain));
  if (reviewState) {
    params.append("review_states", reviewState);
  }
  if (bookmarksOnly) {
    params.set("bookmarked_only", "true");
  }
  if (notesOnly) {
    params.set("notes_only", "true");
  }
  params.set("limit", "12");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function ReviewShell() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkDomains = useMemo(
    () => searchParams.getAll("domains").map((item) => item.trim()).filter(Boolean),
    [searchParams]
  );
  const deepLinkAutoStart = searchParams.get("auto_start") === "true";
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [exams, setExams] = useState<Exam[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueSnapshot>(DEFAULT_REVIEW_QUEUE);

  const [selectedExamId, setSelectedExamId] = useState("");
  const [reviewStateFilter, setReviewStateFilter] = useState("");
  const [reviewBookmarksOnly, setReviewBookmarksOnly] = useState(false);
  const [reviewNotesOnly, setReviewNotesOnly] = useState(false);
  const [reviewDomainFilters, setReviewDomainFilters] = useState<string[]>(deepLinkDomains);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    setPageNotice(null);

    const results = await Promise.allSettled([
      apiClient.get<Exam[]>("/exams"),
      apiClient.get<ReviewQueueSnapshot>(
        `/study/review/queue${buildReviewQueueQuery(
          selectedExamId,
          reviewStateFilter,
          reviewBookmarksOnly,
          reviewNotesOnly,
          reviewDomainFilters
        )}`
      )
    ]);

    if (results[0].status === "fulfilled") {
      setExams(results[0].value);
    } else {
      setExams([]);
      setPageNotice(readReviewError(results[0].reason, t("review.errors.loadQueue")));
    }

    if (results[1].status === "fulfilled") {
      setReviewQueue(results[1].value);
    } else {
      setReviewQueue(DEFAULT_REVIEW_QUEUE);
      setPageNotice(readReviewError(results[1].reason, t("review.errors.loadQueue")));
    }

    setIsLoading(false);
  });

  const refreshQueue = useEffectEvent(async () => {
    try {
      const snapshot = await apiClient.get<ReviewQueueSnapshot>(
        `/study/review/queue${buildReviewQueueQuery(
          selectedExamId,
          reviewStateFilter,
          reviewBookmarksOnly,
          reviewNotesOnly,
          reviewDomainFilters
        )}`
      );
      setReviewQueue(snapshot);
    } catch (error) {
      setPageNotice(readReviewError(error, t("review.errors.loadQueue")));
    }
  });

  const startRecommendedReview = useEffectEvent(async () => {
    setIsStartingReview(true);
    setPageNotice(null);

    try {
      const payload: StudySessionRequest = {
        exam_id: selectedExamId || null,
        total_questions: Math.max(reviewQueue.recommended_batch_size || 10, 1),
        domains: reviewDomainFilters.length ? reviewDomainFilters : null,
        difficulties: null,
        tags: null,
        bookmarked_only: reviewBookmarksOnly,
        notes_only: reviewNotesOnly,
        incorrect_only: false,
        unseen_only: false,
        low_confidence_only: false,
        strategy: "review",
        queue_only: true,
        review_states: reviewStateFilter ? [reviewStateFilter] : null
      };

      const response = await apiClient.post<SessionResponse>("/study/review/sessions", payload);
      persistSessionId("study", response.id);
      startTransition(() => {
        router.push(`/study/${response.id}`);
      });
    } catch (error) {
      setPageNotice(readReviewError(error, t("review.errors.loadQueue")));
    } finally {
      setIsStartingReview(false);
    }
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    void refreshQueue();
  }, [selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly, reviewDomainFilters, isLoading, refreshQueue]);

  useEffect(() => {
    setReviewDomainFilters(deepLinkDomains);
  }, [deepLinkDomains]);

  useEffect(() => {
    if (isLoading || isStartingReview || hasAutoStarted || !deepLinkAutoStart || !reviewQueue.items.length) {
      return;
    }
    setHasAutoStarted(true);
    void startRecommendedReview();
  }, [deepLinkAutoStart, hasAutoStarted, isLoading, isStartingReview, reviewQueue.items.length, startRecommendedReview]);

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={320} />
        </div>
      </main>
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">{t("review.header.title")}</div>
              <p className="sq-page-subtitle">{t("review.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/start">{t("common.labels.start")}</Link>
            <Link href="/history">{t("common.labels.history")}</Link>
          </div>
        </header>

        {pageNotice ? <StatusBanner tone="warning" title={t("common.errors.attention")} message={pageNotice} /> : null}

        {reviewDomainFilters.length ? (
          <Card title="Filtros ativos" subtitle="Este bloco veio de um deep link de revisão focada por domínio.">
            <div className="sq-chip-row">
              {reviewDomainFilters.map((domain) => (
                <button
                  key={domain}
                  type="button"
                  className="sq-chip"
                  onClick={() => setReviewDomainFilters((current) => current.filter((item) => item !== domain))}
                >
                  {domain} ×
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <Card
          title={t("review.todayCard.title")}
          subtitle={t("review.todayCard.subtitle")}
          actions={
            <Button
              variant="secondary"
              size="sm"
              busy={isStartingReview}
              disabled={!reviewQueue.items.length}
              onClick={() => void startRecommendedReview()}
            >
              {t("common.actions.reviewNow")}
            </Button>
          }
        >
          <div className="sq-metric-grid">
            <div className="sq-metric-card">
              <span className="sq-muted">{t("review.todayCard.due")}</span>
              <strong>{reviewQueue.due_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">{t("review.todayCard.total")}</span>
              <strong>{reviewQueue.total_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">{t("review.todayCard.suggestedBatch")}</span>
              <strong>{reviewQueue.recommended_batch_size || 0}</strong>
            </div>
          </div>
        </Card>

        <Card title={t("review.filters.title")} subtitle={t("review.filters.subtitle")}>
          <div className="sq-stack-md">
            <div className="sq-form-grid">
              <Field label={t("review.filters.certification")} htmlFor="review-exam-filter">
                <select
                  id="review-exam-filter"
                  className="sq-select"
                  value={selectedExamId}
                  onChange={(event) => setSelectedExamId(event.target.value)}
                >
                  <option value="">{t("common.filters.all")}</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("review.filters.state")} htmlFor="review-state-filter">
                <select
                  id="review-state-filter"
                  className="sq-select"
                  value={reviewStateFilter}
                  onChange={(event) => setReviewStateFilter(event.target.value)}
                >
                  <option value="">{t("common.filters.everything")}</option>
                  <option value="due_today">{t("common.reviewStates.dueToday")}</option>
                  <option value="overdue">{t("common.reviewStates.overdue")}</option>
                  <option value="at_risk">{t("common.reviewStates.atRisk")}</option>
                  <option value="scheduled">{t("common.reviewStates.scheduled")}</option>
                  <option value="mastered">{t("common.reviewStates.mastered")}</option>
                </select>
              </Field>
            </div>

            <div className="sq-checkbox-grid">
              <label className="sq-checkbox-row">
                <input
                  type="checkbox"
                  checked={reviewBookmarksOnly}
                  onChange={(event) => setReviewBookmarksOnly(event.target.checked)}
                />
                {t("review.filters.bookmarksOnly")}
              </label>
              <label className="sq-checkbox-row">
                <input type="checkbox" checked={reviewNotesOnly} onChange={(event) => setReviewNotesOnly(event.target.checked)} />
                {t("review.filters.notesOnly")}
              </label>
            </div>
          </div>
        </Card>

        <Card title={t("review.priorityCard.title")} subtitle={t("review.priorityCard.subtitle")}>
          {reviewQueue.items.length ? (
            <div className="sq-list">
              {reviewQueue.items.map((item) => (
                <div key={item.question_id} className="sq-list-item">
                  <div className="sq-list-title">{item.prompt}</div>
                  <div className="sq-list-meta">
                    {[item.certification, item.domain, item.state].filter(Boolean).join(" · ")} · {describeQueueState(item, t)}
                  </div>
                  {(item.bookmarked || item.has_note) ? (
                    <div className="sq-chip-row sq-gap-top-sm">
                      {item.bookmarked ? <span className="sq-chip">{t("common.status.marked")}</span> : null}
                      {item.has_note ? <span className="sq-chip">{t("common.status.withNote")}</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="sq-empty">{t("review.empty")}</div>
          )}
        </Card>
      </div>
    </main>
  );
}
