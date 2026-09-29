"use client";

import { startTransition, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { MetricCard } from "@/components/ui/metric-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { Tabs } from "@/components/ui/tabs";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useI18n } from "@/lib/i18n";
import {
  useExamHistoryQuery,
  useExamsQuery,
  useReviewQueueQuery,
  useSessionRole,
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
  const { isStaff } = useSessionRole();
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
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={320} />
          <Skeleton height={420} />
        </div>
      </main>
    );
  }

  const sessionTab = (
    <div className="sq-page-stack">
      <Card title={t("history.sessions.title")} subtitle={t("history.sessions.subtitle")}>
        <div className="sq-metric-grid">
          <MetricCard label={t("history.sessions.filteredExams")} value={filteredExamHistory.length} />
          <MetricCard label={t("history.sessions.examAverage")} value={examAverage === null ? "-" : formatScore(examAverage)} />
          <MetricCard label={t("history.sessions.studyAverage")} value={studyAverage === null ? "-" : formatScore(studyAverage)} />
          <MetricCard label={t("history.sessions.dueQueue")} value={reviewQueue.due_count} />
          <MetricCard label={t("history.sessions.totalQueue")} value={reviewQueue.total_count} />
          <MetricCard
            label={t("history.sessions.nextReview")}
            value={reviewQueue.next_due_at ? formatDateTime(reviewQueue.next_due_at) : "-"}
          />
        </div>

        {recommendation ? (
          <EmptyState className="sq-gap-top-md" size="compact" description={recommendation} />
        ) : null}
      </Card>

      <div className="sq-grid-2">
        <Card title={t("history.sessions.examsTitle")} subtitle={t("history.sessions.examsSubtitle")}>
          {filteredExamHistory.length ? (
            <div className="sq-list">
              {filteredExamHistory.map((item) => (
                <Link
                  key={item.id}
                  href={resolveExamResultHref(item)}
                  className="sq-list-item sq-list-link"
                >
                  <div className="sq-list-title">{item.exam_title || item.exam_id || t("history.labels.mixedSession")}</div>
                  <div className="sq-list-meta">
                    {t("history.labels.examMeta", {
                      score: formatScore(item.score_percent),
                      correct: item.correct_count,
                      total: item.total_questions,
                      date: formatDateTime(item.completed_at)
                    })}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState description={t("history.labels.noExams")} />
          )}
        </Card>

        <Card title={t("history.sessions.studiesTitle")} subtitle={t("history.sessions.studiesSubtitle")}>
          {filteredStudyHistory.length ? (
            <div className="sq-list">
              {filteredStudyHistory.map((item) => (
                <Link
                  key={item.id}
                  href={resolveStudyResultHref(item)}
                  className="sq-list-item sq-list-link"
                >
                  <div className="sq-list-title">{item.exam_title || item.exam_id || t("history.labels.mixedBlock")}</div>
                  <div className="sq-list-meta">
                    {t("history.labels.studyMeta", {
                      score: formatScore(item.score_percent),
                      strategy: item.selection_strategy,
                      date: formatDateTime(item.completed_at)
                    })}
                  </div>
                  {item.weakest_domains.length ? (
                    <div className="sq-chip-row sq-gap-top-sm">
                      {item.weakest_domains.slice(0, 3).map((label) => (
                        <span key={`${item.id}-${label}`} className="sq-chip">
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState description={t("history.labels.noStudies")} />
          )}
        </Card>
      </div>
    </div>
  );

  const reviewTab = (
    <div className="sq-page-stack">
      <div className="sq-grid-2">
        <Card title={t("history.reviewPanel.weeklyGoalTitle")} subtitle={t("history.reviewPanel.weeklyGoalSubtitle")}>
          <div className="sq-metric-grid">
            <MetricCard label={t("history.reviewPanel.questionGoal")} value={weeklyGoal.weekly_question_target || 0} />
            <MetricCard label={t("history.reviewPanel.reviewGoal")} value={weeklyGoal.weekly_review_target || 0} />
            <MetricCard
              label={t("history.reviewPanel.newSuggested")}
              value={weeklyGoal.weekly_new_question_target ?? weeklyGoal.new_question_budget}
            />
            <MetricCard
              label={t("history.reviewPanel.completion")}
              value={
                weeklyGoal.completion_ratio_percent === undefined ? "-" : `${weeklyGoal.completion_ratio_percent}%`
              }
            />
          </div>

          <div className="sq-list sq-gap-top-md">
            <div className="sq-list-item">
              <div className="sq-list-title">
                {weeklyGoal.on_track === false ? t("history.labels.belowGoal") : t("history.labels.onTrack")}
              </div>
              <div className="sq-list-meta">
                {t("history.labels.nextStepDaily", {
                  newCount: weeklyGoal.suggested_daily_question_target || 0,
                  reviewCount: weeklyGoal.suggested_daily_review_target || weeklyGoal.daily_review_target || 0
                })}
              </div>
            </div>
          </div>
        </Card>

        <Card title={t("history.reviewPanel.forecastTitle")} subtitle={t("history.reviewPanel.forecastSubtitle")}>
          <div className="sq-metric-grid">
            <MetricCard label={t("history.reviewPanel.dueInSevenDays")} value={reviewForecast?.projected_due_next_7_days || 0} />
            <MetricCard label={t("history.reviewPanel.enteringRisk")} value={reviewForecast?.projected_at_risk_next_7_days || 0} />
            <MetricCard label={t("history.reviewPanel.peakDay")} value={reviewForecast?.peak_load_day || 0} />
            <MetricCard label={t("history.reviewPanel.pressure")} value={String(reviewForecast?.pressure || t("history.labels.pressureDefault"))} />
          </div>

          {reviewQueue.upcoming_load.length ? (
            <div className="sq-list sq-gap-top-md">
              {reviewQueue.upcoming_load.map((day) => (
                <div key={day.date} className="sq-list-item">
                  <div className="sq-list-title">{day.label}</div>
                  <div className="sq-list-meta">
                    {t("history.labels.forecastDay", { due: day.due_count, risk: day.at_risk_count })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState className="sq-gap-top-md" size="compact" description={t("history.labels.noUpcoming")} />
          )}
        </Card>
      </div>

      <Card
        title={t("history.reviewPanel.queueTitle")}
        subtitle={t("history.reviewPanel.queueSubtitle")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            busy={isStartingReview}
            disabled={!reviewQueue.items.length}
            onClick={startRecommendedReview}
          >
            {t("common.actions.reviewNow")}
          </Button>
        }
      >
        <div className="sq-form-grid sq-gap-bottom-md">
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

          <fieldset className="sq-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="sq-field-label">{t("review.filters.refine")}</legend>
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
          </fieldset>
        </div>

        {reviewQueue.items.length ? (
          <div className="sq-list">
            {reviewQueue.items.slice(0, 8).map((item) => (
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
          <EmptyState description={t("review.empty")} />
        )}
      </Card>
    </div>
  );

  const weeksTab = (
    <Card title={t("history.weeksPanel.title")} subtitle={t("history.weeksPanel.subtitle")}>
      {weeklyAnalytics.weeks.length ? (
        <div className="sq-progress-list">
          {weeklyAnalytics.weeks.map((week) => (
            <div key={week.week_start} className="sq-surface-block">
              <div className="sq-progress-head">
                <div>
                  <div className="sq-list-title">{week.label}</div>
                  <div className="sq-progress-meta">
                    {t("history.labels.weekMeta", {
                      study: week.study_questions,
                      review: week.review_questions,
                      sessions: week.completed_sessions
                    })}
                  </div>
                </div>
                <div className="sq-progress-meta">{t("history.labels.weekAccuracy", { value: week.accuracy_percent })}</div>
              </div>
              <ProgressBar value={week.accuracy_percent} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState description={t("history.labels.noWeeks")} />
      )}
    </Card>
  );

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <h1 className="sq-page-title">{t("history.header.title")}</h1>
              <p className="sq-page-subtitle">{t("history.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/start">{t("common.actions.newSession")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
            {isStaff ? <Link href="/admin">{t("common.labels.admin")}</Link> : null}
          </div>
        </header>

        {loadError ? (
          <StatusBanner
            tone="warning"
            role="alert"
            title={t("common.errors.partialLoad")}
            message={loadError}
            action={
              <Button variant="ghost" size="sm" onClick={retryFailed}>
                {t("common.actions.retry")}
              </Button>
            }
          />
        ) : null}
        {pageNotice ? (
          <StatusBanner tone="warning" role="alert" title={t("common.errors.attention")} message={pageNotice} />
        ) : null}

        <Card title={t("history.filters.title")} subtitle={t("history.filters.subtitle")}>
          <div className="sq-form-grid">
            <Field label={t("history.filters.exam")} htmlFor="history-exam-filter">
              <select
                id="history-exam-filter"
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

            <Field label={t("history.filters.minimumScore")} htmlFor="history-score-filter">
              <select
                id="history-score-filter"
                className="sq-select"
                value={minimumScore}
                onChange={(event) => setMinimumScore(event.target.value)}
              >
                <option value="0">{t("common.filters.all")}</option>
                <option value="70">70%+</option>
                <option value="80">80%+</option>
                <option value="90">90%+</option>
              </select>
            </Field>

            <Field label={t("history.filters.search")} htmlFor="history-search-filter">
              <input
                id="history-search-filter"
                className="sq-input"
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
            </Field>
          </div>
        </Card>

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
      </div>
    </main>
  );
}
