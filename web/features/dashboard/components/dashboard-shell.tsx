"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import {
  useActiveExamSessionsQuery,
  useActiveStudySessionsQuery,
  useEngagementQuery,
  useExamHistoryQuery,
  useReadinessQuery,
  useStudyOverviewQuery,
  useStudyPlanQuery,
  useWeakAreasQuery
} from "@/lib/query/hooks";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type { EngagementSnapshot, StudyOverview } from "@/types/api";

const DEFAULT_STUDY_OVERVIEW: StudyOverview = {
  scope: "device",
  bookmark_count: 0,
  note_count: 0,
  due_review_count: 0,
  next_due_at: null,
  recent_bookmarks: [],
  recent_notes: [],
  due_reviews: []
};

function createDefaultEngagement(recommendedNextAction: string): EngagementSnapshot {
  return {
    daily_goal: { target: 10, completed: 0, remaining: 10, progress_percent: 0, reached: false },
    daily_review_goal: { target: 5, completed: 0, remaining: 5, progress_percent: 0, reached: false },
    weekly_goal: { target: 50, completed: 0, remaining: 50, progress_percent: 0, reached: false },
    weekly_review_goal: { target: 30, completed: 0, remaining: 30, progress_percent: 0, reached: false },
    streak: { current_days: 0, best_days: 0, total_active_days: 0, goal_completed_today: false },
    adaptive_profile: { recovery_mode: false, low_confidence_bias: 0, variety_floor_percent: 0, focus_domains: [] },
    review_backlog_due: 0,
    recommended_next_action: recommendedNextAction
  };
}

function formatSecondsMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${Math.round(value)}s`;
}

export function DashboardShell() {
  const { t } = useI18n();
  const weakAreasQuery = useWeakAreasQuery();
  const engagementQuery = useEngagementQuery();
  const readinessQuery = useReadinessQuery();
  const overviewQuery = useStudyOverviewQuery();
  const historyQuery = useExamHistoryQuery(6);
  const activeExamQuery = useActiveExamSessionsQuery(3);
  const activeStudyQuery = useActiveStudySessionsQuery(3);
  const studyPlanQuery = useStudyPlanQuery();

  const sections = [
    { query: weakAreasQuery, label: t("dashboard.failedAreas.weakAreas") },
    { query: engagementQuery, label: t("dashboard.failedAreas.pace") },
    { query: readinessQuery, label: t("dashboard.failedAreas.readiness") },
    { query: overviewQuery, label: t("dashboard.failedAreas.review") },
    { query: historyQuery, label: t("dashboard.failedAreas.history") },
    { query: activeExamQuery, label: t("dashboard.failedAreas.examSessions") },
    { query: activeStudyQuery, label: t("dashboard.failedAreas.studySessions") },
    { query: studyPlanQuery, label: t("dashboard.failedAreas.studyPlan") }
  ];
  const isLoading = sections.some((section) => section.query.isPending && section.query.isFetching);
  const isRefreshing = sections.some((section) => section.query.isFetching);
  const failedSections = sections.filter((section) => section.query.isError);

  function retryFailed() {
    failedSections.forEach((section) => {
      void section.query.refetch();
    });
  }

  const weakAreas = useMemo(() => weakAreasQuery.data?.certifications ?? [], [weakAreasQuery.data]);
  const engagement = engagementQuery.data ?? createDefaultEngagement(t("dashboard.defaults.recommendedNextAction"));
  const readiness = readinessQuery.data ?? null;
  const studyOverview = overviewQuery.data ?? DEFAULT_STUDY_OVERVIEW;
  const latestExam = historyQuery.data?.[0] ?? null;
  const studyPlan = studyPlanQuery.data ?? null;

  const activeSessions = useMemo(() => {
    const examItems = (activeExamQuery.data ?? []).map((session) => ({
      ...session,
      kind: "exam" as const,
      href: `/exam/${session.id}`
    }));
    const studyItems = (activeStudyQuery.data ?? []).map((session) => ({
      ...session,
      kind: "study" as const,
      href: `/study/${session.id}`
    }));
    return [...examItems, ...studyItems].slice(0, 3);
  }, [activeExamQuery.data, activeStudyQuery.data]);

  const weakFocus = useMemo(() => {
    return weakAreas
      .map((track) => {
        const focusLabel = track.focus_domain?.label || track.domains[0]?.label || track.certification;
        return {
          id: `${track.certification}-${focusLabel}`,
          title: focusLabel,
          meta: track.message
        };
      })
      .slice(0, 3);
  }, [weakAreas]);

  if (isLoading) {
    return (
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack" role="status">
          <span className="sq-visually-hidden">{t("system.loading")}</span>
          <Skeleton height={180} />
          <div className="sq-grid-3">
            <Skeleton height={240} />
            <Skeleton height={240} />
            <Skeleton height={240} />
          </div>
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
              <h1 className="sq-page-title">{t("dashboard.header.title")}</h1>
              <p className="sq-page-subtitle">{t("dashboard.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/start">{t("common.labels.start")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
            <Link href="/settings">{t("common.labels.settings")}</Link>
          </div>
        </header>

        {failedSections.length ? (
          <StatusBanner
            tone="warning"
            role="alert"
            title={t("common.errors.partialLoad")}
            message={t("dashboard.loadError", { items: failedSections.map((section) => section.label).join(", ") })}
            action={
              <Button variant="ghost" size="sm" busy={isRefreshing} onClick={retryFailed}>
                {t("common.actions.retry")}
              </Button>
            }
          />
        ) : null}

        {studyPlan?.primary_task ? (
          <div className="sq-grid-2">
            <Card
              title={t("dashboard.planCard.title")}
              subtitle={t("dashboard.planCard.subtitle")}
              actions={
                <Link href={studyPlan.primary_task.cta_href} className="sq-button sq-button--sm sq-button--primary">
                  {studyPlan.primary_task.cta_label}
                </Link>
              }
            >
              <div className="sq-stack-md">
                {studyPlan.placement_required ? (
                  <div className="sq-chip-row">
                    <span className="sq-chip">{t("dashboard.planCard.placementPending")}</span>
                  </div>
                ) : null}
                <div className="sq-list-item">
                  <div className="sq-list-title">{studyPlan.primary_task.title}</div>
                  <div className="sq-list-meta">{studyPlan.primary_task.description}</div>
                </div>
                {studyPlan.secondary_tasks.length ? (
                  <div className="sq-list">
                    {studyPlan.secondary_tasks.map((task) => (
                      <div key={`${task.kind}-${task.cta_href}`} className="sq-list-item">
                        <div className="sq-list-title">{task.title}</div>
                        <div className="sq-list-meta">{task.description}</div>
                        <Link href={task.cta_href} className="sq-text-link">
                          {task.cta_label}
                        </Link>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>

            <Card title={t("dashboard.weekCard.title")} subtitle={t("dashboard.weekCard.subtitle")}>
              <div className="sq-metric-grid">
                <MetricCard label={t("dashboard.weekCard.reviewBacklog")} value={studyPlan.review_backlog_due} />
                <MetricCard
                  label={t("dashboard.weekCard.weeklyProgress")}
                  value={`${engagement.weekly_goal.completed}/${engagement.weekly_goal.target}`}
                />
                <MetricCard
                  label={t("dashboard.weekCard.reviewGoal")}
                  value={`${engagement.weekly_review_goal.completed}/${engagement.weekly_review_goal.target}`}
                />
              </div>
              {studyPlan.risk_domains.length ? (
                <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-4)" }}>
                  {studyPlan.risk_domains.map((domain) => (
                    <span key={domain} className="sq-chip">
                      {domain}
                    </span>
                  ))}
                </div>
              ) : null}
            </Card>
          </div>
        ) : null}

        <div className="sq-grid-3">
          <Card
            title={t("dashboard.todayCard.title")}
            subtitle={t("dashboard.todayCard.subtitle")}
            actions={
              <Link href="/review" className="sq-button sq-button--sm sq-button--primary">
                {t("common.actions.reviewNow")}
              </Link>
            }
          >
            <div className="sq-stack-md">
              <div className="sq-metric-grid">
                <MetricCard label={t("dashboard.todayCard.dueReviews")} value={studyOverview.due_review_count} />
                <MetricCard
                  label={t("dashboard.todayCard.dailyProgress")}
                  value={`${engagement.daily_goal.completed}/${engagement.daily_goal.target}`}
                />
                <MetricCard
                  label={t("dashboard.todayCard.latestScore")}
                  value={latestExam ? formatScore(latestExam.score_percent) : "-"}
                />
                <MetricCard
                  label={t("dashboard.todayCard.readiness")}
                  value={readiness ? formatScore(readiness.score_percent) : "-"}
                />
              </div>

              <div className="sq-list-item">
                <div className="sq-list-title">{t("dashboard.todayCard.nextStep")}</div>
                <div className="sq-list-meta">
                  {engagement.recommended_next_action}
                  {readiness
                    ? ` · ${t("dashboard.todayCard.projection", { value: formatScore(readiness.projected_score_percent) })}`
                    : ""}
                </div>
              </div>
            </div>
          </Card>

          <Card
            title={t("dashboard.continueCard.title")}
            subtitle={t("dashboard.continueCard.subtitle")}
            actions={
              <Link href="/start" className="sq-text-link">
                {t("common.actions.newSession")}
              </Link>
            }
          >
            {activeSessions.length ? (
              <div className="sq-list">
                {activeSessions.map((session) => (
                  <div key={session.id} className="sq-list-item">
                    <div className="sq-list-title">
                      {session.exam_title ||
                        (session.kind === "exam" ? t("dashboard.modes.examMixed") : t("dashboard.modes.studyMixed"))}
                    </div>
                    <div className="sq-list-meta">
                      {session.kind === "exam" ? t("common.labels.exam") : t("common.labels.study")} ·{" "}
                      {session.answered_count}/{session.total_questions} · {session.progress_percent}%
                    </div>
                    <Link href={session.href} className="sq-text-link">
                      {t("common.actions.resume")}
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState description={t("dashboard.continueCard.empty")} />
            )}
          </Card>

          <Card
            title={t("dashboard.weakAreasCard.title")}
            subtitle={t("dashboard.weakAreasCard.subtitle")}
            actions={
              <Link href="/history" className="sq-text-link">
                {t("common.actions.seeDetails")}
              </Link>
            }
          >
            {weakFocus.length ? (
              <div className="sq-list">
                {weakFocus.map((item) => (
                  <div key={item.id} className="sq-list-item">
                    <div className="sq-list-title">{item.title}</div>
                    <div className="sq-list-meta">{item.meta}</div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState description={t("dashboard.weakAreasCard.empty")} />
            )}
          </Card>
        </div>

        <Card
          title={t("dashboard.summaryCard.title")}
          subtitle={t("dashboard.summaryCard.subtitle")}
          actions={
            <Link href="/history" className="sq-button sq-button--sm sq-button--ghost">
              {t("common.actions.openHistory")}
            </Link>
          }
        >
          <div className="sq-metric-grid">
            <MetricCard label={t("dashboard.summaryCard.currentStreak")} value={engagement.streak.current_days} />
            <MetricCard label={t("dashboard.summaryCard.bestStreak")} value={engagement.streak.best_days} />
            <MetricCard
              label={t("dashboard.summaryCard.week")}
              value={`${engagement.weekly_goal.completed}/${engagement.weekly_goal.target}`}
            />
            <MetricCard
              label={t("dashboard.summaryCard.reviewGoal")}
              value={`${engagement.daily_review_goal.completed}/${engagement.daily_review_goal.target}`}
            />
            <MetricCard
              label={t("dashboard.summaryCard.nextReview")}
              value={studyOverview.next_due_at ? formatDateTime(studyOverview.next_due_at) : "-"}
            />
            <MetricCard
              label={t("dashboard.summaryCard.update")}
              value={isRefreshing ? t("common.status.updating") : t("common.status.upToDate")}
            />
          </div>
        </Card>

        {readiness?.domain_scores?.length ? (
          <Card
            title={t("dashboard.masteryCard.title")}
            subtitle={t("dashboard.masteryCard.subtitle")}
            actions={
              <Link href="/review" className="sq-text-link">
                {t("common.actions.reviewNow")}
              </Link>
            }
          >
            <div className="sq-page-stack">
              {[...readiness.domain_scores]
                .sort((left, right) => left.score_percent - right.score_percent || left.domain.localeCompare(right.domain))
                .slice(0, 5)
                .map((item) => (
                  <div key={item.domain} className="sq-surface-block">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "var(--sq-space-3)",
                        alignItems: "center"
                      }}
                    >
                      <div className="sq-list-title">{item.domain}</div>
                      <div className="sq-list-meta">{formatScore(item.score_percent)}</div>
                    </div>
                    <div
                      role="meter"
                      aria-label={item.domain}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(item.score_percent)}
                      style={{
                        marginTop: "var(--sq-space-3)",
                        height: 8,
                        borderRadius: 999,
                        background: "rgba(148, 163, 184, 0.18)",
                        overflow: "hidden"
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(4, Math.min(item.score_percent, 100))}%`,
                          height: "100%",
                          borderRadius: 999,
                          background:
                            item.score_percent >= 80
                              ? "linear-gradient(90deg, rgba(21,128,61,0.82), rgba(74,222,128,0.76))"
                              : item.score_percent >= 65
                                ? "linear-gradient(90deg, rgba(180,83,9,0.82), rgba(251,191,36,0.76))"
                                : "linear-gradient(90deg, rgba(185,28,28,0.82), rgba(248,113,113,0.76))"
                        }}
                      />
                    </div>
                    <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                      <span className="sq-chip">
                        {t("dashboard.masteryCard.accuracy", { value: formatScore(item.accuracy_percent) })}
                      </span>
                      <span className="sq-chip">{t("dashboard.masteryCard.attempts", { count: item.attempts })}</span>
                      <span className="sq-chip">
                        {t("dashboard.masteryCard.pace", { value: formatSecondsMetric(item.avg_elapsed_seconds) })}
                      </span>
                      <span className="sq-chip">
                        {t("dashboard.masteryCard.lowConfidence", { count: item.low_confidence_count })}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
