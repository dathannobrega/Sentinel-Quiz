"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
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
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  Exam,
  ReviewQueueGoals,
  ReviewQueueSnapshot,
  ReviewQueueStateBreakdown,
  SessionHistoryItem,
  SessionResponse,
  StudyHistoryItem,
  StudySessionRequest,
  StudyWeeklyAnalytics
} from "@/types/api";

const DEFAULT_REVIEW_QUEUE: ReviewQueueSnapshot = {
  due_count: 0,
  total_count: 0,
  next_due_at: null,
  recommended_batch_size: 0,
  state_breakdown: {
    due_now: 0,
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
  items: []
};

const DEFAULT_WEEKLY_ANALYTICS: StudyWeeklyAnalytics = {
  weeks: [],
  summary: {}
};

function readHistoryError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel carregar o historico agora.";
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(haystack: Array<string | null | undefined>, searchTerm: string): boolean {
  if (!searchTerm) {
    return true;
  }

  return haystack.some((item) => String(item || "").toLowerCase().includes(searchTerm));
}

function averageScore(items: Array<{ score_percent: number }>): number | null {
  if (!items.length) {
    return null;
  }

  return items.reduce((sum, item) => sum + item.score_percent, 0) / items.length;
}

function resolveExamResultHref(item: SessionHistoryItem): string {
  return `/exam/${item.id}/result`;
}

function resolveStudyResultHref(item: StudyHistoryItem): string {
  return `/study/${item.id}/result`;
}

function describeQueueState(item: ReviewQueueSnapshot["items"][number]): string {
  if (item.state === "due_now") {
    return item.overdue_days > 0 ? `vencida ha ${item.overdue_days} dia(s)` : "vence hoje";
  }
  if (item.state === "at_risk") {
    return "vence em ate 48h";
  }
  if (item.state === "mastered") {
    return "ja consolidada";
  }
  return item.due_at ? `agendada para ${formatDateTime(item.due_at)}` : "agendada";
}

export function HistoryShell() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingReview, setIsStartingReview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [exams, setExams] = useState<Exam[]>([]);
  const [examHistory, setExamHistory] = useState<SessionHistoryItem[]>([]);
  const [studyHistory, setStudyHistory] = useState<StudyHistoryItem[]>([]);
  const [weeklyAnalytics, setWeeklyAnalytics] = useState<StudyWeeklyAnalytics>(DEFAULT_WEEKLY_ANALYTICS);
  const [reviewQueue, setReviewQueue] = useState<ReviewQueueSnapshot>(DEFAULT_REVIEW_QUEUE);

  const [selectedExamId, setSelectedExamId] = useState("");
  const [minimumScore, setMinimumScore] = useState("0");
  const [searchValue, setSearchValue] = useState("");

  const deferredSearch = useDeferredValue(searchValue);
  const normalizedSearch = normalizeSearch(deferredSearch);
  const minimumScoreValue = Number(minimumScore || 0);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    setLoadError(null);

    const results = await Promise.allSettled([
      apiClient.get<Exam[]>("/exams"),
      apiClient.get<SessionHistoryItem[]>("/sessions/history?limit=80"),
      apiClient.get<StudyHistoryItem[]>("/study/history?limit=80"),
      apiClient.get<StudyWeeklyAnalytics>("/study/analytics/weekly?weeks=8"),
      apiClient.get<ReviewQueueSnapshot>("/study/review/queue")
    ]);

    const failed: string[] = [];

    if (results[0].status === "fulfilled") {
      setExams(results[0].value);
    } else {
      setExams([]);
      failed.push("provas");
    }

    if (results[1].status === "fulfilled") {
      setExamHistory(results[1].value);
    } else {
      setExamHistory([]);
      failed.push("simulados");
    }

    if (results[2].status === "fulfilled") {
      setStudyHistory(results[2].value);
    } else {
      setStudyHistory([]);
      failed.push("estudo");
    }

    if (results[3].status === "fulfilled") {
      setWeeklyAnalytics(results[3].value);
    } else {
      setWeeklyAnalytics(DEFAULT_WEEKLY_ANALYTICS);
      failed.push("analytics semanal");
    }

    if (results[4].status === "fulfilled") {
      setReviewQueue(results[4].value);
    } else {
      setReviewQueue(DEFAULT_REVIEW_QUEUE);
      failed.push("fila de revisao");
    }

    if (failed.length) {
      setLoadError(`Alguns blocos falharam ao carregar: ${failed.join(", ")}.`);
    }

    setIsLoading(false);
  });

  useEffect(() => {
    void load();
  }, []);

  const filteredExamHistory = useMemo(() => {
    return examHistory.filter((item) => {
      const matchesExam = !selectedExamId || item.exam_id === selectedExamId;
      const matchesMinScore = item.score_percent >= minimumScoreValue;
      const matchesText = matchesSearch([item.exam_title, item.exam_id, item.selection_strategy], normalizedSearch);
      return matchesExam && matchesMinScore && matchesText;
    });
  }, [examHistory, selectedExamId, minimumScoreValue, normalizedSearch]);

  const filteredStudyHistory = useMemo(() => {
    return studyHistory.filter((item) => {
      const matchesExam = !selectedExamId || item.exam_id === selectedExamId;
      const matchesMinScore = item.score_percent >= minimumScoreValue;
      const matchesText = matchesSearch(
        [item.exam_title, item.exam_id, item.selection_strategy, ...(item.weakest_domains || [])],
        normalizedSearch
      );
      return matchesExam && matchesMinScore && matchesText;
    });
  }, [studyHistory, selectedExamId, minimumScoreValue, normalizedSearch]);

  const examAverage = averageScore(filteredExamHistory);
  const studyAverage = averageScore(filteredStudyHistory);
  const recommendation = String(weeklyAnalytics.summary.recommendation || "").trim();
  const reviewStateBreakdown: ReviewQueueStateBreakdown =
    weeklyAnalytics.summary.review_state_breakdown || reviewQueue.state_breakdown;
  const weeklyGoal: ReviewQueueGoals & {
    weekly_question_target?: number;
    weekly_new_question_target?: number;
    completion_ratio_percent?: number;
    suggested_daily_question_target?: number;
    suggested_daily_review_target?: number;
    on_track?: boolean;
  } = {
    daily_review_target: reviewQueue.goals.daily_review_target,
    weekly_review_target: reviewQueue.goals.weekly_review_target,
    new_question_budget: reviewQueue.goals.new_question_budget,
    ...(weeklyAnalytics.summary.weekly_goal || {})
  };
  const reviewForecast = weeklyAnalytics.summary.review_forecast;

  async function startRecommendedReview() {
    setIsStartingReview(true);
    setPageNotice(null);

    try {
      const payload: StudySessionRequest = {
        exam_id: selectedExamId || null,
        total_questions: Math.max(reviewQueue.recommended_batch_size || 10, 1),
        domains: null,
        question_ids: null,
        strategy: "review",
        queue_only: true
      };

      const response = await apiClient.post<SessionResponse>("/study/review/sessions", payload);
      persistSessionId("study", response.id);
      startTransition(() => {
        router.push(`/study/${response.id}`);
      });
    } catch (error) {
      setPageNotice(readHistoryError(error));
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
          <Skeleton height={420} />
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
              <div className="sq-page-title">Historico e analytics</div>
              <p className="sq-page-subtitle">
                Historico consolidado de simulados, estudo, fila de revisao e ritmo semanal, agora no frontend Next.
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/">Dashboard</Link>
            <Link href="/">Nova sessao</Link>
            <Link href="/admin">Admin</Link>
          </div>
        </header>

        {loadError ? <StatusBanner tone="warning" title="Carga parcial" message={loadError} /> : null}
        {pageNotice ? <StatusBanner tone="warning" title="Atencao" message={pageNotice} /> : null}

        <Card title="Filtros" subtitle="Refine a leitura do historico sem recarregar a pagina.">
          <div className="sq-form-grid">
            <Field label="Prova" htmlFor="history-exam-filter">
              <select
                id="history-exam-filter"
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

            <Field label="Nota minima" htmlFor="history-score-filter">
              <select
                id="history-score-filter"
                className="sq-select"
                value={minimumScore}
                onChange={(event) => setMinimumScore(event.target.value)}
              >
                <option value="0">Todas</option>
                <option value="70">70%+</option>
                <option value="80">80%+</option>
                <option value="90">90%+</option>
              </select>
            </Field>

            <Field
              label="Busca"
              htmlFor="history-search-filter"
              hint="Procure por prova, estrategia ou dominios fracos do study."
            >
              <input
                id="history-search-filter"
                className="sq-input"
                type="search"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
            </Field>
          </div>
        </Card>

        <div className="sq-grid-2">
          <Card title="Resumo" subtitle="Leitura rapida do volume e da tendencia atual.">
            <div className="sq-metric-grid">
              <div className="sq-metric-card">
                <span className="sq-muted">Simulados filtrados</span>
                <strong>{filteredExamHistory.length}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Media dos simulados</span>
                <strong>{examAverage === null ? "-" : formatScore(examAverage)}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Media do study</span>
                <strong>{studyAverage === null ? "-" : formatScore(studyAverage)}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Fila vencida</span>
                <strong>{reviewQueue.due_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Fila total</span>
                <strong>{reviewQueue.total_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Em risco</span>
                <strong>{reviewStateBreakdown.at_risk}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Dominadas</span>
                <strong>{reviewStateBreakdown.mastered}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Proxima revisao</span>
                <strong>{reviewQueue.next_due_at ? formatDateTime(reviewQueue.next_due_at) : "-"}</strong>
              </div>
            </div>

            {recommendation ? (
              <div className="sq-empty" style={{ marginTop: "var(--sq-space-4)" }}>
                {recommendation}
              </div>
            ) : null}
          </Card>

          <Card title="Meta semanal" subtitle="Um alvo pratico para equilibrar estudo novo e revisao.">
            <div className="sq-metric-grid">
              <div className="sq-metric-card">
                <span className="sq-muted">Meta de questoes</span>
                <strong>{weeklyGoal.weekly_question_target || 0}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Meta de revisoes</span>
                <strong>{weeklyGoal.weekly_review_target || 0}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Novas sugeridas</span>
                <strong>{weeklyGoal.weekly_new_question_target ?? weeklyGoal.new_question_budget}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Conclusao</span>
                <strong>
                  {weeklyGoal.completion_ratio_percent === undefined ? "-" : `${weeklyGoal.completion_ratio_percent}%`}
                </strong>
              </div>
            </div>

            <div className="sq-list" style={{ marginTop: "var(--sq-space-4)" }}>
              <div className="sq-list-item">
                <div className="sq-list-title">
                  {weeklyGoal.on_track === false ? "Voce esta abaixo da meta" : "Ritmo semanal em linha"}
                </div>
                <div className="sq-list-meta">
                  Proximo passo recomendado: {weeklyGoal.suggested_daily_question_target || 0} nova(s) +{" "}
                  {weeklyGoal.suggested_daily_review_target || weeklyGoal.daily_review_target || 0} revisao(oes) por dia.
                </div>
              </div>
            </div>
          </Card>

          <Card title="Carga prevista" subtitle="Antecipe picos da fila para nao virar backlog.">
            <div className="sq-metric-grid">
              <div className="sq-metric-card">
                <span className="sq-muted">Vencem em 7 dias</span>
                <strong>{reviewForecast?.projected_due_next_7_days || 0}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Entram em risco</span>
                <strong>{reviewForecast?.projected_at_risk_next_7_days || 0}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Pico diario</span>
                <strong>{reviewForecast?.peak_load_day || 0}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Pressao</span>
                <strong>{String(reviewForecast?.pressure || "stable")}</strong>
              </div>
            </div>

            {reviewQueue.upcoming_load.length ? (
              <div className="sq-list" style={{ marginTop: "var(--sq-space-4)" }}>
                {reviewQueue.upcoming_load.map((day) => (
                  <div key={day.date} className="sq-list-item">
                    <div className="sq-list-title">{day.label}</div>
                    <div className="sq-list-meta">
                      {day.due_count} vencendo · {day.at_risk_count} entrando em risco
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty" style={{ marginTop: "var(--sq-space-4)" }}>
                Sem carga futura relevante no momento.
              </div>
            )}
          </Card>

          <Card
            title="Fila de revisao"
            subtitle="Os itens com maior pressao de retorno aparecem primeiro."
            actions={
              <Button
                variant="secondary"
                size="sm"
                busy={isStartingReview}
                disabled={!reviewQueue.items.length}
                onClick={() => void startRecommendedReview()}
              >
                Iniciar revisao
              </Button>
            }
          >
            {reviewQueue.items.length ? (
              <div className="sq-list">
                {reviewQueue.items.slice(0, 6).map((item) => (
                  <div key={item.question_id} className="sq-list-item">
                    <div className="sq-list-title">{item.prompt}</div>
                    <div className="sq-list-meta">
                      {[item.certification, item.domain, item.state].filter(Boolean).join(" · ")} · {describeQueueState(item)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty">Nenhum item de revisao pendente no momento.</div>
            )}
          </Card>
        </div>

        <Card title="Ritmo semanal" subtitle="Volume, revisoes e qualidade por semana.">
          {weeklyAnalytics.weeks.length ? (
            <div className="sq-progress-list">
              {weeklyAnalytics.weeks.map((week) => (
                <div key={week.week_start} className="sq-surface-block">
                  <div className="sq-progress-head">
                    <div>
                      <div className="sq-list-title">{week.label}</div>
                      <div className="sq-progress-meta">
                        Estudo: {week.study_questions} · Revisao: {week.review_questions} · Sessoes:{" "}
                        {week.completed_sessions}
                      </div>
                    </div>
                    <div className="sq-progress-meta">{week.accuracy_percent}% de precisao</div>
                  </div>
                  <div className="sq-progress-track" aria-hidden="true">
                    <div className="sq-progress-fill" style={{ width: `${Math.max(0, Math.min(100, week.accuracy_percent))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="sq-empty">Sem dados semanais suficientes ainda.</div>
          )}
        </Card>

        <div className="sq-grid-2">
          <Card title="Simulados" subtitle="Cada item abre a revisao da sessao correspondente.">
            {filteredExamHistory.length ? (
              <div className="sq-list">
                {filteredExamHistory.map((item) => (
                  <Link
                    key={item.id}
                    href={resolveExamResultHref(item)}
                    className="sq-list-item"
                    style={{ display: "block", textDecoration: "none" }}
                  >
                    <div className="sq-list-title">{item.exam_title || item.exam_id || "Sessao mista"}</div>
                    <div className="sq-list-meta">
                      {formatScore(item.score_percent)} · {item.correct_count}/{item.total_questions} corretas ·{" "}
                      {formatDateTime(item.completed_at)}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="sq-empty">Nenhum simulado encontrado para os filtros atuais.</div>
            )}
          </Card>

          <Card title="Study Mode" subtitle="Blocos de estudo, confianca e dominios mais sensiveis.">
            {filteredStudyHistory.length ? (
              <div className="sq-list">
                {filteredStudyHistory.map((item) => (
                  <Link
                    key={item.id}
                    href={resolveStudyResultHref(item)}
                    className="sq-list-item"
                    style={{ display: "block", textDecoration: "none" }}
                  >
                    <div className="sq-list-title">{item.exam_title || item.exam_id || "Bloco misto"}</div>
                    <div className="sq-list-meta">
                      {formatScore(item.score_percent)} · estrategia {item.selection_strategy} ·{" "}
                      {formatDateTime(item.completed_at)}
                    </div>
                    {item.weakest_domains.length ? (
                      <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
                        {item.weakest_domains.slice(0, 3).map((label) => (
                          <span key={`${item.id}-${label}`} className="sq-chip">
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            ) : (
              <div className="sq-empty">Nenhum bloco de estudo encontrado para os filtros atuais.</div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
