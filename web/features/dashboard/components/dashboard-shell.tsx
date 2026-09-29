"use client";

import { useMemo } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertIcon, ChevronRightIcon, RepeatIcon, SpinnerIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { Page, PageHeader, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { StudyTrackCard } from "@/features/dashboard/components/study-track-card";
import { useI18n } from "@/lib/i18n";
import { translateBackendMessage, translateReadinessBand } from "@/lib/i18n/backend-messages";
import {
  useActiveExamSessionsQuery,
  useActiveStudySessionsQuery,
  useEngagementQuery,
  useExamHistoryQuery,
  useReadinessQuery,
  useStudyModulesQuery,
  useStudyOverviewQuery,
  useStudyPlanQuery,
  useWeakAreasQuery
} from "@/lib/query/hooks";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type { EngagementSnapshot, StudyOverview, StudyPlanTask } from "@/types/api";

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

type TaskField = "title" | "description" | "cta";

export function DashboardShell() {
  const { t } = useI18n();

  /** Study plan texts come as code + params (M-C7); the backend text is the fallback. */
  function taskText(task: StudyPlanTask, field: TaskField): string {
    const fallback = field === "cta" ? task.cta_label : task[field];
    return translateBackendMessage(t, task.code, task.params, fallback, field);
  }

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
  const recommendedModule = studyPlan?.recommended_module ?? null;
  const trackCertification = recommendedModule?.certification ?? studyPlan?.certification ?? null;
  const modulesQuery = useStudyModulesQuery(trackCertification);
  const trackModules = modulesQuery.data?.modules ?? [];
  const readinessValue = readiness
    ? readiness.score_percent === null
      ? translateReadinessBand(t, readiness.band)
      : formatScore(readiness.score_percent)
    : "-";

  const activeSessions = useMemo(() => {
    const examItems = (activeExamQuery.data ?? []).map((session) => ({
      ...session,
      kind: "exam" as const,
      href: `/exam/${encodeURIComponent(session.id)}`
    }));
    const studyItems = (activeStudyQuery.data ?? []).map((session) => ({
      ...session,
      kind: "study" as const,
      href: `/study/${encodeURIComponent(session.id)}`
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
      <Page aria-busy="true">
        <span className="sr-only" role="status">
          {t("system.loading")}
        </span>
        <Skeleton height={56} className="max-w-sm" />
        <Skeleton height={200} />
        <Skeleton height={96} />
      </Page>
    );
  }

  const [continueSession, ...otherSessions] = activeSessions;
  const primaryTask = studyPlan?.primary_task ?? null;
  const masteryRows = readiness?.domain_scores?.length
    ? [...readiness.domain_scores]
        .sort((left, right) => left.score_percent - right.score_percent || left.domain.localeCompare(right.domain))
        .slice(0, 5)
    : [];
  const sessionTitle = (session: (typeof activeSessions)[number]) =>
    session.exam_title || (session.kind === "exam" ? t("dashboard.modes.examMixed") : t("dashboard.modes.studyMixed"));

  return (
    <Page>
      <PageHeader
        title={t("dashboard.header.title")}
        description={t("dashboard.header.subtitle")}
        actions={
          <>
            {isRefreshing ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle" role="status">
                <SpinnerIcon size={12} />
                {t("common.status.updating")}
              </span>
            ) : null}
            <Link href="/start" className={buttonClassName("secondary")}>
              {t("common.actions.newSession")}
            </Link>
          </>
        }
      />

      {failedSections.length ? (
        <Alert
          tone="warning"
          role="alert"
          title={t("common.errors.partialLoad")}
          message={t("dashboard.loadError", { items: failedSections.map((section) => section.label).join(", ") })}
          action={
            <Button variant="secondary" size="sm" busy={isRefreshing} onClick={retryFailed}>
              {t("common.actions.retry")}
            </Button>
          }
        />
      ) : null}

      {/* Next action: resume what is open, otherwise the plan's primary task. */}
      <section aria-labelledby="dashboard-next" className="grid overflow-hidden rounded-lg border border-line bg-surface lg:grid-cols-2">
        <h2 id="dashboard-next" className="sr-only">
          {t("dashboard.todayCard.nextStep")}
        </h2>
        <div className="flex flex-col gap-4 p-5 sm:p-7">
          <p className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("dashboard.continueCard.title")}</p>
          {continueSession ? (
            <>
              <div>
                <p className="text-lg font-semibold text-fg">{sessionTitle(continueSession)}</p>
                <p className="nums mt-1 text-sm text-fg-muted">
                  {continueSession.kind === "exam" ? t("common.labels.exam") : t("common.labels.study")} · {continueSession.answered_count}/
                  {continueSession.total_questions}
                </p>
              </div>
              <Meter value={continueSession.progress_percent} label={sessionTitle(continueSession)} className="max-w-sm" />
              <div className="flex flex-wrap items-center gap-3">
                <Link href={continueSession.href} className={buttonClassName("primary", "lg")}>
                  {t("common.actions.resume")}
                  <ChevronRightIcon />
                </Link>
              </div>
              {otherSessions.length ? (
                <ul className="flex flex-col divide-y divide-line border-t border-line">
                  {otherSessions.map((session) => (
                    <li key={session.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate text-fg">
                        {sessionTitle(session)}
                        <span className="nums ml-2 text-fg-muted">
                          {session.answered_count}/{session.total_questions}
                        </span>
                      </span>
                      <Link href={session.href} className="focus-ring shrink-0 rounded-sm font-medium text-primary hover:underline">
                        {t("common.actions.resume")}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <>
              <p className="text-sm text-fg-muted">{t("dashboard.continueCard.empty")}</p>
              {!primaryTask ? (
                <div>
                  <Link href="/start" className={buttonClassName("primary", "lg")}>
                    {t("common.actions.goToStart")}
                    <ChevronRightIcon />
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-4 border-t border-line p-5 sm:p-7 lg:border-t-0 lg:border-l">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("dashboard.planCard.title")}</p>
            {studyPlan?.placement_required ? <Badge tone="warning">{t("dashboard.planCard.placementPending")}</Badge> : null}
          </div>
          {primaryTask ? (
            <>
              <div>
                <p className="text-lg font-semibold text-fg">{taskText(primaryTask, "title")}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">{taskText(primaryTask, "description")}</p>
              </div>
              {recommendedModule ? (
                <p className="text-sm text-fg" data-testid="plan-next-module">
                  {t("dashboard.planCard.nextModule", { code: recommendedModule.code, title: recommendedModule.title })}
                  {recommendedModule.domain ? (
                    <span className="block text-[0.8125rem] text-fg-muted">
                      {t("dashboard.planCard.nextModuleHint", { domain: recommendedModule.domain })}
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div>
                <Link href={primaryTask.cta_href} className={buttonClassName(continueSession ? "secondary" : "primary", continueSession ? "md" : "lg")}>
                  {taskText(primaryTask, "cta")}
                </Link>
              </div>
              {studyPlan && studyPlan.secondary_tasks.length ? (
                <ul className="flex flex-col divide-y divide-line border-t border-line">
                  {studyPlan.secondary_tasks.map((task) => (
                    <li key={`${task.kind}-${task.cta_href}`} className="flex flex-col gap-0.5 py-3">
                      <span className="text-sm font-medium text-fg">{taskText(task, "title")}</span>
                      <span className="text-[0.8125rem] text-fg-muted">{taskText(task, "description")}</span>
                      <Link href={task.cta_href} className="focus-ring mt-1 self-start rounded-sm text-[0.8125rem] font-medium text-primary hover:underline">
                        {taskText(task, "cta")}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-sm leading-relaxed text-fg">{engagement.recommended_next_action}</p>
          )}
        </div>
      </section>

      <Section
        title={t("dashboard.todayCard.title")}
        description={t("dashboard.todayCard.subtitle")}
        actions={
          <Link href="/review" className={buttonClassName("secondary", "sm")}>
            <RepeatIcon />
            {t("common.actions.reviewNow")}
          </Link>
        }
      >
        <StatList>
          <Stat label={t("dashboard.todayCard.dueReviews")} value={studyOverview.due_review_count} />
          <Stat
            label={t("dashboard.todayCard.dailyProgress")}
            value={`${engagement.daily_goal.completed}/${engagement.daily_goal.target}`}
          />
          <Stat label={t("dashboard.todayCard.latestScore")} value={latestExam ? formatScore(latestExam.score_percent) : "–"} />
          <Stat
            label={t("dashboard.todayCard.readiness")}
            value={readinessValue}
            meta={
              readiness && readiness.projected_score_percent !== null
                ? t("dashboard.todayCard.projection", { value: formatScore(readiness.projected_score_percent) })
                : undefined
            }
          />
        </StatList>
        {primaryTask ? <p className="text-[0.8125rem] text-fg-muted">{engagement.recommended_next_action}</p> : null}
      </Section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title={t("dashboard.masteryCard.title")}
          description={t("dashboard.masteryCard.subtitle")}
          actions={
            masteryRows.length ? (
              <Link href="/review" className="focus-ring rounded-sm text-sm font-medium text-primary hover:underline">
                {t("common.actions.reviewNow")}
              </Link>
            ) : null
          }
        >
          {masteryRows.length ? (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {masteryRows.map((item) => (
                <li key={`${item.certification ?? ""}-${item.domain}`} className="flex flex-col gap-2 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-sm font-medium text-fg">
                      {item.domain}
                      {item.certification ? <span className="font-normal text-fg-muted"> · {item.certification}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm font-semibold text-fg">{formatScore(item.score_percent)}</span>
                  </div>
                  <Meter value={item.score_percent} label={item.domain} kind="score" />
                  <p className="text-xs text-fg-muted">
                    {[
                      t("dashboard.masteryCard.accuracy", { value: formatScore(item.accuracy_percent) }),
                      t("dashboard.masteryCard.attempts", { count: item.attempts }),
                      t("dashboard.masteryCard.pace", { value: formatSecondsMetric(item.avg_elapsed_seconds) }),
                      t("dashboard.masteryCard.lowConfidence", { count: item.low_confidence_count })
                    ].join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" description={t("dashboard.weakAreasCard.empty")} />
          )}
        </Section>

        <Section
          title={t("dashboard.weakAreasCard.title")}
          description={t("dashboard.weakAreasCard.subtitle")}
          actions={
            <Link href="/history" className="focus-ring rounded-sm text-sm font-medium text-primary hover:underline">
              {t("common.actions.seeDetails")}
            </Link>
          }
        >
          {weakFocus.length ? (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {weakFocus.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 py-3">
                  <span className="text-sm font-medium text-fg">{item.title}</span>
                  <span className="text-[0.8125rem] text-fg-muted">{item.meta}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState size="compact" description={t("dashboard.weakAreasCard.empty")} />
          )}
          {studyPlan?.risk_domains.length ? (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
              <AlertIcon size={12} className="text-warning" />
              {studyPlan.risk_domains.join(" · ")}
            </p>
          ) : null}
        </Section>
      </div>

      <Section
        title={t("dashboard.weekCard.title")}
        description={t("dashboard.summaryCard.subtitle")}
        actions={
          <Link href="/history" className="focus-ring rounded-sm text-sm font-medium text-primary hover:underline">
            {t("common.actions.openHistory")}
          </Link>
        }
      >
        <StatList>
          <Stat label={t("dashboard.weekCard.weeklyProgress")} value={`${engagement.weekly_goal.completed}/${engagement.weekly_goal.target}`} />
          <Stat
            label={t("dashboard.weekCard.reviewGoal")}
            value={`${engagement.weekly_review_goal.completed}/${engagement.weekly_review_goal.target}`}
            meta={t("dashboard.summaryCard.week")}
          />
          <Stat
            label={t("dashboard.summaryCard.reviewGoal")}
            value={`${engagement.daily_review_goal.completed}/${engagement.daily_review_goal.target}`}
            meta={t("dashboard.todayCard.title")}
          />
          <Stat label={t("dashboard.weekCard.reviewBacklog")} value={studyPlan?.review_backlog_due ?? engagement.review_backlog_due} />
          <Stat
            label={t("dashboard.summaryCard.currentStreak")}
            value={engagement.streak.current_days}
            meta={`${t("dashboard.summaryCard.bestStreak")}: ${engagement.streak.best_days}`}
          />
          <Stat
            label={t("dashboard.summaryCard.nextReview")}
            value={<span className="text-base">{studyOverview.next_due_at ? formatDateTime(studyOverview.next_due_at) : "–"}</span>}
          />
        </StatList>
      </Section>

      {trackCertification && trackModules.length ? (
        <StudyTrackCard certification={trackCertification} modules={trackModules} recommendedModule={recommendedModule} />
      ) : null}
    </Page>
  );
}
