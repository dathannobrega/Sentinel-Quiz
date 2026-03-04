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
  TutorReply
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
  if (!readiness) {
    return null;
  }

  const rankedDomains = [...(readiness.domain_scores || [])]
    .sort((left, right) => left.score_percent - right.score_percent || left.domain.localeCompare(right.domain))
    .slice(0, 5);

  return (
    <Card
      title="Readiness Score"
      subtitle={`Atual ${formatScore(readiness.score_percent)} · projetado ${formatScore(readiness.projected_score_percent)}`}
    >
      <div className="sq-surface-block">
        <div className="sq-metric-grid">
          <MetricCard label="Faixa" value={readiness.band} />
          <MetricCard label="Sessao sugerida" value={`${readiness.recommended_minutes} min`} />
          <MetricCard label="Base rastreada" value={readiness.tracked_questions} />
        </div>
        {readiness.factors?.length ? (
          <div className="sq-list" style={{ marginTop: "var(--sq-space-4)" }}>
            {readiness.factors.map((factor) => (
              <div key={factor} className="sq-list-item">
                <div className="sq-list-meta">{factor}</div>
              </div>
            ))}
          </div>
        ) : null}
        {rankedDomains.length ? (
          <div className="sq-page-stack" style={{ marginTop: "var(--sq-space-4)" }}>
            <div className="sq-list-title">Domínio por domínio</div>
            {rankedDomains.map((domain) => (
              <div key={domain.domain} className="sq-surface-block">
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
                  <span className="sq-chip">acerto {formatScore(domain.accuracy_percent)}</span>
                  <span className="sq-chip">{domain.attempts} tentativa(s)</span>
                  <span className="sq-chip">ritmo {formatSecondsMetric(domain.avg_elapsed_seconds)}</span>
                  <span className="sq-chip">baixa confiança {domain.low_confidence_count}</span>
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
  if (!timing) {
    return null;
  }

  return (
    <Card title="Ritmo da sessão" subtitle="Velocidade e dispersão agora entram de forma explícita na leitura de prontidão.">
      <div className="sq-surface-block">
        <div className="sq-metric-grid">
          <MetricCard label="Duração" value={formatSecondsMetric(timing.duration_seconds)} />
          <MetricCard label="Média por questão" value={formatSecondsMetric(timing.avg_seconds_per_question)} />
          <MetricCard label="Mais rápida" value={formatSecondsMetric(timing.fastest_seconds)} />
          <MetricCard label="Mais lenta" value={formatSecondsMetric(timing.slowest_seconds)} />
        </div>
      </div>
    </Card>
  );
}

function StudyPlanCard({ items }: { items: StudyPlanItem[] }) {
  if (!items.length) {
    return null;
  }

  return (
    <Card title="Plano recomendado (15-45 min)" subtitle="Priorize os domínios com maior atrito e entre direto em revisão focada.">
      <div className="sq-page-stack">
        {items.slice(0, 3).map((item) => (
          <div key={`${item.domain}-${item.action}`} className="sq-surface-block">
            <div className="sq-list-title">
              {item.domain} · {item.wrong}/{item.total} erradas · {formatScore(item.score_percent)}
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
              <Link href={buildReviewDomainHref(item.domain)}>Iniciar revisão</Link>
              <a href="#review-card">Abrir referências</a>
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
  const questionNumber = "question_number" in question ? question.question_number : index + 1;
  const [isTutorLoading, setIsTutorLoading] = useState(false);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [isIssueSubmitting, setIsIssueSubmitting] = useState(false);
  const [issueCategory, setIssueCategory] = useState<QuestionIssueRequest["category"]>("clareza");
  const [issueMessage, setIssueMessage] = useState("");
  const [issueNotice, setIssueNotice] = useState<string | null>(null);

  async function runTutor(mode: "help" | "why_wrong" | "review") {
    setIsTutorLoading(true);
    setTutorError(null);
    try {
      const reply = await apiClient.post<TutorReply>(`/sessions/${sessionId}/questions/${question.id}/tutor`, { mode });
      setTutorReply(reply);
    } catch (error) {
      setTutorReply(null);
      setTutorError(readResultError(error, "Nao foi possivel consultar o tutor agora."));
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
      await apiClient.post(`/questions/${question.id}/issues`, {
        session_id: sessionId,
        mode: enableTutor ? "exam" : "review",
        category: issueCategory,
        message: issueMessage.trim()
      } satisfies QuestionIssueRequest);
      setIssueMessage("");
      setIssueNotice("Reporte enviado para o backlog editorial.");
    } catch (error) {
      setIssueNotice(readResultError(error, "Nao foi possivel reportar esta questao agora."));
    } finally {
      setIsIssueSubmitting(false);
    }
  }

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

      {enableTutor ? (
        <div className="sq-surface-block" style={{ marginTop: "var(--sq-space-4)" }}>
          <div className="sq-list-title">Tutor da questão</div>
          <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
            <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("help")}>
              Me explique
            </button>
            <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("why_wrong")}>
              Por que errei?
            </button>
            <button type="button" className="sq-chip" disabled={isTutorLoading} onClick={() => void runTutor("review")}>
              Revisar assunto
            </button>
          </div>
          {isTutorLoading ? <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-3)" }}>Consultando tutor...</div> : null}
          {tutorError ? <StatusBanner tone="warning" title="Tutor indisponível" message={tutorError} /> : null}
          {tutorReply ? (
            <StatusBanner
              tone={tutorReply.blocked ? "warning" : "neutral"}
              title={tutorReply.blocked ? "Tutor bloqueou esta análise" : "Tutor respondeu"}
              message={tutorReply.message}
            />
          ) : null}
        </div>
      ) : null}

      <div className="sq-surface-block" style={{ marginTop: "var(--sq-space-4)" }}>
        <div className="sq-list-title">Reportar questão</div>
        <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
          <select
            className="sq-select"
            value={issueCategory}
            onChange={(event) => setIssueCategory(event.target.value as QuestionIssueRequest["category"])}
          >
            <option value="clareza">Clareza</option>
            <option value="gabarito">Gabarito</option>
            <option value="explicacao">Explicação</option>
            <option value="referencia">Referência</option>
          </select>
        </div>
        <textarea
          className="sq-textarea"
          rows={3}
          value={issueMessage}
          onChange={(event) => setIssueMessage(event.target.value)}
          style={{ marginTop: "var(--sq-space-3)" }}
        />
        <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
          <button type="button" className="sq-chip" disabled={isIssueSubmitting || issueMessage.trim().length < 8} onClick={() => void runIssueReport()}>
            Enviar reporte
          </button>
        </div>
        {issueNotice ? <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-3)" }}>{issueNotice}</div> : null}
      </div>
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
  const resultInsight: ResultInsight | null = result?.insight || null;
  const studyPlan = resultInsight?.study_plan || [];
  const readinessScore = resultInsight?.readiness || null;

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
