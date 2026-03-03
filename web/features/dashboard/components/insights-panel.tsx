"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatDateTime, formatScore } from "@/lib/utils/format";
import type { SessionHistoryItem, StudyHistoryItem, StudyOverview, WeakAreaTrack } from "@/types/api";

interface InsightsPanelProps {
  weakAreas: WeakAreaTrack[];
  studyOverview: StudyOverview;
  examHistory: SessionHistoryItem[];
  studyHistory: StudyHistoryItem[];
  refreshing: boolean;
  onRefresh: () => void;
}

function SessionSummary({
  history,
  t
}: {
  history: SessionHistoryItem[];
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!history.length) {
    return <div className="sq-empty">{t("insights.empty.exams")}</div>;
  }

  return (
    <div className="sq-list">
      {history.slice(0, 4).map((item) => (
        <div key={item.id} className="sq-list-item">
          <div className="sq-list-title">{item.exam_title || item.exam_id || t("insights.labels.mixedExam")}</div>
          <div className="sq-list-meta">
            {formatScore(item.score_percent)} · {item.correct_count}/{item.total_questions} {t("insights.labels.correctAnswers")} ·{" "}
            {formatDateTime(item.completed_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StudySummary({
  history,
  t
}: {
  history: StudyHistoryItem[];
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!history.length) {
    return <div className="sq-empty">{t("insights.empty.study")}</div>;
  }

  return (
    <div className="sq-list">
      {history.slice(0, 4).map((item) => (
        <div key={item.id} className="sq-list-item">
          <div className="sq-list-title">{item.exam_title || item.exam_id || t("insights.labels.mixedStudy")}</div>
          <div className="sq-list-meta">
            {formatScore(item.score_percent)} · {t("insights.labels.strategy")} {item.selection_strategy} ·{" "}
            {t("insights.labels.reviewedOn", { date: formatDate(item.completed_at) })}
          </div>
        </div>
      ))}
    </div>
  );
}

function WeakAreaSummary({
  tracks,
  t
}: {
  tracks: WeakAreaTrack[];
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (!tracks.length) {
    return <div className="sq-empty">{t("insights.empty.weakAreas")}</div>;
  }

  return (
    <div className="sq-progress-list">
      {tracks.map((track) => {
        const focus = track.focus_domain;
        const ratio = !track.attempted ? 0 : Math.min(100, Math.round((track.wrong / track.attempted) * 100));

        return (
          <div key={track.certification} className="sq-surface-block">
            <div className="sq-progress-head">
              <div>
                <div className="sq-list-title">{track.certification}</div>
                <div className="sq-progress-meta">{track.message}</div>
              </div>
              <div className="sq-progress-meta">{t("insights.labels.recentErrors", { ratio })}</div>
            </div>
            <div className="sq-progress-track" aria-hidden="true">
              <div className="sq-progress-fill" style={{ width: `${ratio}%` }} />
            </div>
            <div className="sq-chip-row">
              {focus ? (
                <span className="sq-chip">
                  {t("insights.labels.focus")}: {focus.label} ({focus.wrong}/{focus.total})
                </span>
              ) : null}
              {track.domains.slice(0, 2).map((domain) => (
                <span key={`${track.certification}-${domain.label}`} className="sq-chip">
                  {domain.label} ({domain.wrong}/{domain.total})
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function InsightsPanel({
  weakAreas,
  studyOverview,
  examHistory,
  studyHistory,
  refreshing,
  onRefresh
}: InsightsPanelProps) {
  const { t } = useI18n();

  return (
    <div className="sq-grid-2">
      <Card
        title={t("insights.titles.weakAreas")}
        subtitle={t("insights.titles.weakAreasSubtitle")}
        actions={
          <Button variant="ghost" size="sm" busy={refreshing} onClick={onRefresh}>
            {t("common.actions.refresh")}
          </Button>
        }
      >
        <WeakAreaSummary tracks={weakAreas} t={t} />
      </Card>

      <Card
        title={t("insights.titles.queueAndActivity")}
        subtitle={t("insights.titles.queueAndActivitySubtitle")}
      >
        <div className="sq-surface-block">
          <div className="sq-metric-grid">
            <div className="sq-metric-card">
              <span className="sq-muted">{t("insights.labels.dueReviews")}</span>
              <strong>{studyOverview.due_review_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">{t("insights.labels.recentExams")}</span>
              <strong>{examHistory.length}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">{t("insights.labels.studyBlocks")}</span>
              <strong>{studyHistory.length}</strong>
            </div>
          </div>

          <hr className="sq-divider" />

          <div className="sq-grid-2">
            <div className="sq-surface-block">
              <div className="sq-list-title">{t("insights.titles.latestExams")}</div>
              <SessionSummary history={examHistory} t={t} />
            </div>
            <div className="sq-surface-block">
              <div className="sq-list-title">{t("insights.titles.latestStudy")}</div>
              <StudySummary history={studyHistory} t={t} />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
