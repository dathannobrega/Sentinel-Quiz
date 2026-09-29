"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Stat, StatList } from "@/components/ui/stat";
import { useI18n } from "@/lib/i18n";
import type { AdminQuestionAnalytics } from "@/types/api";

interface AdminInsightsCardProps {
  analytics: AdminQuestionAnalytics | undefined;
  canCapture: boolean;
  isCapturing: boolean;
  onCaptureSnapshot: () => void;
}

function RankedList({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {children.length ? (
        <ol className="flex flex-col divide-y divide-line border-y border-line">{children}</ol>
      ) : (
        <EmptyState size="compact" description={empty} />
      )}
    </div>
  );
}

export function AdminInsightsCard({ analytics, canCapture, isCapturing, onCaptureSnapshot }: AdminInsightsCardProps) {
  const { t } = useI18n();
  const summary = analytics?.summary;
  const hardest = analytics?.hardest_questions ?? [];
  const weakestDomains = analytics?.weakest_domains ?? [];
  const weakestExams = analytics?.weakest_exams ?? [];

  return (
    <Section
      title={t("admin.insights.title")}
      description={t("admin.insights.subtitle")}
      actions={
        <Button variant="secondary" size="sm" disabled={!canCapture} busy={isCapturing} onClick={onCaptureSnapshot}>
          {t("admin.insights.captureSnapshot")}
        </Button>
      }
    >
      <div role="group" aria-label={t("admin.insights.summaryAriaLabel")}>
        <StatList>
          <Stat label={t("admin.insights.questionsWithSignal")} value={summary?.questions_with_signals ?? "-"} />
          <Stat label={t("admin.insights.totalAttempts")} value={summary?.total_attempts ?? "-"} />
          <Stat label={t("admin.insights.averageError")} value={summary ? `${summary.average_wrong_rate_percent}%` : "-"} />
          <Stat label={t("admin.insights.reviewPressure")} value={summary?.total_review_pressure ?? "-"} />
          <Stat label={t("admin.insights.snapshots")} value={summary?.snapshot_batch_count ?? "-"} />
          <Stat label={t("admin.insights.latestSnapshot")} value={<span className="text-sm">{summary?.latest_snapshot_at || "-"}</span>} />
        </StatList>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <RankedList title={t("admin.insights.hardestQuestions")} empty={t("admin.insights.noSignal")}>
          {hardest.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3">
              <span className="font-mono text-xs text-fg-muted">{item.id}</span>
              <span className="line-clamp-2 text-sm text-fg">{item.prompt}</span>
              <span className="text-xs text-fg-subtle">
                {t("admin.insights.hardestMeta", {
                  exam: item.exam_title || item.exam_id,
                  domain: item.domain || t("admin.insights.noDomain"),
                  rate: item.wrong_rate_percent,
                  score: item.difficulty_score
                })}
              </span>
            </li>
          ))}
        </RankedList>

        <RankedList title={t("admin.insights.weakestDomains")} empty={t("admin.insights.noRelevantDomains")}>
          {weakestDomains.map((item) => (
            <li key={item.domain} className="flex flex-col gap-1 py-3">
              <span className="text-sm font-medium text-fg">{item.domain}</span>
              <span className="text-xs text-fg-subtle">
                {t("admin.insights.domainMeta", {
                  rate: item.wrong_rate_percent,
                  attempts: item.attempts_total,
                  pressure: item.review_pressure_count
                })}
              </span>
            </li>
          ))}
        </RankedList>

        <RankedList title={t("admin.insights.weakestExams")} empty={t("admin.insights.noExamFriction")}>
          {weakestExams.map((item) => (
            <li key={item.exam_id} className="flex flex-col gap-1 py-3">
              <span className="text-sm font-medium text-fg">{item.exam_title}</span>
              <span className="text-xs text-fg-subtle">
                {t("admin.insights.examMeta", {
                  id: item.exam_id,
                  rate: item.wrong_rate_percent,
                  count: item.tracked_questions
                })}
              </span>
            </li>
          ))}
        </RankedList>
      </div>
    </Section>
  );
}
