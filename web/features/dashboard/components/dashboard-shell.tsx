"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { fetchCurrentUser, logoutUser } from "@/lib/auth/session";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  ActiveSessionItem,
  AuthUser,
  DomainCatalogResponse,
  EngagementSnapshot,
  Exam,
  HealthResponse,
  QuestionSearchResponse,
  SessionHistoryItem,
  SessionRequest,
  SessionResponse,
  StudyHistoryItem,
  StudyOverview,
  StudySessionRequest,
  WeakAreasResponse
} from "@/types/api";

import { AccountPanel } from "@/features/dashboard/components/account-panel";
import { ExamLauncher } from "@/features/dashboard/components/exam-launcher";
import { InsightsPanel } from "@/features/dashboard/components/insights-panel";
import type { DashboardNotice, LaunchFormValues } from "@/features/dashboard/types";

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
  recommended_next_action: "Comece uma sessao curta para ativar o ritmo de estudo."
};

const DEFAULT_LAUNCH_FORM: LaunchFormValues = {
  examId: "",
  domain: "",
  difficultyQuery: "",
  tagQuery: "",
  bookmarkedOnly: false,
  notesOnly: false,
  incorrectOnly: false,
  unseenOnly: false,
  lowConfidenceOnly: false,
  mode: "exam",
  examStrategy: "standard",
  studyStrategy: "standard",
  totalQuestions: 90,
  timeLimitMinutes: 90
};

const DASHBOARD_LAUNCH_STORAGE_KEY = "sentinel.dashboard.launch_filters";
const DASHBOARD_DISCOVERY_STORAGE_KEY = "sentinel.dashboard.discovery_filters";

interface DiscoveryFilters {
  query: string;
  domain: string;
  tag: string;
  bookmarkedOnly: boolean;
  notesOnly: boolean;
}

const DEFAULT_DISCOVERY_FILTERS: DiscoveryFilters = {
  query: "",
  domain: "",
  tag: "",
  bookmarkedOnly: false,
  notesOnly: false
};

function toDashboardNotice(
  tone: DashboardNotice["tone"],
  title: string,
  message: string
): DashboardNotice {
  return { tone, title, message };
}

function readErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Ocorreu um erro inesperado.";
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function parseCsvFilter(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

function computeHeroStats(history: SessionHistoryItem[], dueReviewCount: number) {
  const latest = history[0] || null;
  const best = [...history].sort((left, right) => right.score_percent - left.score_percent)[0] || null;
  const averageBase = history.slice(0, 5);
  const average =
    averageBase.length > 0
      ? averageBase.reduce((sum, item) => sum + item.score_percent, 0) / averageBase.length
      : null;

  return {
    latest,
    best,
    average,
    totalSessions: history.length,
    dueReviewCount
  };
}

export function DashboardShell() {
  const router = useRouter();
  const runtimeConfig = getRuntimeConfig();
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDomainLoading, setIsDomainLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<"logout" | "launch" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<DashboardNotice | null>(null);
  const [launchNotice, setLaunchNotice] = useState<DashboardNotice | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [domains, setDomains] = useState<DomainCatalogResponse["domains"]>([]);
  const [weakAreas, setWeakAreas] = useState<WeakAreasResponse["certifications"]>([]);
  const [studyOverview, setStudyOverview] = useState<StudyOverview>(DEFAULT_STUDY_OVERVIEW);
  const [engagement, setEngagement] = useState<EngagementSnapshot>(DEFAULT_ENGAGEMENT);
  const [examHistory, setExamHistory] = useState<SessionHistoryItem[]>([]);
  const [studyHistory, setStudyHistory] = useState<StudyHistoryItem[]>([]);
  const [activeExamSessions, setActiveExamSessions] = useState<ActiveSessionItem[]>([]);
  const [activeStudySessions, setActiveStudySessions] = useState<ActiveSessionItem[]>([]);
  const [discoveryFilters, setDiscoveryFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [questionSearch, setQuestionSearch] = useState<QuestionSearchResponse>({
    items: [],
    total: 0,
    limit: 8,
    offset: 0,
    applied_filters: {}
  });
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);

  const [launchValues, setLaunchValues] = useState<LaunchFormValues>(DEFAULT_LAUNCH_FORM);

  function updateLaunchValue(field: keyof LaunchFormValues, value: LaunchFormValues[keyof LaunchFormValues]) {
    setLaunchNotice(null);
    setLaunchValues((current) => {
      const nextState = { ...current, [field]: value } as LaunchFormValues;
      if (field === "examId") {
        nextState.domain = "";
      }
      return nextState;
    });
  }

  const boot = useEffectEvent(async () => {
    setIsLoading(true);
    await syncCurrentUser();
    await refreshDashboard();
    setIsLoading(false);
  });

  const loadDomains = useEffectEvent(async (examId: string) => {
    setIsDomainLoading(true);
    try {
      const query = examId ? `?exam_id=${encodeURIComponent(examId)}` : "";
      const response = await apiClient.get<DomainCatalogResponse>(`/domains${query}`);
      setDomains(response.domains);
    } catch (_error) {
      setDomains([]);
    } finally {
      setIsDomainLoading(false);
    }
  });

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const rawLaunch = window.localStorage.getItem(DASHBOARD_LAUNCH_STORAGE_KEY);
      if (rawLaunch) {
        const parsed = JSON.parse(rawLaunch) as Partial<LaunchFormValues>;
        setLaunchValues((current) => ({ ...current, ...parsed }));
      }
      const rawDiscovery = window.localStorage.getItem(DASHBOARD_DISCOVERY_STORAGE_KEY);
      if (rawDiscovery) {
        const parsed = JSON.parse(rawDiscovery) as Partial<DiscoveryFilters>;
        setDiscoveryFilters((current) => ({ ...current, ...parsed }));
      }
    } catch {
      // Keep defaults if local cache is invalid.
    }
  }, []);

  useEffect(() => {
    void loadDomains(launchValues.examId);
  }, [launchValues.examId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DASHBOARD_LAUNCH_STORAGE_KEY, JSON.stringify(launchValues));
  }, [launchValues]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DASHBOARD_DISCOVERY_STORAGE_KEY, JSON.stringify(discoveryFilters));
  }, [discoveryFilters]);

  async function syncCurrentUser() {
    try {
      setCurrentUser(await fetchCurrentUser());
    } catch (error) {
      setCurrentUser(null);
      if (!isUnauthorized(error)) {
        setAuthNotice(toDashboardNotice("warning", "Sessao indisponivel", readErrorMessage(error)));
      }
    }
  }

  async function refreshDashboard() {
    setIsRefreshing(true);
    setLoadError(null);

    const results = await Promise.allSettled([
      apiClient.get<HealthResponse>("/health"),
      apiClient.get<Exam[]>("/exams"),
      apiClient.get<WeakAreasResponse>("/analytics/weak-areas"),
      apiClient.get<EngagementSnapshot>("/analytics/engagement"),
      apiClient.get<StudyOverview>("/study/overview"),
      apiClient.get<SessionHistoryItem[]>("/sessions/history?limit=12"),
      apiClient.get<StudyHistoryItem[]>("/study/history?limit=12"),
      apiClient.get<ActiveSessionItem[]>("/sessions/active?limit=4"),
      apiClient.get<ActiveSessionItem[]>("/study/sessions/active?limit=4")
    ]);

    const failedLabels: string[] = [];

    if (results[0].status === "fulfilled") {
      setHealth(results[0].value);
    } else {
      failedLabels.push("health");
    }

    if (results[1].status === "fulfilled") {
      setExams(results[1].value);
    } else {
      setExams([]);
      failedLabels.push("lista de provas");
    }

    if (results[2].status === "fulfilled") {
      setWeakAreas(results[2].value.certifications);
    } else {
      setWeakAreas([]);
      failedLabels.push("mapa de lacunas");
    }

    if (results[3].status === "fulfilled") {
      setEngagement(results[3].value);
    } else {
      setEngagement(DEFAULT_ENGAGEMENT);
      failedLabels.push("ritmo e metas");
    }

    if (results[4].status === "fulfilled") {
      setStudyOverview(results[4].value);
    } else {
      setStudyOverview(DEFAULT_STUDY_OVERVIEW);
      failedLabels.push("overview de estudo");
    }

    if (results[5].status === "fulfilled") {
      setExamHistory(results[5].value);
    } else {
      setExamHistory([]);
      failedLabels.push("historico de simulados");
    }

    if (results[6].status === "fulfilled") {
      setStudyHistory(results[6].value);
    } else {
      setStudyHistory([]);
      failedLabels.push("historico de estudo");
    }

    if (results[7].status === "fulfilled") {
      setActiveExamSessions(results[7].value);
    } else {
      setActiveExamSessions([]);
      failedLabels.push("sessoes ativas de prova");
    }

    if (results[8].status === "fulfilled") {
      setActiveStudySessions(results[8].value);
    } else {
      setActiveStudySessions([]);
      failedLabels.push("sessoes ativas de estudo");
    }

    if (failedLabels.length) {
      setLoadError(
        `Nem todos os dados foram carregados. Revise: ${failedLabels.join(", ")}. O restante do dashboard continua funcional.`
      );
    }

    setIsRefreshing(false);
  }

  async function refreshQuestionSearch() {
    setIsDiscoveryLoading(true);
    try {
      const params = new URLSearchParams();
      if (launchValues.examId) {
        params.set("exam_id", launchValues.examId);
      }
      if (discoveryFilters.query.trim()) {
        params.set("query", discoveryFilters.query.trim());
      }
      if (discoveryFilters.domain) {
        params.set("domain", discoveryFilters.domain);
      }
      if (discoveryFilters.tag.trim()) {
        params.set("tag", discoveryFilters.tag.trim());
      }
      if (discoveryFilters.bookmarkedOnly) {
        params.set("bookmarked_only", "true");
      }
      if (discoveryFilters.notesOnly) {
        params.set("notes_only", "true");
      }
      params.set("limit", "8");

      const response = await apiClient.get<QuestionSearchResponse>(`/questions/search?${params.toString()}`);
      setQuestionSearch(response);
    } catch (error) {
      setLoadError(`Busca de questoes indisponivel: ${readErrorMessage(error)}`);
      setQuestionSearch({ items: [], total: 0, limit: 8, offset: 0, applied_filters: {} });
    } finally {
      setIsDiscoveryLoading(false);
    }
  }

  useEffect(() => {
    void refreshQuestionSearch();
  }, [
    discoveryFilters.query,
    discoveryFilters.domain,
    discoveryFilters.tag,
    discoveryFilters.bookmarkedOnly,
    discoveryFilters.notesOnly,
    launchValues.examId
  ]);

  async function handleLogout() {
    setPendingAction("logout");
    setAuthNotice(null);

    try {
      await logoutUser();
    } catch (error) {
      setAuthNotice(toDashboardNotice("danger", "Falha ao sair", readErrorMessage(error)));
    } finally {
      setCurrentUser(null);
      setPendingAction(null);
      setAuthNotice(toDashboardNotice("success", "Sessao encerrada", "Voce voltou ao modo local deste dispositivo."));
      await refreshDashboard();
    }
  }

  async function handleLaunch() {
    if (launchValues.totalQuestions < 1) {
      setLaunchNotice(
        toDashboardNotice("warning", "Quantidade invalida", "Informe pelo menos 1 questao para criar a sessao.")
      );
      return;
    }
    const maxQuestions = launchValues.mode === "study" ? 120 : 180;
    if (launchValues.totalQuestions > maxQuestions) {
      setLaunchNotice(
        toDashboardNotice(
          "warning",
          "Quantidade acima do limite",
          `O limite atual para ${launchValues.mode === "study" ? "study mode" : "exam mode"} é ${maxQuestions} questoes.`
        )
      );
      return;
    }
    if (launchValues.mode === "exam" && (launchValues.timeLimitMinutes < 5 || launchValues.timeLimitMinutes > 360)) {
      setLaunchNotice(
        toDashboardNotice("warning", "Tempo invalido", "O simulado precisa de um timer entre 5 e 360 minutos.")
      );
      return;
    }

    setPendingAction("launch");
    setLaunchNotice(null);

    try {
      const domains = launchValues.domain ? [launchValues.domain] : null;
      const difficulties = parseCsvFilter(launchValues.difficultyQuery);
      const tags = parseCsvFilter(launchValues.tagQuery);
      let session: SessionResponse;

      if (launchValues.mode === "study") {
        const payload: StudySessionRequest = {
          exam_id: launchValues.examId || null,
          total_questions: launchValues.totalQuestions,
          domains,
          difficulties,
          tags,
          bookmarked_only: launchValues.bookmarkedOnly,
          notes_only: launchValues.notesOnly,
          incorrect_only: launchValues.incorrectOnly,
          unseen_only: launchValues.unseenOnly,
          low_confidence_only: launchValues.lowConfidenceOnly,
          strategy: launchValues.studyStrategy,
          queue_only: false
        };
        session = await apiClient.post<SessionResponse>("/study/sessions", payload);
      } else {
        const payload: SessionRequest = {
          exam_id: launchValues.examId || null,
          total_questions: launchValues.totalQuestions,
          domains,
          difficulties,
          tags,
          bookmarked_only: launchValues.bookmarkedOnly,
          notes_only: launchValues.notesOnly,
          incorrect_only: launchValues.incorrectOnly,
          unseen_only: launchValues.unseenOnly,
          low_confidence_only: launchValues.lowConfidenceOnly,
          time_limit_minutes: launchValues.timeLimitMinutes,
          strategy: launchValues.examStrategy
        };
        session = await apiClient.post<SessionResponse>("/sessions", payload);
      }

      persistSessionId(launchValues.mode, session.id);
      await refreshDashboard();
      startTransition(() => {
        router.push(launchValues.mode === "study" ? `/study/${session.id}` : `/exam/${session.id}`);
      });
    } catch (error) {
      setLaunchNotice(toDashboardNotice("danger", "Nao foi possivel criar a sessao", readErrorMessage(error)));
    } finally {
      setPendingAction(null);
    }
  }

  const heroStats = computeHeroStats(examHistory, studyOverview.due_review_count);

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <div className="sq-skeleton-grid">
            <Skeleton height={220} />
            <Skeleton height={220} />
          </div>
          <Skeleton height={340} />
          <Skeleton height={340} />
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
              <div className="sq-page-title">Sentinel Quiz</div>
              <p className="sq-page-subtitle">
                Migracao incremental para Next.js App Router + TypeScript, preservando o backend e o fluxo atual.
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/history">Historico</Link>
            <Link href="/admin">Admin</Link>
          </div>
        </header>

        <section
          className="sq-card sq-hero"
          style={{
            border: "1px solid var(--sq-border)",
            borderRadius: "var(--sq-radius-lg)",
            background: "var(--sq-surface)",
            boxShadow: "var(--sq-shadow-lg)",
            padding: "var(--sq-space-6)"
          }}
        >
          <div className="sq-hero-copy">
            <div className="sq-eyebrow">Jornada principal migrada</div>
            <h1 className="sq-hero-title">Dashboard, prova, revisao e edicao agora rodam no app React.</h1>
            <p className="sq-hero-lead">
              O frontend Next agora cobre a trilha principal do aluno e o painel editorial, com estados tipados,
              integracao direta com o backend, navegacao consistente e o legado mantido apenas como fallback de
              rollback durante a transicao final.
            </p>
            {loadError ? (
              <StatusBanner tone="warning" title="Carga parcial" message={loadError} role="alert" />
            ) : null}
          </div>

          <div className="sq-stat-grid" aria-label="Resumo rapido">
            <div className="sq-stat">
              <div className="sq-stat-label">Ultimo score</div>
              <div className="sq-stat-value">{formatScore(heroStats.latest?.score_percent)}</div>
              <div className="sq-stat-meta">{formatDateTime(heroStats.latest?.completed_at)}</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Melhor score</div>
              <div className="sq-stat-value">{formatScore(heroStats.best?.score_percent)}</div>
              <div className="sq-stat-meta">{formatDateTime(heroStats.best?.completed_at)}</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Simulados concluidos</div>
              <div className="sq-stat-value">{heroStats.totalSessions}</div>
              <div className="sq-stat-meta">Historico filtrado pelo usuario atual</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Revisoes vencidas</div>
              <div className="sq-stat-value">{heroStats.dueReviewCount}</div>
              <div className="sq-stat-meta">
                Media recente: {heroStats.average !== null ? formatScore(heroStats.average) : "-"}
              </div>
            </div>
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Ritmo e retencao</div>
              <div className="sq-list-meta">
                Metas leves, streak util e perfil adaptativo para manter consistencia sem gamificacao vazia.
              </div>
            </div>
            <span className="sq-chip">{engagement.streak.current_days} dia(s) em sequencia</span>
          </div>

          <div className="sq-stat-grid" aria-label="Ritmo atual">
            <div className="sq-stat">
              <div className="sq-stat-label">Meta diaria</div>
              <div className="sq-stat-value">
                {engagement.daily_goal.completed}/{engagement.daily_goal.target}
              </div>
              <div className="sq-stat-meta">{engagement.daily_goal.progress_percent}% concluido</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Revisao diaria</div>
              <div className="sq-stat-value">
                {engagement.daily_review_goal.completed}/{engagement.daily_review_goal.target}
              </div>
              <div className="sq-stat-meta">{engagement.review_backlog_due} item(ns) vencido(s)</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Meta semanal</div>
              <div className="sq-stat-value">
                {engagement.weekly_goal.completed}/{engagement.weekly_goal.target}
              </div>
              <div className="sq-stat-meta">{engagement.weekly_goal.progress_percent}% da semana</div>
            </div>
            <div className="sq-stat">
              <div className="sq-stat-label">Perfil adaptativo</div>
              <div className="sq-stat-value">{engagement.adaptive_profile.recovery_mode ? "Recuperacao" : "Estavel"}</div>
              <div className="sq-stat-meta">
                Baixa seguranca: {engagement.adaptive_profile.low_confidence_bias}%
              </div>
            </div>
          </div>

          <div className="sq-list" role="list" aria-label="Proxima acao sugerida">
            <div className="sq-list-item">
              <div className="sq-list-title">Proxima acao</div>
              <div className="sq-list-meta">{engagement.recommended_next_action}</div>
            </div>
            <div className="sq-list-item">
              <div className="sq-list-title">Foco adaptativo</div>
              <div className="sq-list-meta">
                {engagement.adaptive_profile.focus_domains.length
                  ? String(
                      (engagement.adaptive_profile.focus_domains[0] as Record<string, unknown> | undefined)?.["domain"] ||
                        "Sem dominio"
                    )
                  : "Sem dominio critico suficiente ainda."}
              </div>
            </div>
            <div className="sq-list-item">
              <div className="sq-list-title">Melhor streak</div>
              <div className="sq-list-meta">
                {engagement.streak.best_days} dia(s) · {engagement.streak.total_active_days} dia(s) ativos no total
              </div>
            </div>
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Continuidade entre devices</div>
              <div className="sq-list-meta">
                Sessoes em aberto ficam no backend e podem ser retomadas em qualquer device autenticado.
              </div>
            </div>
            <span className="sq-chip">{activeExamSessions.length + activeStudySessions.length} ativa(s)</span>
          </div>

          <div className="sq-grid-2">
            <div className="sq-list" role="list" aria-label="Sessoes de prova em andamento">
              <div className="sq-list-title">Provas em andamento</div>
              {activeExamSessions.length ? (
                activeExamSessions.map((session) => (
                  <div key={session.id} className="sq-list-item">
                    <div className="sq-list-title">{session.exam_title || "Simulado misto"}</div>
                    <div className="sq-list-meta">
                      {session.answered_count}/{session.total_questions} · {session.progress_percent}% · {session.selection_strategy}
                    </div>
                    <Link href={`/exam/${session.id}`}>Retomar prova</Link>
                  </div>
                ))
              ) : (
                <div className="sq-empty">Nenhuma prova aberta no momento.</div>
              )}
            </div>

            <div className="sq-list" role="list" aria-label="Sessoes de estudo em andamento">
              <div className="sq-list-title">Study sessions em andamento</div>
              {activeStudySessions.length ? (
                activeStudySessions.map((session) => (
                  <div key={session.id} className="sq-list-item">
                    <div className="sq-list-title">{session.exam_title || "Study misto"}</div>
                    <div className="sq-list-meta">
                      {session.answered_count}/{session.total_questions} · {session.progress_percent}% · {session.selection_strategy}
                    </div>
                    <Link href={`/study/${session.id}`}>Retomar estudo</Link>
                  </div>
                ))
              ) : (
                <div className="sq-empty">Nenhuma sessao de estudo aberta no momento.</div>
              )}
            </div>
          </div>
        </section>

        <section className="sq-card">
          <div className="sq-progress-head">
            <div>
              <div className="sq-list-title">Busca unificada de questoes</div>
              <div className="sq-list-meta">
                Combine dominio, tag, keyword e texto parcial. Os filtros ficam persistidos neste navegador.
              </div>
            </div>
            <span className="sq-chip">{questionSearch.total} encontrada(s)</span>
          </div>

          <div className="sq-grid-2">
            <Field label="Texto / keyword" htmlFor="question-search-query" hint="Busca por enunciado, keyword, tag, dominio ou certificacao.">
              <input
                id="question-search-query"
                className="sq-input"
                value={discoveryFilters.query}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder="Ex.: cryptography, asset, incident"
              />
            </Field>

            <Field label="Tag" htmlFor="question-search-tag" hint="Filtro fino por tag especifica, quando voce ja sabe o objetivo.">
              <input
                id="question-search-tag"
                className="sq-input"
                value={discoveryFilters.tag}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, tag: event.target.value }))}
                placeholder="Ex.: access control"
              />
            </Field>

            <Field label="Dominio" htmlFor="question-search-domain" hint="Reaproveita o mesmo catalogo ja carregado para a prova selecionada.">
              <select
                id="question-search-domain"
                className="sq-select"
                value={discoveryFilters.domain}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, domain: event.target.value }))}
              >
                <option value="">Todos os dominios</option>
                {domains.map((domainItem) => (
                  <option key={domainItem.value} value={domainItem.value}>
                    {domainItem.label}
                  </option>
                ))}
              </select>
            </Field>

            <div className="sq-list-item" style={{ display: "flex", flexDirection: "column", gap: "var(--sq-space-3)" }}>
              <label style={{ display: "flex", gap: "var(--sq-space-2)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={discoveryFilters.bookmarkedOnly}
                  onChange={(event) =>
                    setDiscoveryFilters((current) => ({ ...current, bookmarkedOnly: event.target.checked }))
                  }
                />
                Apenas bookmarks
              </label>
              <label style={{ display: "flex", gap: "var(--sq-space-2)", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={discoveryFilters.notesOnly}
                  onChange={(event) => setDiscoveryFilters((current) => ({ ...current, notesOnly: event.target.checked }))}
                />
                Apenas com nota
              </label>
            </div>
          </div>

          <div className="sq-list" role="list" aria-label="Resultados da busca de questoes">
            {isDiscoveryLoading ? (
              <div className="sq-empty">Atualizando resultados...</div>
            ) : questionSearch.items.length ? (
              questionSearch.items.map((item) => (
                <div key={item.id} className="sq-list-item">
                  <div className="sq-list-title">{item.prompt_excerpt}</div>
                  <div className="sq-list-meta">
                    {item.exam_title || item.exam_id}
                    {item.domain ? ` · ${item.domain}` : ""}
                    {item.certification ? ` · ${item.certification}` : ""}
                  </div>
                  <div className="sq-chip-row">
                    {item.tags.slice(0, 3).map((tag) => (
                      <span key={`${item.id}-${tag}`} className="sq-chip">
                        {tag}
                      </span>
                    ))}
                    {item.is_bookmarked ? <span className="sq-chip">bookmark</span> : null}
                    {item.has_note ? <span className="sq-chip">nota</span> : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="sq-empty">Nenhuma questao encontrada com os filtros atuais.</div>
            )}
          </div>
        </section>

        <div className="sq-grid-2">
          <AccountPanel
            user={currentUser}
            overview={studyOverview}
            notice={authNotice}
            pendingAction={pendingAction === "logout" ? pendingAction : null}
            onLogout={() => {
              void handleLogout();
            }}
          />

          <ExamLauncher
            health={health}
            exams={exams}
            domains={domains}
            apiOriginLabel={runtimeConfig.apiOrigin || "mesma origem"}
            values={launchValues}
            notice={
              isDomainLoading && !launchNotice
                ? toDashboardNotice("neutral", "Atualizando assuntos", "Carregando o catalogo de dominios para a prova selecionada.")
                : launchNotice
            }
            pending={pendingAction === "launch"}
            onChange={updateLaunchValue}
            onSubmit={() => {
              void handleLaunch();
            }}
          />
        </div>

        <InsightsPanel
          weakAreas={weakAreas}
          studyOverview={studyOverview}
          examHistory={examHistory}
          studyHistory={studyHistory}
          refreshing={isRefreshing}
          onRefresh={() => {
            void refreshDashboard();
          }}
        />
      </div>
    </main>
  );
}
