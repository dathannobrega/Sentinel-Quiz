"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { Stat, StatList } from "@/components/ui/stat";
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

export function AdminMaintenanceCard({ overview, canAdmin, activeTask, notice, onRefresh, onIngest, onExport }: AdminMaintenanceCardProps) {
  const { t } = useI18n();

  return (
    <Section
      title={t("admin.access.title")}
      description={t("admin.access.subtitle")}
      actions={
        <>
          <Button variant="ghost" size="sm" busy={activeTask === "refresh"} onClick={onRefresh}>
            {t("admin.access.refresh")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canAdmin} busy={activeTask === "ingest"} onClick={onIngest}>
            {t("admin.access.reimportJson")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canAdmin} busy={activeTask === "export"} onClick={onExport}>
            {t("admin.access.exportDatabase")}
          </Button>
        </>
      }
    >
      {notice ? (
        <Alert
          tone={notice.tone}
          title={t("admin.notices.status")}
          message={notice.message}
          role={notice.tone === "danger" ? "alert" : "status"}
        />
      ) : null}

      <div role="group" aria-label={t("admin.access.summaryAriaLabel")}>
        <StatList>
          <Stat label={t("admin.access.exams")} value={overview?.exam_count ?? "-"} />
          <Stat label={t("admin.access.questions")} value={overview?.question_count ?? "-"} />
          <Stat label={t("admin.access.completedSessions")} value={overview?.completed_session_count ?? "-"} />
          <Stat label={t("admin.access.inactiveQuestions")} value={overview?.inactive_question_count ?? "-"} />
          <Stat label={t("admin.access.needsReviewQuestions")} value={overview?.needs_review_count ?? "-"} />
          <Stat label={t("admin.access.explanationMissingQuestions")} value={overview?.explanation_missing_count ?? "-"} />
        </StatList>
      </div>

      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium text-fg">{t("admin.access.quickSummaryTitle")}</p>
          <p className="mt-0.5 leading-relaxed text-fg-muted">{formatBreakdown(overview?.question_breakdown ?? {})}</p>
        </div>
        <div>
          <p className="font-medium text-fg">{t("admin.access.accessControlTitle")}</p>
          <p className="mt-0.5 leading-relaxed text-fg-muted">{t("admin.access.accessControlMessage")}</p>
        </div>
      </div>
    </Section>
  );
}
