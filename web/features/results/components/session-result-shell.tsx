"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { MetricCard } from "@/components/ui/metric-card";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { PbqQuestion } from "@/features/session-runner/components/pbq/pbq-question";
import { extractPbqResponse, isPbqQuestion, pbqCreditLabel, scoreToPercent } from "@/features/session-runner/lib/pbq-utils";
import { ApiError, apiClient, getTutorTimeoutMs, readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { translateBackendMessage, translateReadinessBand } from "@/lib/i18n/backend-messages";
import { useSessionReviewQuery, useSessionRole } from "@/lib/query/hooks";
import { cn } from "@/lib/utils/cn";
import { buildTheoryReaderHref } from "@/lib/utils/materials";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  CitationItem,
  ExamResult,
  QuestionIssueRequest,
  ReadinessScore,
  ReviewQuestion,
  ResultInsight,
  SessionReview,
  StudyPlanItem,
  StudyResult,
  StudyReviewQuestion,
  StudySessionReview,
  TimingBreakdown,
  TutorMode,
  TutorReply
} from "@/types/api";

type ResultMode = "exam" | "study";

interface SessionResultShellProps {
  sessionId: string;
  mode: ResultMode;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Maps tutor failures (contract §3) to user-facing copy. */
export function describeTutorError(error: unknown, t: Translate): { message: string; needsLogin: boolean } {
  if (error instanceof ApiError) {
    if (error.status === 401 || error.code === "auth_required") {
      return { message: t("results.tutor.authRequired"), needsLogin: true };
    }
    if (error.status === 409 || error.code === "tutor_unavailable_during_exam") {
      return { message: t("results.tutor.lockedDuringExam"), needsLogin: false };
    }
    if (error.status === 429 || error.code === "tutor_quota_exceeded") {
      return {
        message: error.retryAfterSeconds
          ? t("results.tutor.quotaExceededRetry", { seconds: error.retryAfterSeconds })
          : t("results.tutor.quotaExceeded"),
        needsLogin: false
      };
    }
    if (error.status === 502 || error.status === 503 || error.code === "tutor_upstream_error") {
      return { message: t("results.tutor.upstream"), needsLogin: false };
    }
  }
  return { message: readErrorMessage(error, t("results.tutor.unavailable")), needsLogin: false };
}

function renderInsightLines(
  result: ExamResult | StudyResult,
  t: (key: string, values?: Record<string, string | number>) => string
): string[] {
  const summary = result.insight?.summary || {};
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

/**
 * Optional per-certification note about the passing score (keyed by the certification name the
 * backend reports, e.g. results.summary.passThresholdNotes.CEH). null when there is none.
 */
export function passThresholdNote(certification: string | null | undefined, t: Translate): string | null {
  const name = String(certification || "").trim();
  if (!name || !/^[\w+.-]+$/.test(name)) {
    return null;
  }
  const key = `results.summary.passThresholdNotes.${name}`;
  const text = t(key);
  return text && text !== key ? text : null;
}

function buildReviewDomainHref(domain: string): string {
  const params = new URLSearchParams();
  params.append("domains", domain);
  params.set("auto_start", "true");
  return `/review?${params.toString()}`;
}

function formatSecondsMetric(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${Math.round(value)}s`;
}

function ReadinessCard({ readiness }: { readiness: ReadinessScore | null | undefined }) {
  const { t } = useI18n();
  if (!readiness) {
    return null;
  }

  // Factor texts come as code + params (M-C7); the backend text is the fallback.
  const factorTexts = readiness.factor_codes?.length
    ? readiness.factor_codes.map((factor, index) =>
        translateBackendMessage(t, factor.code, factor.params, readiness.factors?.[index] ?? factor.code)
      )
    : readiness.factors ?? [];

  const rankedDomains = [...(readiness.domain_scores || [])]
    .sort((left, right) => left.score_percent - right.score_percent || left.domain.localeCompare(right.domain))
    .slice(0, 5);

  return (
    <Card
      title={t("results.readinessCard.title")}
      subtitle={t("results.readinessCard.subtitle", {
        current: formatScore(readiness.score_percent),
        projected: formatScore(readiness.projected_score_percent),
      })}
    >
      <div className="sq-surface-block">
        <div className="sq-metric-grid">
          <MetricCard label={t("results.readinessCard.band")} value={translateReadinessBand(t, readiness.band)} />
          <MetricCard label={t("results.readinessCard.suggestedSession")} value={t("results.summary.minutes", { value: readiness.recommended_minutes })} />
          <MetricCard label={t("results.readinessCard.trackedBase")} value={readiness.tracked_questions} />
        </div>
        {factorTexts.length ? (
          <div className="sq-list" style={{ marginTop: "var(--sq-space-4)" }}>
            {factorTexts.map((factor) => (
              <div key={factor} className="sq-list-item">
                <div className="sq-list-meta">{factor}</div>
              </div>
            ))}
          </div>
        ) : null}
        {rankedDomains.length ? (
          <div className="sq-page-stack" style={{ marginTop: "var(--sq-space-4)" }}>
            <div className="sq-list-title">{t("results.readinessCard.byDomain")}</div>
            {rankedDomains.map((domain) => (
              <div key={`${domain.certification ?? ""}-${domain.domain}`} className="sq-surface-block">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "var(--sq-space-3)",
                    alignItems: "center"
                  }}
                >
                  <div className="sq-list-title">{domain.domain}</div>
                  <div className="sq-list-meta">{formatScore(domain.score_percent)}</div>
                </div>
                <div
                  role="meter"
                  aria-label={domain.domain}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(domain.score_percent)}
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
                      width: `${Math.max(4, Math.min(domain.score_percent, 100))}%`,
                      height: "100%",
                      borderRadius: 999,
                      background:
                        domain.score_percent >= 80
                          ? "linear-gradient(90deg, rgba(21,128,61,0.82), rgba(74,222,128,0.76))"
                          : domain.score_percent >= 65
                            ? "linear-gradient(90deg, rgba(180,83,9,0.82), rgba(251,191,36,0.76))"
                            : "linear-gradient(90deg, rgba(185,28,28,0.82), rgba(248,113,113,0.76))"
                    }}
                  />
                </div>
                <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                  <span className="sq-chip">{t("results.readinessCard.accuracy", { value: formatScore(domain.accuracy_percent) })}</span>
                  <span className="sq-chip">{t("results.readinessCard.attempts", { count: domain.attempts })}</span>
                  <span className="sq-chip">{t("results.readinessCard.pace", { value: formatSecondsMetric(domain.avg_elapsed_seconds) })}</span>
                  <span className="sq-chip">{t("results.readinessCard.lowConfidence", { count: domain.low_confidence_count })}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function TimingCard({ timing }: { timing: TimingBreakdown | null | undefined }) {
  const { t } = useI18n();
  if (!timing) {
    return null;
  }

  return (
    <Card title={t("results.timingCard.title")} subtitle={t("results.timingCard.subtitle")}>
      <div className="sq-surface-block">
        <div className="sq-metric-grid">
          <MetricCard label={t("results.timingCard.duration")} value={formatSecondsMetric(timing.duration_seconds)} />
          <MetricCard label={t("results.timingCard.averagePerQuestion")} value={formatSecondsMetric(timing.avg_seconds_per_question)} />
          <MetricCard label={t("results.timingCard.fastest")} value={formatSecondsMetric(timing.fastest_seconds)} />
          <MetricCard label={t("results.timingCard.slowest")} value={formatSecondsMetric(timing.slowest_seconds)} />
        </div>
      </div>
    </Card>
  );
}

function StudyPlanCard({ items }: { items: StudyPlanItem[] }) {
  const { t } = useI18n();
  if (!items.length) {
    return null;
  }

  return (
    <Card title={t("results.studyPlanCard.title")} subtitle={t("results.studyPlanCard.subtitle")}>
      <div className="sq-page-stack">
        {items.slice(0, 3).map((item) => (
          <div key={`${item.domain}-${item.action}`} className="sq-surface-block">
            <div className="sq-list-title">
              {t("results.studyPlanCard.itemTitle", {
                domain: item.domain,
                wrong: item.wrong,
                total: item.total,
                score: formatScore(item.score_percent)
              })}
            </div>
            <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-2)" }}>
              {item.reason}
            </div>
            {item.topics?.length ? (
              <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                {item.topics.map((topic) => (
                  <span key={topic} className="sq-chip">
                    {topic}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-3)" }}>
              {item.action}
            </div>
            <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
              <Link href={buildReviewDomainHref(item.domain)}>{t("results.studyPlanCard.openReview")}</Link>
              <a href="#review-card">{t("results.studyPlanCard.openReferences")}</a>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
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
      href: buildTheoryReaderHref(citation)
    }))
    .filter((item) => item.href);

  if (!previewLinks.length) {
    return null;
  }

  return (
    <div className="sq-chip-row">
      {previewLinks.slice(0, 3).map((item) => (
        <Link
          key={`${item.label}-${item.href}`}
          className="sq-chip"
          href={item.href || "#"}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function ReviewBlock({
  sessionId,
  enableTutor,
  index,
  question,
  t,
  openMaterialLabel
}: {
  sessionId: string;
  enableTutor: boolean;
  index: number;
  question: ReviewQuestion | StudyReviewQuestion;
  t: (key: string, values?: Record<string, string | number>) => string;
  openMaterialLabel: string;
}) {
  const { t: localT } = useI18n();
  const pathname = usePathname();
  const { isAuthenticated } = useSessionRole();
  const fieldId = useId();
  const questionNumber = "question_number" in question ? question.question_number : index + 1;
  const isPbq = isPbqQuestion(question);
  const pbqPercent = isPbq ? scoreToPercent(question.score) : null;
  const pbqResponse = isPbq ? extractPbqResponse(question) : null;
  const [isTutorLoading, setIsTutorLoading] = useState(false);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [tutorError, setTutorError] = useState<{ message: string; needsLogin: boolean } | null>(null);
  const [isIssueSubmitting, setIsIssueSubmitting] = useState(false);
  const [issueCategory, setIssueCategory] = useState<QuestionIssueRequest["category"]>("clareza");
  const [issueMessage, setIssueMessage] = useState("");
  const [issueNotice, setIssueNotice] = useState<string | null>(null);

  async function runTutor(mode: TutorMode) {
    setIsTutorLoading(true);
    setTutorError(null);
    try {
      const reply = await apiClient.post<TutorReply>(
        `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(question.id)}/tutor`,
        { mode },
        { timeoutMs: getTutorTimeoutMs() }
      );
      setTutorReply(reply);
    } catch (error) {
      setTutorReply(null);
      setTutorError(describeTutorError(error, localT));
    } finally {
      setIsTutorLoading(false);
    }
  }

  async function runIssueReport() {
    if (issueMessage.trim().length < 8) {
      return;
    }
    setIsIssueSubmitting(true);
    setIssueNotice(null);
    try {
      await apiClient.post(`/questions/${encodeURIComponent(question.id)}/issues`, {
        session_id: sessionId,
        mode: enableTutor ? "exam" : "study",
        category: issueCategory,
        message: issueMessage.trim()
      } satisfies QuestionIssueRequest);
      setIssueMessage("");
      setIssueNotice(localT("results.issueReport.success"));
    } catch (error) {
      setIssueNotice(readErrorMessage(error, localT("results.issueReport.failure")));
    } finally {
      setIsIssueSubmitting(false);
    }
  }

  return (
    <AccordionItem
      title={t("results.reviewBlock.question", { number: questionNumber })}
      subtitle={[question.certification, question.domain, question.difficulty].filter(Boolean).join(" · ") || t("results.reviewBlock.noMetadata")}
      meta={
        <>
          {isPbq ? <span className="sq-chip">{t("pbq.badge")}</span> : null}
          <span className={cn("sq-chip", question.is_correct ? "sq-chip--success" : "sq-chip--danger")}>
            <span aria-hidden="true">{question.is_correct ? "✓ " : "✗ "}</span>
            {isPbq && pbqPercent !== null
              ? `${pbqCreditLabel(question.score, t)} · ${pbqPercent}%`
              : question.is_correct
                ? t("results.reviewBlock.correct")
                : t("results.reviewBlock.wrong")}
          </span>
        </>
      }
      defaultOpen={index === 0}
    >
      {isPbq ? (
        <div className="sq-stack-md">
          <div className="sq-list-title">{t("pbq.review.title")}</div>
          {!pbqResponse || !Object.keys(pbqResponse).length ? (
            <p className="sq-list-meta">{t("pbq.review.noResponse")}</p>
          ) : null}
          <PbqQuestion payload={question.pbq} response={pbqResponse} disabled result={question} headingLevel={3} t={t} />
        </div>
      ) : (
        <div className="sq-result-prompt">{question.prompt}</div>
      )}

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

      {enableTutor ? (
        <div className="sq-surface-block" style={{ marginTop: "var(--sq-space-4)" }}>
          <div className="sq-list-title">{t("results.tutor.title")}</div>
          {isAuthenticated ? (
            <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
              <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("help")}>
                {t("results.tutor.explain")}
              </button>
              <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("why_wrong")}>
                {t("results.tutor.whyWrong")}
              </button>
              <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("review")}>
                {t("results.tutor.reviewTopic")}
              </button>
            </div>
          ) : (
            <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
              <span className="sq-list-meta">{t("results.tutor.authRequired")}</span>
              <Link href={`/login?next=${encodeURIComponent(pathname || "/")}`} className="sq-button sq-button--sm sq-button--primary">
                {t("results.tutor.signIn")}
              </Link>
            </div>
          )}
          <div aria-live="polite">
            {isTutorLoading ? (
              <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-3)" }}>
                {t("results.tutor.loading")}
              </div>
            ) : null}
          </div>
          {tutorError ? (
            <StatusBanner
              tone="warning"
              role="alert"
              title={t("results.tutor.unavailable")}
              message={tutorError.message}
              action={
                tutorError.needsLogin ? (
                  <Link
                    href={`/login?next=${encodeURIComponent(pathname || "/")}`}
                    className="sq-button sq-button--sm sq-button--primary"
                  >
                    {t("results.tutor.signIn")}
                  </Link>
                ) : undefined
              }
            />
          ) : null}
          {tutorReply ? (
            <StatusBanner
              tone={tutorReply.blocked ? "warning" : "neutral"}
              title={tutorReply.blocked ? t("results.tutor.blocked") : t("results.tutor.answered")}
              message={tutorReply.message}
            />
          ) : null}
        </div>
      ) : null}

      <div className="sq-surface-block" style={{ marginTop: "var(--sq-space-4)" }}>
        <div className="sq-list-title">{t("results.issueReport.title")}</div>
        <div className="sq-field" style={{ marginTop: "var(--sq-space-3)" }}>
          <label className="sq-field-label" htmlFor={`${fieldId}-issue-category`}>
            {t("results.issueReport.categoryLabel")}
          </label>
          <select
            id={`${fieldId}-issue-category`}
            className="sq-select"
            value={issueCategory}
            onChange={(event) => setIssueCategory(event.target.value as QuestionIssueRequest["category"])}
          >
            <option value="clareza">{t("results.issueReport.clarity")}</option>
            <option value="gabarito">{t("results.issueReport.answerKey")}</option>
            <option value="explicacao">{t("results.issueReport.explanation")}</option>
            <option value="referencia">{t("results.issueReport.reference")}</option>
          </select>
        </div>
        <div className="sq-field" style={{ marginTop: "var(--sq-space-3)" }}>
          <label className="sq-field-label" htmlFor={`${fieldId}-issue-message`}>
            {t("results.issueReport.messageLabel")}
          </label>
          <textarea
            id={`${fieldId}-issue-message`}
            className="sq-textarea"
            rows={3}
            minLength={8}
            maxLength={2000}
            value={issueMessage}
            onChange={(event) => setIssueMessage(event.target.value)}
          />
        </div>
        <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
          <button type="button" className="sq-chip" disabled={isIssueSubmitting || issueMessage.trim().length < 8} onClick={() => void runIssueReport()}>
            {t("results.issueReport.send")}
          </button>
        </div>
        <div aria-live="polite">
          {issueNotice ? (
            <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-3)" }}>
              {issueNotice}
            </div>
          ) : null}
        </div>
      </div>
    </AccordionItem>
  );
}

export function SessionResultShell({ sessionId, mode }: SessionResultShellProps) {
  const { t } = useI18n();
  const { isStaff } = useSessionRole();
  const reviewQuery = useSessionReviewQuery(mode, sessionId);
  const review: SessionReview | StudySessionReview | null = reviewQuery.data ?? null;
  const isLoading = reviewQuery.isPending;
  const loadError = reviewQuery.isError ? readErrorMessage(reviewQuery.error, t("results.errors.loadResult")) : null;

  const result = review?.result || null;
  const reviewQuestions = review?.questions || [];
  const insightLines = useMemo(() => (result ? renderInsightLines(result, t) : []), [result, t]);
  const resultInsight: ResultInsight | null = result?.insight || null;
  const studyPlan = resultInsight?.study_plan || [];
  const readinessScore = resultInsight?.readiness || null;

  if (isLoading) {
    return (
      <main className="sq-app-shell" aria-busy="true">
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
          {reviewQuery.isError ? (
            <QueryErrorBanner
              title={t("results.errors.bannerTitle")}
              error={reviewQuery.error}
              onRetry={() => void reviewQuery.refetch()}
              retrying={reviewQuery.isFetching}
            />
          ) : (
            <StatusBanner
              tone="danger"
              title={t("results.errors.bannerTitle")}
              message={loadError || t("results.errors.missingReview")}
              role="alert"
              action={
                <>
                  <Button variant="ghost" size="sm" busy={reviewQuery.isFetching} onClick={() => void reviewQuery.refetch()}>
                    {t("common.actions.retry")}
                  </Button>
                  <Link href="/dashboard">{t("common.actions.goToDashboard")}</Link>
                </>
              }
            />
          )}
        </div>
      </main>
    );
  }

  const sessionMeta = review.session;
  const examResult = mode === "exam" ? (result as ExamResult) : null;
  const readinessLabel = resolveReadiness(result.score_percent, t);
  const headerCopy =
    mode === "study"
      ? t("results.summary.studyTitle", { score: formatScore(result.score_percent) })
      : t("results.summary.examTitle", {
          score: formatScore(result.score_percent),
          readiness: readinessLabel.label.toLowerCase()
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
              <h1 className="sq-page-title">{t("results.header.title")}</h1>
              <p className="sq-page-subtitle">
                {sessionMeta.exam_title || sessionMeta.exam_id || t("results.header.mixedSession")} ·{" "}
                {t("results.header.completedAt", { date: formatDateTime(sessionMeta.completed_at) })}
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/history">{t("common.labels.history")}</Link>
            {isStaff ? <Link href="/admin">{t("common.labels.admin")}</Link> : null}
            <Link href="/start">{t("common.actions.goToStart")}</Link>
          </div>
        </header>

        <Card title={headerCopy} subtitle={t("results.summary.strategySubtitle", { strategy: result.strategy })}>
          <div className="sq-surface-block">
            <div className="sq-metric-grid">
              <MetricCard label={t("results.summary.score")} value={formatScore(result.score_percent)} />
              <MetricCard label={t("results.summary.readiness")} value={readinessLabel.label} />
              <MetricCard label={t("results.summary.correct")} value={result.correct_count} />
              <MetricCard label={t("results.summary.wrong")} value={result.wrong_count} />
              <MetricCard
                label={mode === "study" ? t("results.summary.answered") : t("results.summary.questions")}
                value={"answered_count" in result ? result.answered_count : result.total_questions}
              />
              {examResult?.time_spent_seconds !== undefined && examResult?.time_spent_seconds !== null ? (
                <MetricCard
                  label={t("results.summary.timeUsed")}
                  value={t("results.summary.minutes", { value: Math.max(Math.round(examResult.time_spent_seconds / 60), 1) })}
                />
              ) : null}
              {examResult ? (
                <MetricCard
                  label={t("results.summary.passThreshold")}
                  value={`${formatScore(examResult.pass_threshold_percent)}${
                    examResult.pass_threshold_certification ? ` · ${examResult.pass_threshold_certification}` : ""
                  }`}
                  meta={passThresholdNote(examResult.pass_threshold_certification, t) ?? undefined}
                />
              ) : null}
              {examResult?.time_limit_seconds !== undefined && examResult?.time_limit_seconds !== null ? (
                <MetricCard
                  label={t("results.summary.timeLimit")}
                  value={t("results.summary.minutes", { value: Math.max(Math.round(examResult.time_limit_seconds / 60), 1) })}
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

        <ReadinessCard readiness={readinessScore} />
        <TimingCard timing={resultInsight?.timing} />
        <StudyPlanCard items={studyPlan} />

        <Card
          id="review-card"
          title={t("results.reviewCard.title")}
          subtitle={t("results.reviewCard.subtitle")}
          actions={<span className="sq-chip">{t("results.reviewCard.questionCount", { count: reviewQuestions.length })}</span>}
        >
          {reviewQuestions.length ? (
            <Accordion>
              {reviewQuestions.map((question, index) => (
                <ReviewBlock
                  key={`${question.id}-${index}`}
                  sessionId={sessionId}
                  enableTutor={mode === "exam"}
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
