"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { formatDateTime } from "@/lib/utils/format";
import type { Exam, ReviewQueueSnapshot, SessionResponse, StudySessionRequest } from "@/types/api";

const DEFAULT_REVIEW_QUEUE: ReviewQueueSnapshot = {
  due_count: 0,
  total_count: 0,
  next_due_at: null,
  recommended_batch_size: 0,
  state_breakdown: {
    due_now: 0,
    overdue: 0,
    at_risk: 0,
    scheduled: 0,
    mastered: 0
  },
  upcoming_load: [],
  goals: {
    daily_review_target: 0,
    weekly_review_target: 0,
    new_question_budget: 0
  },
  applied_filters: {},
  items: []
};

function readReviewError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel carregar a fila de revisao.";
}

function describeQueueState(item: ReviewQueueSnapshot["items"][number]): string {
  if (item.is_overdue) {
    return `atrasada ha ${item.overdue_days} dia(s)`;
  }
  if (item.state === "due_now") {
    return "vence hoje";
  }
  if (item.state === "at_risk") {
    return "vence em ate 48h";
  }
  if (item.state === "mastered") {
    return "ja consolidada";
  }
  return item.due_at ? `agendada para ${formatDateTime(item.due_at)}` : "agendada";
}

function buildReviewQueueQuery(
  examId: string,
  reviewState: string,
  bookmarksOnly: boolean,
  notesOnly: boolean
): string {
  const params = new URLSearchParams();
  if (examId) {
    params.set("exam_id", examId);
  }
  if (reviewState) {
    params.append("review_states", reviewState);
  }
  if (bookmarksOnly) {
    params.set("bookmarked_only", "true");
  }
  if (notesOnly) {
    params.set("notes_only", "true");
  }
  params.set("limit", "12");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function ReviewShell() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [exams, setExams] = useState<Exam[]>([]);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueSnapshot>(DEFAULT_REVIEW_QUEUE);

  const [selectedExamId, setSelectedExamId] = useState("");
  const [reviewStateFilter, setReviewStateFilter] = useState("");
  const [reviewBookmarksOnly, setReviewBookmarksOnly] = useState(false);
  const [reviewNotesOnly, setReviewNotesOnly] = useState(false);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    setPageNotice(null);

    const results = await Promise.allSettled([
      apiClient.get<Exam[]>("/exams"),
      apiClient.get<ReviewQueueSnapshot>(
        `/study/review/queue${buildReviewQueueQuery(selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly)}`
      )
    ]);

    if (results[0].status === "fulfilled") {
      setExams(results[0].value);
    } else {
      setExams([]);
      setPageNotice(readReviewError(results[0].reason));
    }

    if (results[1].status === "fulfilled") {
      setReviewQueue(results[1].value);
    } else {
      setReviewQueue(DEFAULT_REVIEW_QUEUE);
      setPageNotice(readReviewError(results[1].reason));
    }

    setIsLoading(false);
  });

  const refreshQueue = useEffectEvent(async () => {
    try {
      const snapshot = await apiClient.get<ReviewQueueSnapshot>(
        `/study/review/queue${buildReviewQueueQuery(selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly)}`
      );
      setReviewQueue(snapshot);
    } catch (error) {
      setPageNotice(readReviewError(error));
    }
  });

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (isLoading) {
      return;
    }
    void refreshQueue();
  }, [selectedExamId, reviewStateFilter, reviewBookmarksOnly, reviewNotesOnly, isLoading, refreshQueue]);

  async function startRecommendedReview() {
    setIsStartingReview(true);
    setPageNotice(null);

    try {
      const payload: StudySessionRequest = {
        exam_id: selectedExamId || null,
        total_questions: Math.max(reviewQueue.recommended_batch_size || 10, 1),
        domains: null,
        difficulties: null,
        tags: null,
        bookmarked_only: reviewBookmarksOnly,
        notes_only: reviewNotesOnly,
        incorrect_only: false,
        unseen_only: false,
        low_confidence_only: false,
        strategy: "review",
        queue_only: true,
        review_states: reviewStateFilter ? [reviewStateFilter] : null
      };

      const response = await apiClient.post<SessionResponse>("/study/review/sessions", payload);
      persistSessionId("study", response.id);
      startTransition(() => {
        router.push(`/study/${response.id}`);
      });
    } catch (error) {
      setPageNotice(readReviewError(error));
    } finally {
      setIsStartingReview(false);
    }
  }

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={320} />
        </div>
      </main>
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">Revisao</div>
              <p className="sq-page-subtitle">Priorize o que vence agora e mantenha a fila sob controle.</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/start">Iniciar</Link>
            <Link href="/history">Historico</Link>
          </div>
        </header>

        {pageNotice ? <StatusBanner tone="warning" title="Atencao" message={pageNotice} /> : null}

        <Card
          title="Fila de hoje"
          subtitle="Uma unica acao principal: revisar o que ja esta vencido."
          actions={
            <Button
              variant="secondary"
              size="sm"
              busy={isStartingReview}
              disabled={!reviewQueue.items.length}
              onClick={() => void startRecommendedReview()}
            >
              Revisar agora
            </Button>
          }
        >
          <div className="sq-metric-grid">
            <div className="sq-metric-card">
              <span className="sq-muted">Vencidas</span>
              <strong>{reviewQueue.due_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Total na fila</span>
              <strong>{reviewQueue.total_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Lote sugerido</span>
              <strong>{reviewQueue.recommended_batch_size || 0}</strong>
            </div>
          </div>
        </Card>

        <Card title="Refinar fila" subtitle="Ajuste o recorte sem transformar a revisao em um painel pesado.">
          <div className="sq-stack-md">
            <div className="sq-form-grid">
              <Field label="Certificacao" htmlFor="review-exam-filter">
                <select
                  id="review-exam-filter"
                  className="sq-select"
                  value={selectedExamId}
                  onChange={(event) => setSelectedExamId(event.target.value)}
                >
                  <option value="">Todas</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {exam.title}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Recorte" htmlFor="review-state-filter">
                <select
                  id="review-state-filter"
                  className="sq-select"
                  value={reviewStateFilter}
                  onChange={(event) => setReviewStateFilter(event.target.value)}
                >
                  <option value="">Tudo</option>
                  <option value="due_today">Vence hoje</option>
                  <option value="overdue">Atrasadas</option>
                  <option value="at_risk">Em risco</option>
                  <option value="scheduled">Agendadas</option>
                  <option value="mastered">Dominadas</option>
                </select>
              </Field>
            </div>

            <div className="sq-checkbox-grid">
              <label className="sq-checkbox-row">
                <input
                  type="checkbox"
                  checked={reviewBookmarksOnly}
                  onChange={(event) => setReviewBookmarksOnly(event.target.checked)}
                />
                So marcadas
              </label>
              <label className="sq-checkbox-row">
                <input type="checkbox" checked={reviewNotesOnly} onChange={(event) => setReviewNotesOnly(event.target.checked)} />
                So com nota
              </label>
            </div>
          </div>
        </Card>

        <Card title="Itens priorizados" subtitle="Os itens mais sensiveis ficam no topo.">
          {reviewQueue.items.length ? (
            <div className="sq-list">
              {reviewQueue.items.map((item) => (
                <div key={item.question_id} className="sq-list-item">
                  <div className="sq-list-title">{item.prompt}</div>
                  <div className="sq-list-meta">
                    {[item.certification, item.domain, item.state].filter(Boolean).join(" · ")} · {describeQueueState(item)}
                  </div>
                  {(item.bookmarked || item.has_note) ? (
                    <div className="sq-chip-row sq-gap-top-sm">
                      {item.bookmarked ? <span className="sq-chip">marcada</span> : null}
                      {item.has_note ? <span className="sq-chip">com nota</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <div className="sq-empty">Nenhum item de revisao pendente no momento.</div>
          )}
        </Card>
      </div>
    </main>
  );
}
