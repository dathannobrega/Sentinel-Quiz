"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { apiClient } from "@/lib/api/client";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  ActiveSessionItem,
  EngagementSnapshot,
  ReadinessScore,
  SessionHistoryItem,
  StudyOverview,
  WeakAreasResponse
} from "@/types/api";

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
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [weakAreas, setWeakAreas] = useState<WeakAreasResponse["certifications"]>([]);
  const [engagement, setEngagement] = useState<EngagementSnapshot>(() =>
    createDefaultEngagement(t("dashboard.defaults.recommendedNextAction"))
  );
  const [studyOverview, setStudyOverview] = useState<StudyOverview>(DEFAULT_STUDY_OVERVIEW);
  const [examHistory, setExamHistory] = useState<SessionHistoryItem[]>([]);
  const [activeExamSessions, setActiveExamSessions] = useState<ActiveSessionItem[]>([]);
  const [activeStudySessions, setActiveStudySessions] = useState<ActiveSessionItem[]>([]);
  const [readiness, setReadiness] = useState<ReadinessScore | null>(null);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    await refreshDashboard();
    setIsLoading(false);
  });

  async function refreshDashboard() {
    setIsRefreshing(true);
    setLoadError(null);

    const results = await Promise.allSettled([
      apiClient.get<WeakAreasResponse>("/analytics/weak-areas"),
      apiClient.get<EngagementSnapshot>("/analytics/engagement"),
      apiClient.get<ReadinessScore>("/analytics/readiness"),
      apiClient.get<StudyOverview>("/study/overview"),
      apiClient.get<SessionHistoryItem[]>("/sessions/history?limit=6"),
      apiClient.get<ActiveSessionItem[]>("/sessions/active?limit=3"),
      apiClient.get<ActiveSessionItem[]>("/study/sessions/active?limit=3")
    ]);

    const failedLabels: string[] = [];

    if (results[0].status === "fulfilled") {
      setWeakAreas(results[0].value.certifications);
    } else {
      setWeakAreas([]);
      failedLabels.push(t("dashboard.failedAreas.weakAreas"));
    }

    if (results[1].status === "fulfilled") {
      setEngagement(results[1].value);
    } else {
      setEngagement(createDefaultEngagement(t("dashboard.defaults.recommendedNextAction")));
      failedLabels.push(t("dashboard.failedAreas.pace"));
    }

    if (results[2].status === "fulfilled") {
      setReadiness(results[2].value);
    } else {
      setReadiness(null);
      failedLabels.push("readiness");
    }

    if (results[3].status === "fulfilled") {
      setStudyOverview(results[3].value);
    } else {
      setStudyOverview(DEFAULT_STUDY_OVERVIEW);
      failedLabels.push(t("dashboard.failedAreas.review"));
    }

    if (results[4].status === "fulfilled") {
      setExamHistory(results[4].value);
    } else {
      setExamHistory([]);
      failedLabels.push(t("dashboard.failedAreas.history"));
    }

    if (results[5].status === "fulfilled") {
      setActiveExamSessions(results[5].value);
    } else {
      setActiveExamSessions([]);
      failedLabels.push(t("dashboard.failedAreas.examSessions"));
    }

    if (results[6].status === "fulfilled") {
      setActiveStudySessions(results[6].value);
    } else {
      setActiveStudySessions([]);
      failedLabels.push(t("dashboard.failedAreas.studySessions"));
    }

    if (failedLabels.length) {
      setLoadError(t("dashboard.loadError", { items: failedLabels.join(", ") }));
    }

    setIsRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const latestExam = examHistory[0] || null;
  const activeSessions = useMemo(() => {
    const examItems = activeExamSessions.map((session) => ({ ...session, modeLabel: t("common.labels.exam"), href: `/exam/${session.id}` }));
    const studyItems = activeStudySessions.map((session) => ({
      ...session,
      modeLabel: t("common.labels.study"),
      href: `/study/${session.id}`
    }));
    return [...examItems, ...studyItems].slice(0, 3);
  }, [activeExamSessions, activeStudySessions, t]);

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
      <main className="sq-app-shell">
        <div className="sq-page-stack">
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
              <div className="sq-page-title">{t("dashboard.header.title")}</div>
              <p className="sq-page-subtitle">{t("dashboard.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/start">{t("common.labels.start")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
            <Link href="/settings">{t("common.labels.settings")}</Link>
          </div>
        </header>

        {loadError ? <StatusBanner tone="warning" title={t("common.errors.partialLoad")} message={loadError} /> : null}

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
                <MetricCard label={t("dashboard.todayCard.latestScore")} value={latestExam ? formatScore(latestExam.score_percent) : "-"} />
                <MetricCard label="Readiness" value={readiness ? formatScore(readiness.score_percent) : "-"} />
              </div>

              <div className="sq-list-item">
                <div className="sq-list-title">{t("dashboard.todayCard.nextStep")}</div>
                <div className="sq-list-meta">
                  {engagement.recommended_next_action}
                  {readiness ? ` · projeção ${formatScore(readiness.projected_score_percent)}` : ""}
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
                        (session.modeLabel === t("common.labels.exam")
                          ? t("dashboard.modes.examMixed")
                          : t("dashboard.modes.studyMixed"))}
                    </div>
                    <div className="sq-list-meta">
                      {session.modeLabel} · {session.answered_count}/{session.total_questions} · {session.progress_percent}%
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
            title="Mastery por domínio"
            subtitle="O readiness agora explicita lacunas por domínio, com acerto, confiança e ritmo."
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
                      <span className="sq-chip">acerto {formatScore(item.accuracy_percent)}</span>
                      <span className="sq-chip">{item.attempts} tentativa(s)</span>
                      <span className="sq-chip">ritmo {formatSecondsMetric(item.avg_elapsed_seconds)}</span>
                      <span className="sq-chip">baixa confiança {item.low_confidence_count}</span>
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
