"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import type { AdminOverview } from "@/types/api";

import type { AdminTask } from "@/features/admin/types";
import { formatBreakdown } from "@/features/admin/utils/question-draft";

interface AdminMaintenanceCardProps {
  overview: AdminOverview | undefined;
  canAdmin: boolean;
  activeTask: AdminTask | null;
  notice: { tone: "neutral" | "success" | "danger"; message: string } | null;
  onRefresh: () => void;
  onIngest: () => void;
  onExport: () => void;
}

export function AdminMaintenanceCard({
  overview,
  canAdmin,
  activeTask,
  notice,
  onRefresh,
  onIngest,
  onExport
}: AdminMaintenanceCardProps) {
  const { t } = useI18n();

  return (
    <Card
      title={t("admin.access.title")}
      subtitle={t("admin.access.subtitle")}
      actions={
        <div className="sq-actions">
          <Button variant="ghost" size="sm" busy={activeTask === "refresh"} onClick={onRefresh}>
            {t("admin.access.refresh")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canAdmin} busy={activeTask === "ingest"} onClick={onIngest}>
            {t("admin.access.reimportJson")}
          </Button>
          <Button variant="ghost" size="sm" disabled={!canAdmin} busy={activeTask === "export"} onClick={onExport}>
            {t("admin.access.exportDatabase")}
          </Button>
        </div>
      }
    >
      <div className="sq-surface-block">
        <div className="sq-form-grid">
          <div className="sq-surface-block">
            <div className="sq-list-title">{t("admin.access.accessControlTitle")}</div>
            <div className="sq-list-meta">{t("admin.access.accessControlMessage")}</div>
          </div>

          <div className="sq-surface-block">
            <div className="sq-list-title">{t("admin.access.quickSummaryTitle")}</div>
            <div className="sq-list-meta">{formatBreakdown(overview?.question_breakdown ?? {})}</div>
          </div>
        </div>

        {notice ? (
          <StatusBanner
            tone={notice.tone}
            title={t("admin.notices.status")}
            message={notice.message}
            role={notice.tone === "danger" ? "alert" : "status"}
          />
        ) : null}

        <div className="sq-metric-grid" role="group" aria-label={t("admin.access.summaryAriaLabel")}>
          <MetricCard label={t("admin.access.exams")} value={overview?.exam_count ?? "-"} />
          <MetricCard label={t("admin.access.questions")} value={overview?.question_count ?? "-"} />
          <MetricCard label={t("admin.access.completedSessions")} value={overview?.completed_session_count ?? "-"} />
          <MetricCard label={t("admin.access.inactiveQuestions")} value={overview?.inactive_question_count ?? "-"} />
          <MetricCard label={t("admin.access.needsReviewQuestions")} value={overview?.needs_review_count ?? "-"} />
          <MetricCard
            label={t("admin.access.explanationMissingQuestions")}
            value={overview?.explanation_missing_count ?? "-"}
          />
        </div>
      </div>
    </Card>
  );
}
