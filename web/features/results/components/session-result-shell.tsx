"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { buildMaterialPreviewHref } from "@/lib/utils/materials";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  CitationItem,
  ExamResult,
  ReviewQuestion,
  SessionReview,
  StudyResult,
  StudyReviewQuestion,
  StudySessionReview
} from "@/types/api";

type ResultMode = "exam" | "study";

interface SessionResultShellProps {
  sessionId: string;
  mode: ResultMode;
}

function resolveResultBasePath(mode: ResultMode): string {
  return mode === "study" ? "/study/sessions" : "/sessions";
}

function readResultError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function renderInsightLines(
  result: ExamResult | StudyResult,
  t: (key: string, values?: Record<string, string | number>) => string
): string[] {
  const summary = (result.insight?.summary as Record<string, unknown> | undefined) || {};
  const lines: string[] = [];

  const attempted = summary.attempted;
  if (typeof attempted === "number") {
    lines.push(t("results.insights.answered", { count: attempted }));
  } else if ("answered_count" in result) {
    lines.push(t("results.insights.answered", { count: result.answered_count }));
  }

  const accuracy = summary.accuracy_percent;
  if (typeof accuracy === "number") {
    lines.push(t("results.insights.accuracy", { value: accuracy }));
  }

  const avgSeconds = summary.avg_seconds_per_question;
  if (typeof avgSeconds === "number") {
    lines.push(t("results.insights.averagePerQuestion", { value: avgSeconds }));
  }

  const weakestDomains = result.insight?.weakest_domains;
  if (Array.isArray(weakestDomains) && weakestDomains.length) {
    const first = weakestDomains[0] as { label?: string; wrong?: number } | string;
    if (typeof first === "string") {
      lines.push(t("results.insights.weakestDomain", { label: first }));
    } else if (first && typeof first === "object" && first.label) {
      lines.push(t("results.insights.weakestDomainWithErrors", { label: first.label, count: first.wrong ?? 0 }));
    }
  }

  if ("review_due_count" in result && typeof result.review_due_count === "number") {
    lines.push(t("results.insights.reviewDueAfter", { count: result.review_due_count }));
  }

  return lines;
}

function resolveReadiness(
  scorePercent: number,
  t: (key: string, values?: Record<string, string | number>) => string
): { label: string } {
  if (scorePercent >= 90) {
    return { label: t("results.readiness.excellent") };
  }
  if (scorePercent >= 80) {
    return { label: t("results.readiness.good") };
  }
  if (scorePercent >= 70) {
    return { label: t("results.readiness.ok") };
  }
  return { label: t("results.readiness.tuning") };
}

function CitationLinks({
  citations,
  openMaterialLabel
}: {
  citations?: CitationItem[] | null;
  openMaterialLabel: string;
}) {
  if (!citations?.length) {
    return null;
  }

  const previewLinks = citations
    .map((citation) => ({
      label: String(citation.reference || citation.source || openMaterialLabel),
      href: buildMaterialPreviewHref(citation)
    }))
    .filter((item) => item.href);

  if (!previewLinks.length) {
    return null;
  }

  return (
    <div className="sq-chip-row">
      {previewLinks.slice(0, 3).map((item) => (
        <a
          key={`${item.label}-${item.href}`}
          className="sq-chip"
          href={item.href || "#"}
          target="_blank"
          rel="noreferrer noopener"
        >
          {item.label}
        </a>
      ))}
    </div>
  );
}

