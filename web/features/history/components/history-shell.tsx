"use client";

import { startTransition, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { AlertIcon, CircleCheckIcon } from "@/components/ui/icons";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { Meter } from "@/components/ui/meter";
import { Page, PageHeader, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { Tabs } from "@/components/ui/tabs";
import { ReviewQueueList } from "@/features/review/components/review-queue-list";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useI18n } from "@/lib/i18n";
import {
  useExamHistoryQuery,
  useExamsQuery,
  useReviewQueueQuery,
  useStudyHistoryQuery,
  useStudyWeeklyQuery
} from "@/lib/query/hooks";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  ReviewQueueGoals,
  ReviewQueueSnapshot,
  SessionHistoryItem,
  StudyHistoryItem,
  StudySessionRequest,
  StudySessionResponse,
  StudyWeeklyAnalytics,
  StudyWeeklySummary
} from "@/types/api";

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

const DEFAULT_WEEKLY_ANALYTICS: StudyWeeklyAnalytics = {
  weeks: [],
  summary: {}
};

const EMPTY_EXAM_HISTORY: SessionHistoryItem[] = [];
const EMPTY_STUDY_HISTORY: StudyHistoryItem[] = [];

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(haystack: Array<string | null | undefined>, searchTerm: string): boolean {
  if (!searchTerm) {
    return true;
  }

  return haystack.some((item) => String(item || "").toLowerCase().includes(searchTerm));
}

function averageScore(items: Array<{ score_percent: number }>): number | null {
  if (!items.length) {
    return null;
  }

  return items.reduce((sum, item) => sum + item.score_percent, 0) / items.length;
}

function resolveExamResultHref(item: SessionHistoryItem): string {
  return `/exam/${encodeURIComponent(item.id)}/result`;
}

function resolveStudyResultHref(item: StudyHistoryItem): string {
  return `/study/${encodeURIComponent(item.id)}/result`;
}

