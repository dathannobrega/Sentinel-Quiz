"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { apiClient } from "@/lib/api/client";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  ActiveSessionItem,
  EngagementSnapshot,
  SessionHistoryItem,
  StudyOverview,
  WeakAreasResponse
} from "@/types/api";

const DEFAULT_STUDY_OVERVIEW: StudyOverview = {
  scope: "device",
  bookmark_count: 0,
  note_count: 0,
  due_review_count: 0,
  next_due_at: null,
  recent_bookmarks: [],
  recent_notes: [],
  due_reviews: []
};

const DEFAULT_ENGAGEMENT: EngagementSnapshot = {
  daily_goal: { target: 10, completed: 0, remaining: 10, progress_percent: 0, reached: false },
  daily_review_goal: { target: 5, completed: 0, remaining: 5, progress_percent: 0, reached: false },
  weekly_goal: { target: 50, completed: 0, remaining: 50, progress_percent: 0, reached: false },
  weekly_review_goal: { target: 30, completed: 0, remaining: 30, progress_percent: 0, reached: false },
  streak: { current_days: 0, best_days: 0, total_active_days: 0, goal_completed_today: false },
  adaptive_profile: { recovery_mode: false, low_confidence_bias: 0, variety_floor_percent: 0, focus_domains: [] },
  review_backlog_due: 0,
  recommended_next_action: "Comece uma sessao curta para retomar o ritmo."
};

