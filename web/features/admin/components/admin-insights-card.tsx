"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MetricCard } from "@/components/ui/metric-card";
import { useI18n } from "@/lib/i18n";
import type { AdminQuestionAnalytics } from "@/types/api";

interface AdminInsightsCardProps {
  analytics: AdminQuestionAnalytics | undefined;
  canCapture: boolean;
  isCapturing: boolean;
  onCaptureSnapshot: () => void;
}

export function AdminInsightsCard({ analytics, canCapture, isCapturing, onCaptureSnapshot }: AdminInsightsCardProps) {
  const { t } = useI18n();
  const summary = analytics?.summary;
  const hardest = analytics?.hardest_questions ?? [];
  const weakestDomains = analytics?.weakest_domains ?? [];
  const weakestExams = analytics?.weakest_exams ?? [];

  return (
    <Card
      title={t("admin.insights.title")}
      subtitle={t("admin.insights.subtitle")}
      actions={
        <Button variant="secondary" size="sm" disabled={!canCapture} busy={isCapturing} onClick={onCaptureSnapshot}>
          {t("admin.insights.captureSnapshot")}
        </Button>
      }
    >
      <div className="sq-metric-grid" role="group" aria-label={t("admin.insights.summaryAriaLabel")}>
        <MetricCard label={t("admin.insights.questionsWithSignal")} value={summary?.questions_with_signals ?? "-"} />
        <MetricCard label={t("admin.insights.totalAttempts")} value={summary?.total_attempts ?? "-"} />
        <MetricCard
          label={t("admin.insights.averageError")}
          value={summary ? `${summary.average_wrong_rate_percent}%` : "-"}
        />
        <MetricCard label={t("admin.insights.reviewPressure")} value={summary?.total_review_pressure ?? "-"} />
        <MetricCard label={t("admin.insights.snapshots")} value={summary?.snapshot_batch_count ?? "-"} />
        <MetricCard label={t("admin.insights.latestSnapshot")} value={summary?.latest_snapshot_at || "-"} />
      </div>

      <div className="sq-grid-2" style={{ marginTop: "var(--sq-space-5)" }}>
        <div className="sq-surface-block">
          <h3 className="sq-list-title">{t("admin.insights.hardestQuestions")}</h3>
          {hardest.length ? (
            <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
              {hardest.map((item) => (
                <div key={item.id} className="sq-list-item">
                  <div className="sq-list-title">{item.id}</div>
                  <div className="sq-list-meta">
                    {t("admin.insights.hardestMeta", {
                      exam: item.exam_title || item.exam_id,
                      domain: item.domain || t("admin.insights.noDomain"),
                      rate: item.wrong_rate_percent,
                      score: item.difficulty_score
                    })}
                  </div>
                  <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                    {item.prompt}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
              {t("admin.insights.noSignal")}
            </div>
          )}
        </div>

        <div className="sq-page-stack">
          <div className="sq-surface-block">
            <h3 className="sq-list-title">{t("admin.insights.weakestDomains")}</h3>
            {weakestDomains.length ? (
              <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                {weakestDomains.map((item) => (
                  <div key={item.domain} className="sq-list-item">
                    <div className="sq-list-title">{item.domain}</div>
                    <div className="sq-list-meta">
                      {t("admin.insights.domainMeta", {
                        rate: item.wrong_rate_percent,
                        attempts: item.attempts_total,
                        pressure: item.review_pressure_count
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
                {t("admin.insights.noRelevantDomains")}
              </div>
            )}
          </div>

          <div className="sq-surface-block">
            <h3 className="sq-list-title">{t("admin.insights.weakestExams")}</h3>
            {weakestExams.length ? (
              <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                {weakestExams.map((item) => (
                  <div key={item.exam_id} className="sq-list-item">
                    <div className="sq-list-title">{item.exam_title}</div>
                    <div className="sq-list-meta">
                      {t("admin.insights.examMeta", {
                        id: item.exam_id,
                        rate: item.wrong_rate_percent,
                        count: item.tracked_questions
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
                {t("admin.insights.noExamFriction")}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
