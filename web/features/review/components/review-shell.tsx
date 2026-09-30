"use client";

import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { XIcon } from "@/components/ui/icons";
import { Checkbox, Select } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader, Panel, Section } from "@/components/ui/section";
import { WeakSections } from "@/features/study-sections/components/weak-sections";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { ReviewQueueList } from "@/features/review/components/review-queue-list";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useI18n } from "@/lib/i18n";
import { useExamsQuery, useReviewQueueQuery } from "@/lib/query/hooks";
import type { ReviewQueueSnapshot, StudySessionRequest, StudySessionResponse } from "@/types/api";

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

function buildReviewQueueParams(
  examId: string,
  reviewState: string,
  bookmarksOnly: boolean,
  notesOnly: boolean,
  domains: string[]
): URLSearchParams {
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
  return params;
}

export function ReviewShell() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkKey = searchParams.getAll("domains").join("\u0000");
  const deepLinkDomains = useMemo(
    () =>
      deepLinkKey
        .split("\u0000")
        .map((item) => item.trim())
        .filter(Boolean),
    [deepLinkKey]
  );
  const deepLinkAutoStart = searchParams.get("auto_start") === "true";
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [selectedExamId, setSelectedExamId] = useState("");
  const [reviewStateFilter, setReviewStateFilter] = useState("");
  const [reviewBookmarksOnly, setReviewBookmarksOnly] = useState(false);
  const [reviewNotesOnly, setReviewNotesOnly] = useState(false);
  const [reviewDomainFilters, setReviewDomainFilters] = useState<string[]>(deepLinkDomains);
  const hasAutoStartedRef = useRef(false);

  useEffect(() => {
    setReviewDomainFilters(deepLinkDomains);
  }, [deepLinkDomains]);

  const examsQuery = useExamsQuery();
  const queueParams = useMemo(
    () => buildReviewQueueParams(selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly, reviewDomainFilters),
    [selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly, reviewDomainFilters]
  );
  const reviewQueueQuery = useReviewQueueQuery(queueParams);
  const exams = examsQuery.data ?? [];
  const reviewQueue = reviewQueueQuery.data ?? DEFAULT_REVIEW_QUEUE;

  const startReviewMutation = useMutation({
    mutationFn: (payload: StudySessionRequest) => apiClient.post<StudySessionResponse>("/study/review/sessions", payload),
    onSuccess: (response) => {
      persistSessionId("study", response.id);
      startTransition(() => {
        router.push(`/study/${encodeURIComponent(response.id)}`);
      });
    },
    onError: (error) => setPageNotice(readErrorMessage(error, t("review.errors.loadQueue")))
  });
  const { mutate: startReview, isPending: isStartingReview } = startReviewMutation;

  const recommendedBatch = Math.max(reviewQueue.recommended_batch_size || 10, 1);
  const hasQueueItems = reviewQueue.items.length > 0;

  function startRecommendedReview() {
    setPageNotice(null);
    startReview({
      exam_id: selectedExamId || null,
      total_questions: recommendedBatch,
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
    });
  }

  const isInitialLoading = (examsQuery.isPending && examsQuery.isFetching) || (reviewQueueQuery.isPending && reviewQueueQuery.isFetching);

  useEffect(() => {
    if (!deepLinkAutoStart || hasAutoStartedRef.current || isInitialLoading || isStartingReview || !hasQueueItems) {
      return;
    }
    hasAutoStartedRef.current = true;
    setPageNotice(null);
    startReview({
      exam_id: null,
      total_questions: recommendedBatch,
      domains: deepLinkDomains.length ? deepLinkDomains : null,
      difficulties: null,
      tags: null,
      bookmarked_only: false,
      notes_only: false,
      incorrect_only: false,
      unseen_only: false,
      low_confidence_only: false,
      strategy: "review",
      queue_only: true,
      review_states: null
    });
  }, [deepLinkAutoStart, deepLinkDomains, hasQueueItems, isInitialLoading, isStartingReview, recommendedBatch, startReview]);

  if (isInitialLoading) {
    return (
      <Page aria-busy="true">
        <Skeleton height={56} className="max-w-md" />
        <Skeleton height={160} />
        <Skeleton height={320} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title={t("review.header.title")} description={t("review.header.subtitle")} />

      {pageNotice ? <Alert tone="warning" role="alert" title={t("common.errors.attention")} message={pageNotice} /> : null}
      {examsQuery.isError ? (
        <QueryErrorBanner tone="warning" error={examsQuery.error} onRetry={() => void examsQuery.refetch()} retrying={examsQuery.isFetching} />
      ) : null}
      {reviewQueueQuery.isError ? (
        <QueryErrorBanner
          title={t("review.errors.loadQueue")}
          error={reviewQueueQuery.error}
          onRetry={() => void reviewQueueQuery.refetch()}
          retrying={reviewQueueQuery.isFetching}
        />
      ) : null}

      <Panel padding="lg" aria-labelledby="review-today-title">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h2 id="review-today-title" className="text-sm font-medium text-fg-muted">
              {t("review.todayCard.title")}
            </h2>
            <p className="flex items-baseline gap-2">
              <span className="nums text-5xl font-semibold tracking-tight text-fg">{reviewQueue.due_count}</span>
              <span className="text-[0.9375rem] text-fg-muted">{t("review.todayCard.due").toLowerCase()}</span>
            </p>
            <p className="max-w-prose text-[0.8125rem] text-fg-muted">{t("review.todayCard.subtitle")}</p>
          </div>
          <Button size="lg" busy={isStartingReview} disabled={!hasQueueItems} onClick={startRecommendedReview}>
            {t("common.actions.reviewNow")}
          </Button>
        </div>
        <StatList>
          <Stat label={t("review.todayCard.total")} value={reviewQueue.total_count} />
          <Stat label={t("review.todayCard.suggestedBatch")} value={reviewQueue.recommended_batch_size || 0} />
        </StatList>
        {reviewDomainFilters.length ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4" role="group" aria-label={t("review.activeFilters.title")}>
            <span className="text-[0.8125rem] text-fg-muted" title={t("review.activeFilters.subtitle")}>
              {t("review.activeFilters.title")}
            </span>
            {reviewDomainFilters.map((domain) => (
              <button
                key={domain}
                type="button"
                className="focus-ring inline-flex h-7 items-center gap-1.5 rounded-sm bg-primary-soft px-2 text-xs font-medium text-primary hover:bg-primary-soft/70"
                aria-label={t("review.activeFilters.removeDomain", { domain })}
                onClick={() => setReviewDomainFilters((current) => current.filter((item) => item !== domain))}
              >
                {domain}
                <XIcon size={12} />
              </button>
            ))}
          </div>
        ) : null}
      </Panel>

      <WeakSections />

      <Section title={t("review.priorityCard.title")} description={t("review.priorityCard.subtitle")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_1fr] lg:items-end">
          <Field label={t("review.filters.certification")} htmlFor="review-exam-filter">
            <Select id="review-exam-filter" value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)}>
              <option value="">{t("common.filters.all")}</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("review.filters.state")} htmlFor="review-state-filter">
            <Select id="review-state-filter" value={reviewStateFilter} onChange={(event) => setReviewStateFilter(event.target.value)}>
              <option value="">{t("common.filters.everything")}</option>
              <option value="due_today">{t("common.reviewStates.dueToday")}</option>
              <option value="overdue">{t("common.reviewStates.overdue")}</option>
              <option value="at_risk">{t("common.reviewStates.atRisk")}</option>
              <option value="scheduled">{t("common.reviewStates.scheduled")}</option>
              <option value="mastered">{t("common.reviewStates.mastered")}</option>
            </Select>
          </Field>
          <fieldset className="flex flex-wrap gap-x-5 sm:col-span-2 lg:col-span-1">
            <legend className="sr-only">{t("review.filters.refine")}</legend>
            <Checkbox
              id="review-bookmarks-only"
              checked={reviewBookmarksOnly}
              onChange={(event) => setReviewBookmarksOnly(event.target.checked)}
              label={t("review.filters.bookmarksOnly")}
            />
            <Checkbox
              id="review-notes-only"
              checked={reviewNotesOnly}
              onChange={(event) => setReviewNotesOnly(event.target.checked)}
              label={t("review.filters.notesOnly")}
            />
          </fieldset>
        </div>

        {hasQueueItems ? (
          <ReviewQueueList items={reviewQueue.items} t={t} busy={reviewQueueQuery.isFetching} />
        ) : (
          <EmptyState
            description={t("review.empty")}
            action={
              <Link href="/start" className={buttonClassName("secondary", "sm")}>
                {t("common.actions.newSession")}
              </Link>
            }
          />
        )}
      </Section>
    </Page>
  );
}
