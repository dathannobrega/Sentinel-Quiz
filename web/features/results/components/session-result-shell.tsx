"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { BookIcon, CircleCheckIcon, CircleXIcon, SparkIcon, SpinnerIcon } from "@/components/ui/icons";
import { Select, Textarea } from "@/components/ui/input";
import { Meter } from "@/components/ui/meter";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader, Panel, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { PbqQuestion } from "@/features/session-runner/components/pbq/pbq-question";
import { OptionFace, optionRowClassName, resolveOptionState } from "@/features/session-runner/components/question-options";
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

const sectionLabel = "text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase";

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

function renderInsightLines(result: ExamResult | StudyResult, t: Translate): string[] {
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

function resolveReadiness(scorePercent: number, t: Translate): { label: string } {
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

function ReadinessSection({ readiness }: { readiness: ReadinessScore | null | undefined }) {
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
    <Section
      title={t("results.readinessCard.title")}
      description={t("results.readinessCard.subtitle", {
        current: formatScore(readiness.score_percent),
        projected: formatScore(readiness.projected_score_percent)
      })}
    >
      <StatList>
        <Stat label={t("results.readinessCard.band")} value={translateReadinessBand(t, readiness.band)} />
        <Stat label={t("results.readinessCard.suggestedSession")} value={t("results.summary.minutes", { value: readiness.recommended_minutes })} />
        <Stat label={t("results.readinessCard.trackedBase")} value={readiness.tracked_questions} />
      </StatList>
      {factorTexts.length ? (
        <ul className="flex flex-col gap-1.5 text-sm text-fg-muted">
          {factorTexts.map((factor) => (
            <li key={factor} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-fg-subtle" />
              {factor}
            </li>
          ))}
        </ul>
      ) : null}
      {rankedDomains.length ? (
        <div className="flex flex-col gap-2">
          <h3 className={sectionLabel}>{t("results.readinessCard.byDomain")}</h3>
          <ul className="divide-y divide-line border-y border-line">
            {rankedDomains.map((domain) => (
              <li key={`${domain.certification ?? ""}-${domain.domain}`} className="flex flex-col gap-2 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-fg">{domain.domain}</span>
                  <span className="nums text-sm font-semibold text-fg">{formatScore(domain.score_percent)}</span>
                </div>
                <Meter value={domain.score_percent} kind="score" label={domain.domain} />
                <p className="text-xs text-fg-muted">
                  {[
                    t("results.readinessCard.accuracy", { value: formatScore(domain.accuracy_percent) }),
                    t("results.readinessCard.attempts", { count: domain.attempts }),
                    t("results.readinessCard.pace", { value: formatSecondsMetric(domain.avg_elapsed_seconds) }),
                    t("results.readinessCard.lowConfidence", { count: domain.low_confidence_count })
                  ].join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function TimingSection({ timing }: { timing: TimingBreakdown | null | undefined }) {
  const { t } = useI18n();
  if (!timing) {
    return null;
  }

  return (
    <Section title={t("results.timingCard.title")} description={t("results.timingCard.subtitle")}>
      <StatList>
        <Stat label={t("results.timingCard.duration")} value={formatSecondsMetric(timing.duration_seconds)} />
        <Stat label={t("results.timingCard.averagePerQuestion")} value={formatSecondsMetric(timing.avg_seconds_per_question)} />
        <Stat label={t("results.timingCard.fastest")} value={formatSecondsMetric(timing.fastest_seconds)} />
        <Stat label={t("results.timingCard.slowest")} value={formatSecondsMetric(timing.slowest_seconds)} />
      </StatList>
    </Section>
  );
}

function StudyPlanSection({ items }: { items: StudyPlanItem[] }) {
  const { t } = useI18n();
  if (!items.length) {
    return null;
  }

  return (
    <Section title={t("results.studyPlanCard.title")} description={t("results.studyPlanCard.subtitle")}>
      <ol className="divide-y divide-line border-y border-line">
        {items.slice(0, 3).map((item) => (
          <li key={`${item.domain}-${item.action}`} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="flex min-w-0 flex-col gap-1">
              <p className="font-medium text-fg">
                {t("results.studyPlanCard.itemTitle", {
                  domain: item.domain,
                  wrong: item.wrong,
                  total: item.total,
                  score: formatScore(item.score_percent)
                })}
              </p>
              <p className="text-sm text-fg-muted">{item.reason}</p>
              {item.topics?.length ? <p className="text-[0.8125rem] text-fg-subtle">{item.topics.join(" · ")}</p> : null}
              <p className="text-sm text-fg">{item.action}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href={buildReviewDomainHref(item.domain)} className={buttonClassName("secondary", "sm")}>
                {t("results.studyPlanCard.openReview")}
              </Link>
              <a href="#review-card" className="focus-ring rounded-sm px-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
                {t("results.studyPlanCard.openReferences")}
              </a>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CitationLinks({ citations, openMaterialLabel, title }: { citations?: CitationItem[] | null; openMaterialLabel: string; title: string }) {
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
    <div className="flex flex-col gap-2">
      <h4 className={sectionLabel}>{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {previewLinks.slice(0, 3).map((item) => (
          <li key={`${item.label}-${item.href}`} className="flex items-start gap-2 text-[0.8125rem]">
            <BookIcon className="mt-0.5 shrink-0 text-fg-subtle" />
            <Link href={item.href || "#"} className="focus-ring rounded-sm font-medium text-primary underline-offset-2 hover:underline">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
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
  t: Translate;
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
  const loginHref = `/login?next=${encodeURIComponent(pathname || "/")}`;

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

  const gradedFeedback = { is_correct: question.is_correct, correct_keys: question.correct_keys };
  const correctnessTone = question.is_correct ? "success" : isPbq && (question.score ?? 0) > 0 ? "warning" : "danger";

  return (
    <Disclosure
      variant="plain"
      defaultOpen={index === 0}
      summary={t("results.reviewBlock.question", { number: questionNumber })}
      hint={[question.certification, question.domain, question.difficulty].filter(Boolean).join(" · ") || t("results.reviewBlock.noMetadata")}
      meta={
        <>
          {isPbq ? <Badge tone="primary">{t("pbq.badge")}</Badge> : null}
          <Badge tone={correctnessTone}>
            <span aria-hidden="true">{question.is_correct ? "✓ " : "✗ "}</span>
            {isPbq && pbqPercent !== null
              ? `${pbqCreditLabel(question.score, t)} · ${pbqPercent}%`
              : question.is_correct
                ? t("results.reviewBlock.correct")
                : t("results.reviewBlock.wrong")}
          </Badge>
        </>
      }
      contentClassName="flex flex-col gap-6"
    >
      {isPbq ? (
        <div className="flex flex-col gap-3">
          <h3 className={sectionLabel}>{t("pbq.review.title")}</h3>
          {!pbqResponse || !Object.keys(pbqResponse).length ? <p className="text-sm text-fg-muted">{t("pbq.review.noResponse")}</p> : null}
          <PbqQuestion payload={question.pbq} response={pbqResponse} disabled result={question} headingLevel={3} t={t} />
        </div>
      ) : (
        <p className="font-serif text-[1.0625rem] leading-[1.65] whitespace-pre-line text-fg">{question.prompt}</p>
      )}

      {question.options.length ? (
        <ul className="flex flex-col gap-2">
          {question.options.map((option) => {
            const isSelected = question.selected_keys.includes(option.key);
            const state = resolveOptionState(option.key, isSelected, gradedFeedback);
            return (
              <li key={`${question.id}-${option.key}`} className={optionRowClassName(state, isSelected, false, true)}>
                <OptionFace
                  optionKey={option.key}
                  text={option.text}
                  multiSelect={question.multi_select}
                  selected={isSelected}
                  state={state}
                  locked
                  receded={!state && !isSelected}
                  t={t}
                />
              </li>
            );
          })}
        </ul>
      ) : null}

      {question.justification ? (
        <div className="flex flex-col gap-2">
          <h4 className={sectionLabel}>{t("results.reviewBlock.explanation")}</h4>
          <p className="font-serif text-[1.0625rem] leading-[1.7] whitespace-pre-line text-fg">{question.justification}</p>
        </div>
      ) : null}
      <CitationLinks citations={question.citations} openMaterialLabel={openMaterialLabel} title={t("results.reviewBlock.references")} />

      {enableTutor ? (
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-fg">
            <SparkIcon className="text-primary" />
            {t("results.tutor.title")}
          </h4>
          {isAuthenticated ? (
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ["help", "results.tutor.explain"],
                  ["why_wrong", "results.tutor.whyWrong"],
                  ["review", "results.tutor.reviewTopic"]
                ] as const
              ).map(([tutorMode, labelKey]) => (
                <Button key={tutorMode} variant="secondary" size="sm" disabled={isTutorLoading} onClick={() => void runTutor(tutorMode)}>
                  {t(labelKey)}
                </Button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-fg-muted">{t("results.tutor.authRequired")}</span>
              <Link href={loginHref} className={buttonClassName("primary", "sm")}>
                {t("results.tutor.signIn")}
              </Link>
            </div>
          )}
          <div aria-live="polite">
            {isTutorLoading ? (
              <p className="inline-flex items-center gap-2 text-[0.8125rem] text-fg-muted">
                <SpinnerIcon />
                {t("results.tutor.loading")}
              </p>
            ) : null}
          </div>
          {tutorError ? (
            <Alert
              tone="warning"
              role="alert"
              title={t("results.tutor.unavailable")}
              message={tutorError.message}
              action={
                tutorError.needsLogin ? (
                  <Link href={loginHref} className={buttonClassName("primary", "sm")}>
                    {t("results.tutor.signIn")}
                  </Link>
                ) : undefined
              }
            />
          ) : null}
          {tutorReply ? (
            tutorReply.blocked ? (
              <Alert tone="warning" title={t("results.tutor.blocked")} message={tutorReply.message} />
            ) : (
              <div className="flex flex-col gap-1.5 rounded-md bg-surface-muted px-4 py-3" role="status">
                <p className="text-xs font-semibold text-fg-muted">{t("results.tutor.answered")}</p>
                <p className="font-serif text-[0.9375rem] leading-relaxed whitespace-pre-line text-fg">{tutorReply.message}</p>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <div className="rounded-md border border-line px-4">
        <Disclosure variant="plain" summary={t("results.issueReport.title")}>
          <div className="flex flex-col gap-3">
            <Field label={t("results.issueReport.categoryLabel")} htmlFor={`${fieldId}-issue-category`}>
              <Select
                id={`${fieldId}-issue-category`}
                value={issueCategory}
                onChange={(event) => setIssueCategory(event.target.value as QuestionIssueRequest["category"])}
              >
                <option value="clareza">{t("results.issueReport.clarity")}</option>
                <option value="gabarito">{t("results.issueReport.answerKey")}</option>
                <option value="explicacao">{t("results.issueReport.explanation")}</option>
                <option value="referencia">{t("results.issueReport.reference")}</option>
              </Select>
            </Field>
            <Field label={t("results.issueReport.messageLabel")} htmlFor={`${fieldId}-issue-message`}>
              <Textarea
                id={`${fieldId}-issue-message`}
                rows={3}
                minLength={8}
                maxLength={2000}
                value={issueMessage}
                onChange={(event) => setIssueMessage(event.target.value)}
              />
            </Field>
            <div>
              <Button
                variant="secondary"
                size="sm"
                busy={isIssueSubmitting}
                disabled={issueMessage.trim().length < 8}
                onClick={() => void runIssueReport()}
              >
                {t("results.issueReport.send")}
              </Button>
            </div>
            <div aria-live="polite">{issueNotice ? <p className="text-[0.8125rem] text-fg-muted">{issueNotice}</p> : null}</div>
          </div>
        </Disclosure>
      </div>
    </Disclosure>
  );
}

export function SessionResultShell({ sessionId, mode }: SessionResultShellProps) {
  const { t } = useI18n();
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
      <Page aria-busy="true">
        <Skeleton height={56} className="max-w-md" />
        <Skeleton height={200} />
        <Skeleton height={420} />
      </Page>
    );
  }

  if (loadError || !review || !result) {
    return (
      <Page width="narrow">
        {reviewQuery.isError ? (
          <QueryErrorBanner
            title={t("results.errors.bannerTitle")}
            error={reviewQuery.error}
            onRetry={() => void reviewQuery.refetch()}
            retrying={reviewQuery.isFetching}
          />
        ) : (
          <Alert
            tone="danger"
            title={t("results.errors.bannerTitle")}
            message={loadError || t("results.errors.missingReview")}
            role="alert"
            action={
              <>
                <Button variant="secondary" size="sm" busy={reviewQuery.isFetching} onClick={() => void reviewQuery.refetch()}>
                  {t("common.actions.retry")}
                </Button>
                <Link href="/dashboard" className={buttonClassName("ghost", "sm")}>
                  {t("common.actions.goToDashboard")}
                </Link>
              </>
            }
          />
        )}
      </Page>
    );
  }

  const sessionMeta = review.session;
  const examResult = mode === "exam" ? (result as ExamResult) : null;
  const readinessLabel = resolveReadiness(result.score_percent, t);
  const threshold = examResult ? formatScore(examResult.pass_threshold_percent) : "";
  const thresholdNote = examResult ? passThresholdNote(examResult.pass_threshold_certification, t) : null;

  return (
    <Page>
      <PageHeader
        context={`${sessionMeta.exam_title || sessionMeta.exam_id || t("results.header.mixedSession")} · ${t("results.header.completedAt", {
          date: formatDateTime(sessionMeta.completed_at)
        })}`}
        title={t("results.header.title")}
        actions={
          <>
            <Link href="/history" className={buttonClassName("ghost")}>
              {t("common.labels.history")}
            </Link>
            <Link href="/start" className={buttonClassName("secondary")}>
              {t("common.actions.goToStart")}
            </Link>
          </>
        }
      />

      <Panel padding="lg" aria-label={t("results.summary.score")}>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <dl data-testid="result-score">
            <Stat emphasis label={t("results.summary.score")} value={formatScore(result.score_percent)} className="[&_dd:first-of-type]:text-5xl" />
          </dl>
          <div className="flex min-w-0 flex-col gap-1.5 pb-1.5">
            {examResult ? (
              <p className={cn("inline-flex items-center gap-2 text-[0.9375rem] font-semibold", examResult.passed ? "text-success" : "text-danger")}>
                {examResult.passed ? <CircleCheckIcon size={18} /> : <CircleXIcon size={18} />}
                {examResult.passed ? t("results.summary.passed", { threshold }) : t("results.summary.failed", { threshold })}
              </p>
            ) : null}
            <p className="text-sm text-fg-muted">
              {t("results.summary.readiness")}: <span className="font-medium text-fg">{readinessLabel.label}</span> ·{" "}
              {t("results.summary.strategySubtitle", { strategy: result.strategy })}
            </p>
            {thresholdNote ? <p className="max-w-prose text-xs text-fg-muted">{thresholdNote}</p> : null}
          </div>
        </div>

        <StatList>
          <Stat label={t("results.summary.correct")} value={result.correct_count} />
          <Stat label={t("results.summary.wrong")} value={result.wrong_count} />
          <Stat
            label={mode === "study" ? t("results.summary.answered") : t("results.summary.questions")}
            value={"answered_count" in result ? result.answered_count : result.total_questions}
          />
          {examResult?.time_spent_seconds !== undefined && examResult?.time_spent_seconds !== null ? (
            <Stat
              label={t("results.summary.timeUsed")}
              value={t("results.summary.minutes", { value: Math.max(Math.round(examResult.time_spent_seconds / 60), 1) })}
            />
          ) : null}
          {examResult?.time_limit_seconds !== undefined && examResult?.time_limit_seconds !== null ? (
            <Stat
              label={t("results.summary.timeLimit")}
              value={t("results.summary.minutes", { value: Math.max(Math.round(examResult.time_limit_seconds / 60), 1) })}
            />
          ) : null}
          {examResult ? (
            <Stat
              label={t("results.summary.passThreshold")}
              value={`${threshold}${examResult.pass_threshold_certification ? ` · ${examResult.pass_threshold_certification}` : ""}`}
            />
          ) : null}
        </StatList>

        {examResult?.timed_out ? (
          <Alert tone="warning" title={t("results.summary.timedOutTitle")} message={t("results.summary.timedOutMessage")} />
        ) : null}

        {insightLines.length ? (
          <ul className="flex flex-col gap-1 text-sm text-fg-muted">
            {insightLines.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-fg-subtle" />
                {line}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <StudyPlanSection items={studyPlan} />

      <Section
        id="review-card"
        className="scroll-mt-20"
        title={t("results.reviewCard.title")}
        description={t("results.reviewCard.subtitle")}
        actions={<span className="nums text-sm text-fg-muted">{t("results.reviewCard.questionCount", { count: reviewQuestions.length })}</span>}
      >
        {reviewQuestions.length ? (
          <div className="border-y border-line">
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
          </div>
        ) : (
          <EmptyState description={t("results.reviewCard.empty")} />
        )}
      </Section>

      {readinessScore || resultInsight?.timing ? (
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-12">
          <ReadinessSection readiness={readinessScore} />
          <TimingSection timing={resultInsight?.timing} />
        </div>
      ) : null}
    </Page>
  );
}
