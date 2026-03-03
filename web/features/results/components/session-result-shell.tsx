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

function readResultError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel carregar o resultado desta sessao.";
}

function renderInsightLines(result: ExamResult | StudyResult): string[] {
  const summary = (result.insight?.summary as Record<string, unknown> | undefined) || {};
  const lines: string[] = [];

  const attempted = summary.attempted;
  if (typeof attempted === "number") {
    lines.push(`Respondidas: ${attempted}`);
  } else if ("answered_count" in result) {
    lines.push(`Respondidas: ${result.answered_count}`);
  }

  const accuracy = summary.accuracy_percent;
  if (typeof accuracy === "number") {
    lines.push(`Precisao: ${accuracy}%`);
  }

  const avgSeconds = summary.avg_seconds_per_question;
  if (typeof avgSeconds === "number") {
    lines.push(`Media por questao: ${avgSeconds}s`);
  }

  const weakestDomains = result.insight?.weakest_domains;
  if (Array.isArray(weakestDomains) && weakestDomains.length) {
    const first = weakestDomains[0] as { label?: string; wrong?: number } | string;
    if (typeof first === "string") {
      lines.push(`Dominio mais sensivel: ${first}`);
    } else if (first && typeof first === "object" && first.label) {
      lines.push(`Dominio mais sensivel: ${first.label} (${first.wrong ?? 0} erro(s))`);
    }
  }

  if ("review_due_count" in result && typeof result.review_due_count === "number") {
    lines.push(`Fila vencida apos o bloco: ${result.review_due_count}`);
  }

  return lines;
}

function resolveReadiness(scorePercent: number): { label: string } {
  if (scorePercent >= 90) {
    return { label: "Excelente" };
  }
  if (scorePercent >= 80) {
    return { label: "Bom" };
  }
  if (scorePercent >= 70) {
    return { label: "Ok" };
  }
  return { label: "Em ajuste" };
}

function CitationLinks({ citations }: { citations?: CitationItem[] | null }) {
  if (!citations?.length) {
    return null;
  }

  const previewLinks = citations
    .map((citation) => ({
      label: String(citation.reference || citation.source || "Abrir material"),
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
  question
}: {
  index: number;
  question: ReviewQuestion | StudyReviewQuestion;
}) {
  const questionNumber = "question_number" in question ? question.question_number : index + 1;

  return (
    <AccordionItem
      title={`Questao ${questionNumber}`}
      subtitle={[question.certification, question.domain, question.difficulty].filter(Boolean).join(" · ") || "Sem metadados"}
      meta={
        <span className={cn("sq-chip", question.is_correct ? "sq-chip--success" : "sq-chip--danger")}>
          {question.is_correct ? "Correta" : "Errada"}
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
                  {isCorrect ? " (correta)" : ""}
                  {!isCorrect && isSelected ? " (sua escolha)" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {question.justification ? <EmptyState size="compact" description={question.justification} /> : null}
      <CitationLinks citations={question.citations} />
    </AccordionItem>
  );
}

export function SessionResultShell({ sessionId, mode }: SessionResultShellProps) {
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
      setLoadError(readResultError(error));
    } finally {
      setIsLoading(false);
    }
  });

  useEffect(() => {
    void load();
  }, [sessionId, mode, load]);

  const result = review?.result || null;
  const reviewQuestions = review?.questions || [];
  const insightLines = useMemo(() => (result ? renderInsightLines(result) : []), [result]);

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
            title="Nao foi possivel carregar o resultado"
            message={loadError || "A sessao nao retornou dados de revisao."}
            role="alert"
            action={<Link href="/dashboard">Voltar ao dashboard</Link>}
          />
        </div>
      </main>
    );
  }

  const sessionMeta = review.session;
  const examResult = mode === "exam" ? (result as ExamResult) : null;
  const readiness = resolveReadiness(result.score_percent);
  const headerCopy =
    mode === "study"
      ? `${formatScore(result.score_percent)} de aproveitamento em estudo`
      : `${formatScore(result.score_percent)} de score · prontidao ${readiness.label.toLowerCase()}`;

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">Resultado da sessao</div>
              <p className="sq-page-subtitle">
                {sessionMeta.exam_title || sessionMeta.exam_id || "Sessao mista"} · concluida em{" "}
                {formatDateTime(sessionMeta.completed_at)}
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/history">Historico</Link>
            <Link href="/admin">Administracao</Link>
            <Link href="/start">Iniciar nova sessao</Link>
          </div>
        </header>

        <Card title={headerCopy} subtitle={`Estrategia ${result.strategy}.`}>
          <div className="sq-surface-block">
            <div className="sq-metric-grid">
              <MetricCard label="Score" value={formatScore(result.score_percent)} />
              <MetricCard label="Prontidao" value={readiness.label} />
              <MetricCard label="Acertos" value={result.correct_count} />
              <MetricCard label="Erros" value={result.wrong_count} />
              <MetricCard
                label={mode === "study" ? "Respondidas" : "Questoes"}
                value={"answered_count" in result ? result.answered_count : result.total_questions}
              />
              {examResult?.time_spent_seconds !== undefined && examResult?.time_spent_seconds !== null ? (
                <MetricCard
                  label="Tempo usado"
                  value={`${Math.max(Math.round(examResult.time_spent_seconds / 60), 1)} min`}
                />
              ) : null}
              {examResult?.time_limit_seconds !== undefined && examResult?.time_limit_seconds !== null ? (
                <MetricCard
                  label="Limite"
                  value={`${Math.max(Math.round(examResult.time_limit_seconds / 60), 1)} min`}
                />
              ) : null}
            </div>

            {examResult?.timed_out ? (
              <StatusBanner
                tone="warning"
                title="Simulado encerrado por tempo"
                message="O backend aplicou auto-submit quando o cronometro zerou. Revise primeiro os itens errados e os que ficaram sem resposta."
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
          title="Revisao guiada"
          subtitle="Abra cada questao apenas quando precisar revisar o detalhe."
          actions={<span className="sq-chip">{reviewQuestions.length} questoes</span>}
        >
          {reviewQuestions.length ? (
            <Accordion>
              {reviewQuestions.map((question, index) => (
                <ReviewBlock key={`${question.id}-${index}`} index={index} question={question} />
              ))}
            </Accordion>
          ) : (
            <EmptyState description="Nenhuma questao foi encontrada para esta revisao." />
          )}
        </Card>
      </div>
    </main>
  );
}