function buildReviewQueueParams(
  examId: string,
  reviewState: string,
  bookmarksOnly: boolean,
  notesOnly: boolean
): URLSearchParams {
  const params = new URLSearchParams();
  if (examId) {
    params.set("exam_id", examId);
  }
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

export function HistoryShell() {
  const { t } = useI18n();
  const router = useRouter();
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [selectedExamId, setSelectedExamId] = useState("");
  const [minimumScore, setMinimumScore] = useState("0");
  const [searchValue, setSearchValue] = useState("");
  const [reviewStateFilter, setReviewStateFilter] = useState("");
  const [reviewBookmarksOnly, setReviewBookmarksOnly] = useState(false);
  const [reviewNotesOnly, setReviewNotesOnly] = useState(false);

  const examsQuery = useExamsQuery();
  const examHistoryQuery = useExamHistoryQuery(80);
  const studyHistoryQuery = useStudyHistoryQuery(80);
  const weeklyQuery = useStudyWeeklyQuery(8);
  const reviewQueueParams = useMemo(
    () => buildReviewQueueParams(selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly),
    [selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly]
  );
  const reviewQueueQuery = useReviewQueueQuery(reviewQueueParams);

  const exams = examsQuery.data ?? [];
  const examHistory = examHistoryQuery.data ?? EMPTY_EXAM_HISTORY;
  const studyHistory = studyHistoryQuery.data ?? EMPTY_STUDY_HISTORY;
  const weeklyAnalytics = weeklyQuery.data ?? DEFAULT_WEEKLY_ANALYTICS;
  const reviewQueue = reviewQueueQuery.data ?? DEFAULT_REVIEW_QUEUE;

  const sections = [
    { query: examsQuery, label: t("history.failedAreas.exams") },
    { query: examHistoryQuery, label: t("history.failedAreas.examSessions") },
    { query: studyHistoryQuery, label: t("history.failedAreas.study") },
    { query: weeklyQuery, label: t("history.failedAreas.weekly") },
    { query: reviewQueueQuery, label: t("history.failedAreas.reviewQueue") }
  ];
  const isLoading = sections.some((section) => section.query.isPending && section.query.isFetching);
  const failedSections = sections.filter((section) => section.query.isError);
  const loadError = failedSections.length
    ? t("history.errors.partialLoad", { items: failedSections.map((section) => section.label).join(", ") })
    : null;

  function retryFailed() {
    failedSections.forEach((section) => {
      void section.query.refetch();
    });
  }

  const deferredSearch = useDeferredValue(searchValue);
  const normalizedSearch = normalizeSearch(deferredSearch);
  const minimumScoreValue = Number(minimumScore || 0);

  const filteredExamHistory = useMemo(() => {
    return examHistory.filter((item) => {
      const matchesExam = !selectedExamId || item.exam_id === selectedExamId;
      const matchesMinScore = item.score_percent >= minimumScoreValue;
      const matchesText = matchesSearch([item.exam_title, item.exam_id, item.selection_strategy], normalizedSearch);
      return matchesExam && matchesMinScore && matchesText;
    });
  }, [examHistory, selectedExamId, minimumScoreValue, normalizedSearch]);

  const filteredStudyHistory = useMemo(() => {
    return studyHistory.filter((item) => {
      const matchesExam = !selectedExamId || item.exam_id === selectedExamId;
      const matchesMinScore = item.score_percent >= minimumScoreValue;
      const matchesText = matchesSearch(
        [item.exam_title, item.exam_id, item.selection_strategy, ...(item.weakest_domains || [])],
        normalizedSearch
      );
      return matchesExam && matchesMinScore && matchesText;
    });
  }, [studyHistory, selectedExamId, minimumScoreValue, normalizedSearch]);

  const examAverage = averageScore(filteredExamHistory);
  const studyAverage = averageScore(filteredStudyHistory);
  const weeklySummary = weeklyAnalytics.summary as StudyWeeklySummary;
  const recommendation = String(weeklySummary.recommendation || "").trim();
  const weeklyGoal: ReviewQueueGoals & {
    weekly_question_target?: number;
    weekly_new_question_target?: number;
    completion_ratio_percent?: number;
    suggested_daily_question_target?: number;
    suggested_daily_review_target?: number;
    on_track?: boolean;
  } = {
    daily_review_target: reviewQueue.goals.daily_review_target,
    weekly_review_target: reviewQueue.goals.weekly_review_target,
    new_question_budget: reviewQueue.goals.new_question_budget,
    ...(weeklySummary.weekly_goal || {})
  };
  const reviewForecast = weeklySummary.review_forecast;

  const startReviewMutation = useMutation({
    mutationFn: (payload: StudySessionRequest) => apiClient.post<StudySessionResponse>("/study/review/sessions", payload),
    onSuccess: (response) => {
      persistSessionId("study", response.id);
      startTransition(() => {
        router.push(`/study/${encodeURIComponent(response.id)}`);
      });
    },
    onError: (error) => setPageNotice(readErrorMessage(error, t("history.errors.loadHistory")))
  });
  const isStartingReview = startReviewMutation.isPending;

  function startRecommendedReview() {
    setPageNotice(null);
    startReviewMutation.mutate({
      exam_id: selectedExamId || null,
      total_questions: Math.max(reviewQueue.recommended_batch_size || 10, 1),
      domains: null,
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

  if (isLoading) {
    return (
      <Page aria-busy="true">
        <Skeleton height={56} className="max-w-md" />
        <Skeleton height={64} />
        <Skeleton height={420} />
      </Page>
    );
  }

  const sessionTab = (
    <div className="flex flex-col gap-10">
      <StatList className="border-t-0 pt-0">
        <Stat label={t("history.sessions.filteredExams")} value={filteredExamHistory.length} />
        <Stat label={t("history.sessions.examAverage")} value={examAverage === null ? "-" : formatScore(examAverage)} />
        <Stat label={t("history.sessions.studyAverage")} value={studyAverage === null ? "-" : formatScore(studyAverage)} />
      </StatList>

      {recommendation ? <Alert tone="neutral" message={recommendation} /> : null}

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
        <Section title={t("history.sessions.examsTitle")} description={t("history.sessions.examsSubtitle")}>
          {filteredExamHistory.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {filteredExamHistory.map((item) => (
                <SessionRow
                  key={item.id}
                  href={resolveExamResultHref(item)}
                  title={item.exam_title || item.exam_id || t("history.labels.mixedSession")}
                  meta={t("history.labels.examRowMeta", {
                    correct: item.correct_count,
                    total: item.total_questions,
                    date: formatDateTime(item.completed_at)
                  })}
                  score={item.score_percent}
                />
              ))}
            </ul>
          ) : (
            <EmptyState description={t("history.labels.noExams")} />
          )}
        </Section>

        <Section title={t("history.sessions.studiesTitle")} description={t("history.sessions.studiesSubtitle")}>
          {filteredStudyHistory.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {filteredStudyHistory.map((item) => (
                <SessionRow
                  key={item.id}
                  href={resolveStudyResultHref(item)}
                  title={item.exam_title || item.exam_id || t("history.labels.mixedBlock")}
                  meta={t("history.labels.studyRowMeta", {
                    strategy: item.selection_strategy,
                    date: formatDateTime(item.completed_at)
                  })}
                  detail={item.weakest_domains.length ? item.weakest_domains.slice(0, 3).join(" · ") : undefined}
                  score={item.score_percent}
                />
              ))}
            </ul>
          ) : (
            <EmptyState description={t("history.labels.noStudies")} />
          )}
        </Section>
      </div>
    </div>
  );

  const reviewTab = (
    <div className="flex flex-col gap-10">
      <StatList className="border-t-0 pt-0">
        <Stat label={t("history.sessions.dueQueue")} value={reviewQueue.due_count} />
        <Stat label={t("history.sessions.totalQueue")} value={reviewQueue.total_count} />
        <Stat label={t("history.sessions.nextReview")} value={reviewQueue.next_due_at ? formatDateTime(reviewQueue.next_due_at) : "-"} />
      </StatList>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
        <Section title={t("history.reviewPanel.weeklyGoalTitle")} description={t("history.reviewPanel.weeklyGoalSubtitle")}>
          <StatList>
            <Stat label={t("history.reviewPanel.questionGoal")} value={weeklyGoal.weekly_question_target || 0} />
            <Stat label={t("history.reviewPanel.reviewGoal")} value={weeklyGoal.weekly_review_target || 0} />
            <Stat label={t("history.reviewPanel.newSuggested")} value={weeklyGoal.weekly_new_question_target ?? weeklyGoal.new_question_budget} />
            <Stat
              label={t("history.reviewPanel.completion")}
              value={weeklyGoal.completion_ratio_percent === undefined ? "-" : `${weeklyGoal.completion_ratio_percent}%`}
            />
          </StatList>
          <div className="flex items-start gap-2.5 text-sm">
            {weeklyGoal.on_track === false ? (
              <AlertIcon size={16} className="mt-0.5 shrink-0 text-warning" />
            ) : (
              <CircleCheckIcon size={16} className="mt-0.5 shrink-0 text-success" />
            )}
            <div>
              <p className="font-medium text-fg">{weeklyGoal.on_track === false ? t("history.labels.belowGoal") : t("history.labels.onTrack")}</p>
              <p className="text-fg-muted">
                {t("history.labels.nextStepDaily", {
                  newCount: weeklyGoal.suggested_daily_question_target || 0,
                  reviewCount: weeklyGoal.suggested_daily_review_target || weeklyGoal.daily_review_target || 0
                })}
              </p>
            </div>
          </div>
        </Section>

        <Section title={t("history.reviewPanel.forecastTitle")} description={t("history.reviewPanel.forecastSubtitle")}>
          <StatList>
            <Stat label={t("history.reviewPanel.dueInSevenDays")} value={reviewForecast?.projected_due_next_7_days || 0} />
            <Stat label={t("history.reviewPanel.enteringRisk")} value={reviewForecast?.projected_at_risk_next_7_days || 0} />
            <Stat label={t("history.reviewPanel.peakDay")} value={reviewForecast?.peak_load_day || 0} />
            <Stat label={t("history.reviewPanel.pressure")} value={String(reviewForecast?.pressure || t("history.labels.pressureDefault"))} />
          </StatList>
          {reviewQueue.upcoming_load.length ? (
            <ul className="divide-y divide-line text-sm">
              {reviewQueue.upcoming_load.map((day) => (
                <li key={day.date} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                  <span className="font-medium text-fg">{day.label}</span>
                  <span className="nums text-fg-muted">{t("history.labels.forecastDay", { due: day.due_count, risk: day.at_risk_count })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" description={t("history.labels.noUpcoming")} />
          )}
        </Section>
      </div>

      <Section
        title={t("history.reviewPanel.queueTitle")}
        description={t("history.reviewPanel.queueSubtitle")}
        actions={
          <Button size="sm" busy={isStartingReview} disabled={!reviewQueue.items.length} onClick={startRecommendedReview}>
            {t("common.actions.reviewNow")}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-end">
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
          <fieldset className="flex flex-wrap gap-x-5">
            <legend className="sr-only">{t("review.filters.refine")}</legend>
            <Checkbox
              id="history-review-bookmarks"
              checked={reviewBookmarksOnly}
              onChange={(event) => setReviewBookmarksOnly(event.target.checked)}
              label={t("review.filters.bookmarksOnly")}
            />
            <Checkbox
              id="history-review-notes"
              checked={reviewNotesOnly}
              onChange={(event) => setReviewNotesOnly(event.target.checked)}
              label={t("review.filters.notesOnly")}
            />
          </fieldset>
        </div>

        {reviewQueue.items.length ? (
          <ReviewQueueList items={reviewQueue.items} t={t} limit={8} busy={reviewQueueQuery.isFetching} />
        ) : (
          <EmptyState description={t("review.empty")} />
        )}
      </Section>
    </div>
  );

  const weeksTab = (
    <Section title={t("history.weeksPanel.title")} description={t("history.weeksPanel.subtitle")}>
      {weeklyAnalytics.weeks.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {weeklyAnalytics.weeks.map((week) => (
            <li key={week.week_start} className="grid gap-x-6 gap-y-2 py-3.5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
              <div className="min-w-0">
                <p className="font-medium text-fg">{week.label}</p>
                <p className="text-[0.8125rem] text-fg-muted">
                  {t("history.labels.weekMeta", {
                    study: week.study_questions,
                    review: week.review_questions,
                    sessions: week.completed_sessions
                  })}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="nums text-[0.8125rem] text-fg-muted">{t("history.labels.weekAccuracy", { value: week.accuracy_percent })}</span>
                <Meter value={week.accuracy_percent} kind="score" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState description={t("history.labels.noWeeks")} />
      )}
    </Section>
  );

  return (
    <Page>
      <PageHeader
        title={t("history.header.title")}
        description={t("history.header.subtitle")}
        actions={
          <Link href="/start" className={buttonClassName("secondary")}>
            {t("common.actions.newSession")}
          </Link>
        }
      />

      {loadError ? (
        <Alert
          tone="warning"
          role="alert"
          title={t("common.errors.partialLoad")}
          message={loadError}
          action={
            <Button variant="secondary" size="sm" onClick={retryFailed}>
              {t("common.actions.retry")}
            </Button>
          }
        />
      ) : null}
      {pageNotice ? <Alert tone="warning" role="alert" title={t("common.errors.attention")} message={pageNotice} /> : null}

      <section aria-label={t("history.filters.title")} className="grid gap-3 sm:grid-cols-3">
        <Field label={t("history.filters.exam")} htmlFor="history-exam-filter">
          <Select id="history-exam-filter" value={selectedExamId} onChange={(event) => setSelectedExamId(event.target.value)}>
            <option value="">{t("common.filters.all")}</option>
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("history.filters.minimumScore")} htmlFor="history-score-filter">
          <Select id="history-score-filter" value={minimumScore} onChange={(event) => setMinimumScore(event.target.value)}>
            <option value="0">{t("common.filters.all")}</option>
            <option value="70">70%+</option>
            <option value="80">80%+</option>
            <option value="90">90%+</option>
          </Select>
        </Field>
        <Field label={t("history.filters.search")} htmlFor="history-search-filter">
          <Input id="history-search-filter" type="search" value={searchValue} onChange={(event) => setSearchValue(event.target.value)} />
        </Field>
      </section>

      <Tabs
        ariaLabel={t("history.header.title")}
        defaultValue="sessions"
        items={[
          {
            id: "sessions",
            label: t("history.tabs.sessions"),
            badge: filteredExamHistory.length + filteredStudyHistory.length,
            content: sessionTab
          },
          {
            id: "review",
            label: t("history.tabs.review"),
            badge: reviewQueue.due_count,
            content: reviewTab
          },
          {
            id: "weeks",
            label: t("history.tabs.weeks"),
            badge: weeklyAnalytics.weeks.length,
            content: weeksTab
          }
        ]}
      />
    </Page>
  );
}

function SessionRow({ href, title, meta, detail, score }: { href: string; title: string; meta: string; detail?: string; score: number }) {
  return (
    <li>
      <Link
        href={href}
        className="focus-ring group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-sm py-3.5"
      >
        <span className="truncate font-medium text-fg group-hover:text-primary">{title}</span>
        <span className="nums text-sm font-semibold text-fg">{formatScore(score)}</span>
        <span className="min-w-0 text-[0.8125rem] text-fg-muted">
          {meta}
          {detail ? <span className="block truncate text-fg-subtle">{detail}</span> : null}
        </span>
        <Meter value={score} kind="score" className="w-20 self-start sm:w-24" />
      </Link>
    </li>
  );
}