function ReviewBlock({
  index,
  question,
  t,
  openMaterialLabel
}: {
  index: number;
  question: ReviewQuestion | StudyReviewQuestion;
  t: (key: string, values?: Record<string, string | number>) => string;
  openMaterialLabel: string;
}) {
  const questionNumber = "question_number" in question ? question.question_number : index + 1;

  return (
    <AccordionItem
      title={t("results.reviewBlock.question", { number: questionNumber })}
      subtitle={[question.certification, question.domain, question.difficulty].filter(Boolean).join(" · ") || t("results.reviewBlock.noMetadata")}
      meta={
        <span className={cn("sq-chip", question.is_correct ? "sq-chip--success" : "sq-chip--danger")}>
          {question.is_correct ? t("results.reviewBlock.correct") : t("results.reviewBlock.wrong")}
        </span>
      }
      defaultOpen={index === 0}
    >
      <div className="sq-result-prompt">{question.prompt}</div>

      <div className="sq-list">
        {question.options.map((option) => {
          const isCorrect = question.correct_keys.includes(option.key);
          const isSelected = question.selected_keys.includes(option.key);

          return (
            <div
              key={`${question.id}-${option.key}`}
              className={cn(
                "sq-list-item sq-choice-card",
                isCorrect && "sq-choice-card--correct",
                !isCorrect && isSelected && "sq-choice-card--wrong"
              )}
            >
              <div className="sq-choice-card__body">
                <span className="sq-chip">{option.key}</span>
                <span>
                  {option.text}
                  {isCorrect ? t("results.reviewBlock.correctSuffix") : ""}
                  {!isCorrect && isSelected ? t("results.reviewBlock.selectedSuffix") : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {question.justification ? <EmptyState size="compact" description={question.justification} /> : null}
      <CitationLinks citations={question.citations} openMaterialLabel={openMaterialLabel} />
    </AccordionItem>
  );
}

export function SessionResultShell({ sessionId, mode }: SessionResultShellProps) {
  const { t } = useI18n();
  const basePath = resolveResultBasePath(mode);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [review, setReview] = useState<SessionReview | StudySessionReview | null>(null);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      const response = await apiClient.get<SessionReview | StudySessionReview>(`${basePath}/${sessionId}/review`);
      setReview(response);
    } catch (error) {
      setLoadError(readResultError(error, t("results.errors.loadResult")));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void load();
  }, [sessionId, mode, load]);

  const result = review?.result || null;
  const reviewQuestions = review?.questions || [];
  const insightLines = useMemo(() => (result ? renderInsightLines(result, t) : []), [result, t]);

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={440} />
        </div>
      </main>
    );
  }

  if (loadError || !review || !result) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <StatusBanner
            tone="danger"
            title={t("results.errors.bannerTitle")}
            message={loadError || t("results.errors.missingReview")}
            role="alert"
            action={<Link href="/dashboard">{t("common.actions.goToDashboard")}</Link>}
          />
        </div>
      </main>
    );
  }

  const sessionMeta = review.session;
  const examResult = mode === "exam" ? (result as ExamResult) : null;
  const readiness = resolveReadiness(result.score_percent, t);
  const headerCopy =
    mode === "study"
      ? t("results.summary.studyTitle", { score: formatScore(result.score_percent) })
      : t("results.summary.examTitle", {
          score: formatScore(result.score_percent),
          readiness: readiness.label.toLowerCase()
        });

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">{t("results.header.title")}</div>
              <p className="sq-page-subtitle">
                {sessionMeta.exam_title || sessionMeta.exam_id || t("results.header.mixedSession")} ·{" "}
                {t("results.header.completedAt", { date: formatDateTime(sessionMeta.completed_at) })}
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/history">{t("common.labels.history")}</Link>
            <Link href="/admin">{t("common.labels.admin")}</Link>
            <Link href="/start">{t("common.actions.goToStart")}</Link>
          </div>
        </header>

        <Card title={headerCopy} subtitle={t("results.summary.strategySubtitle", { strategy: result.strategy })}>
          <div className="sq-surface-block">
            <div className="sq-metric-grid">
              <MetricCard label={t("results.summary.score")} value={formatScore(result.score_percent)} />
              <MetricCard label={t("results.summary.readiness")} value={readiness.label} />
              <MetricCard label={t("results.summary.correct")} value={result.correct_count} />
              <MetricCard label={t("results.summary.wrong")} value={result.wrong_count} />
              <MetricCard
                label={mode === "study" ? t("results.summary.answered") : t("results.summary.questions")}
                value={"answered_count" in result ? result.answered_count : result.total_questions}
              />
              {examResult?.time_spent_seconds !== undefined && examResult?.time_spent_seconds !== null ? (
                <MetricCard
                  label={t("results.summary.timeUsed")}
                  value={`${Math.max(Math.round(examResult.time_spent_seconds / 60), 1)} min`}
                />
              ) : null}
              {examResult?.time_limit_seconds !== undefined && examResult?.time_limit_seconds !== null ? (
                <MetricCard
                  label={t("results.summary.timeLimit")}
                  value={`${Math.max(Math.round(examResult.time_limit_seconds / 60), 1)} min`}
                />
              ) : null}
            </div>

            {examResult?.timed_out ? (
              <StatusBanner
                tone="warning"
                title={t("results.summary.timedOutTitle")}
                message={t("results.summary.timedOutMessage")}
              />
            ) : null}

            {insightLines.length ? (
              <div className="sq-chip-row">
                {insightLines.map((line) => (
                  <span key={line} className="sq-chip">
                    {line}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </Card>

        <Card
          title={t("results.reviewCard.title")}
          subtitle={t("results.reviewCard.subtitle")}
          actions={<span className="sq-chip">{t("results.reviewCard.questionCount", { count: reviewQuestions.length })}</span>}
        >
          {reviewQuestions.length ? (
            <Accordion>
              {reviewQuestions.map((question, index) => (
                <ReviewBlock
                  key={`${question.id}-${index}`}
                  index={index}
                  question={question}
                  t={t}
                  openMaterialLabel={t("results.citations.openMaterial")}
                />
              ))}
            </Accordion>
          ) : (
            <EmptyState description={t("results.reviewCard.empty")} />
          )}
        </Card>
      </div>
    </main>
  );
}