export function DashboardShell() {
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [weakAreas, setWeakAreas] = useState<WeakAreasResponse["certifications"]>([]);
  const [engagement, setEngagement] = useState<EngagementSnapshot>(DEFAULT_ENGAGEMENT);
  const [studyOverview, setStudyOverview] = useState<StudyOverview>(DEFAULT_STUDY_OVERVIEW);
  const [examHistory, setExamHistory] = useState<SessionHistoryItem[]>([]);
  const [activeExamSessions, setActiveExamSessions] = useState<ActiveSessionItem[]>([]);
  const [activeStudySessions, setActiveStudySessions] = useState<ActiveSessionItem[]>([]);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    await refreshDashboard();
    setIsLoading(false);
  });

  async function refreshDashboard() {
    setIsRefreshing(true);
    setLoadError(null);

    const results = await Promise.allSettled([
      apiClient.get<WeakAreasResponse>("/analytics/weak-areas"),
      apiClient.get<EngagementSnapshot>("/analytics/engagement"),
      apiClient.get<StudyOverview>("/study/overview"),
      apiClient.get<SessionHistoryItem[]>("/sessions/history?limit=6"),
      apiClient.get<ActiveSessionItem[]>("/sessions/active?limit=3"),
      apiClient.get<ActiveSessionItem[]>("/study/sessions/active?limit=3")
    ]);

    const failedLabels: string[] = [];

    if (results[0].status === "fulfilled") {
      setWeakAreas(results[0].value.certifications);
    } else {
      setWeakAreas([]);
      failedLabels.push("lacunas");
    }

    if (results[1].status === "fulfilled") {
      setEngagement(results[1].value);
    } else {
      setEngagement(DEFAULT_ENGAGEMENT);
      failedLabels.push("ritmo");
    }

    if (results[2].status === "fulfilled") {
      setStudyOverview(results[2].value);
    } else {
      setStudyOverview(DEFAULT_STUDY_OVERVIEW);
      failedLabels.push("revisao");
    }

    if (results[3].status === "fulfilled") {
      setExamHistory(results[3].value);
    } else {
      setExamHistory([]);
      failedLabels.push("historico");
    }

    if (results[4].status === "fulfilled") {
      setActiveExamSessions(results[4].value);
    } else {
      setActiveExamSessions([]);
      failedLabels.push("sessoes de simulado");
    }

    if (results[5].status === "fulfilled") {
      setActiveStudySessions(results[5].value);
    } else {
      setActiveStudySessions([]);
      failedLabels.push("sessoes de estudo");
    }

    if (failedLabels.length) {
      setLoadError(`Nem tudo foi carregado: ${failedLabels.join(", ")}.`);
    }

    setIsRefreshing(false);
  }

  useEffect(() => {
    void load();
  }, [load]);

  const latestExam = examHistory[0] || null;
  const activeSessions = useMemo(() => {
    const examItems = activeExamSessions.map((session) => ({ ...session, modeLabel: "Simulado", href: `/exam/${session.id}` }));
    const studyItems = activeStudySessions.map((session) => ({ ...session, modeLabel: "Estudo", href: `/study/${session.id}` }));
    return [...examItems, ...studyItems].slice(0, 3);
  }, [activeExamSessions, activeStudySessions]);

  const weakFocus = useMemo(() => {
    return weakAreas
      .map((track) => {
        const focusLabel = track.focus_domain?.label || track.domains[0]?.label || track.certification;
        return {
          id: `${track.certification}-${focusLabel}`,
          title: focusLabel,
          meta: track.message
        };
      })
      .slice(0, 3);
  }, [weakAreas]);

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <div className="sq-grid-3">
            <Skeleton height={240} />
            <Skeleton height={240} />
            <Skeleton height={240} />
          </div>
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
              <div className="sq-page-title">Hoje</div>
              <p className="sq-page-subtitle">Seu foco de hoje: revisar o que venceu e manter consistencia.</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/start">Iniciar</Link>
            <Link href="/review">Revisao</Link>
            <Link href="/settings">Configuracoes</Link>
          </div>
        </header>

        {loadError ? <StatusBanner tone="warning" title="Carga parcial" message={loadError} /> : null}

        <div className="sq-grid-3">
          <Card
            title="Hoje"
            subtitle="Uma acao principal: limpar o que esta vencido."
            actions={
              <Link href="/review" className="sq-button sq-button--sm sq-button--primary">
                Revisar agora
              </Link>
            }
          >
            <div className="sq-stack-md">
              <div className="sq-metric-grid">
                <div className="sq-metric-card">
                  <span className="sq-muted">Revisoes vencidas</span>
                  <strong>{studyOverview.due_review_count}</strong>
                </div>
                <div className="sq-metric-card">
                  <span className="sq-muted">Progresso diario</span>
                  <strong>
                    {engagement.daily_goal.completed}/{engagement.daily_goal.target}
                  </strong>
                </div>
                <div className="sq-metric-card">
                  <span className="sq-muted">Ultimo score</span>
                  <strong>{latestExam ? formatScore(latestExam.score_percent) : "-"}</strong>
                </div>
              </div>

              <div className="sq-list-item">
                <div className="sq-list-title">Proximo passo</div>
                <div className="sq-list-meta">{engagement.recommended_next_action}</div>
              </div>
            </div>
          </Card>

          <Card
            title="Continuar"
            subtitle="Retome apenas o que ainda faz sentido."
            actions={
              <Link href="/start" className="sq-text-link">
                Nova sessao
              </Link>
            }
          >
            {activeSessions.length ? (
              <div className="sq-list">
                {activeSessions.map((session) => (
                  <div key={session.id} className="sq-list-item">
                    <div className="sq-list-title">{session.exam_title || `${session.modeLabel} misto`}</div>
                    <div className="sq-list-meta">
                      {session.modeLabel} · {session.answered_count}/{session.total_questions} · {session.progress_percent}%
                    </div>
                    <Link href={session.href} className="sq-text-link">
                      Retomar
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty">Nenhuma sessao ativa. Abra um novo bloco quando quiser.</div>
            )}
          </Card>

          <Card
            title="Pontos fracos"
            subtitle="Somente os sinais mais uteis para decidir o proximo bloco."
            actions={
              <Link href="/history" className="sq-text-link">
                Ver detalhes
              </Link>
            }
          >
            {weakFocus.length ? (
              <div className="sq-list">
                {weakFocus.map((item) => (
                  <div key={item.id} className="sq-list-item">
                    <div className="sq-list-title">{item.title}</div>
                    <div className="sq-list-meta">{item.meta}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sq-empty">Sem historico suficiente para destacar lacunas ainda.</div>
            )}
          </Card>
        </div>

        <Card
          title="Resumo rapido"
          subtitle="Contexto minimo para nao perder o ritmo."
          actions={
            <Link href="/history" className="sq-button sq-button--sm sq-button--ghost">
              Abrir historico
            </Link>
          }
        >
          <div className="sq-metric-grid">
            <div className="sq-metric-card">
              <span className="sq-muted">Streak atual</span>
              <strong>{engagement.streak.current_days}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Melhor streak</span>
              <strong>{engagement.streak.best_days}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Semana</span>
              <strong>
                {engagement.weekly_goal.completed}/{engagement.weekly_goal.target}
              </strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Meta de revisao</span>
              <strong>
                {engagement.daily_review_goal.completed}/{engagement.daily_review_goal.target}
              </strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Proxima revisao</span>
              <strong>{studyOverview.next_due_at ? formatDateTime(studyOverview.next_due_at) : "-"}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Atualizacao</span>
              <strong>{isRefreshing ? "Atualizando" : "Em dia"}</strong>
            </div>
          </div>
        </Card>
      </div>
    </main>
  );
}
