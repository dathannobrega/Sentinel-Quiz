"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { clearStoredAuthToken, persistSessionId, setStoredAuthToken } from "@/lib/auth/storage";
import { getRuntimeConfig } from "@/lib/config/runtime";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { formatDateTime, formatScore } from "@/lib/utils/format";
import type {
  AuthTokenResponse,
  AuthUser,
  DomainCatalogResponse,
  Exam,
  HealthResponse,
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
import type {
  DashboardNotice,
  LaunchFormValues,
  LoginFormValues,
  RegisterFormValues
} from "@/features/dashboard/types";

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

const DEFAULT_LAUNCH_FORM: LaunchFormValues = {
  examId: "",
  domain: "",
  mode: "exam",
  examStrategy: "standard",
  studyStrategy: "standard",
  totalQuestions: 90
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
  const [pendingAction, setPendingAction] = useState<"login" | "register" | "logout" | "launch" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<DashboardNotice | null>(null);
  const [launchNotice, setLaunchNotice] = useState<DashboardNotice | null>(null);

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [exams, setExams] = useState<Exam[]>([]);
  const [domains, setDomains] = useState<DomainCatalogResponse["domains"]>([]);
  const [weakAreas, setWeakAreas] = useState<WeakAreasResponse["certifications"]>([]);
  const [studyOverview, setStudyOverview] = useState<StudyOverview>(DEFAULT_STUDY_OVERVIEW);
  const [examHistory, setExamHistory] = useState<SessionHistoryItem[]>([]);
  const [studyHistory, setStudyHistory] = useState<StudyHistoryItem[]>([]);

  const [loginValues, setLoginValues] = useState<LoginFormValues>({ email: "", password: "" });
  const [registerValues, setRegisterValues] = useState<RegisterFormValues>({
    displayName: "",
    email: "",
    password: ""
  });
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
    void loadDomains(launchValues.examId);
  }, [launchValues.examId]);

  async function syncCurrentUser() {
    try {
      const user = await apiClient.get<AuthUser>("/auth/me", { retryOnUnauthorized: false });
      setCurrentUser(user);
    } catch (error) {
      if (isUnauthorized(error)) {
        clearStoredAuthToken();
        setCurrentUser(null);
        return;
      }
      setCurrentUser(null);
    }
  }

  async function refreshDashboard() {
    setIsRefreshing(true);
    setLoadError(null);

    const results = await Promise.allSettled([
      apiClient.get<HealthResponse>("/health"),
      apiClient.get<Exam[]>("/exams"),
      apiClient.get<WeakAreasResponse>("/analytics/weak-areas"),
      apiClient.get<StudyOverview>("/study/overview"),
      apiClient.get<SessionHistoryItem[]>("/sessions/history?limit=12"),
      apiClient.get<StudyHistoryItem[]>("/study/history?limit=12")
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
      setStudyOverview(results[3].value);
    } else {
      setStudyOverview(DEFAULT_STUDY_OVERVIEW);
      failedLabels.push("overview de estudo");
    }

    if (results[4].status === "fulfilled") {
      setExamHistory(results[4].value);
    } else {
      setExamHistory([]);
      failedLabels.push("historico de simulados");
    }

    if (results[5].status === "fulfilled") {
      setStudyHistory(results[5].value);
    } else {
      setStudyHistory([]);
      failedLabels.push("historico de estudo");
    }

    if (failedLabels.length) {
      setLoadError(
        `Nem todos os dados foram carregados. Revise: ${failedLabels.join(", ")}. O restante do dashboard continua funcional.`
      );
    }

    setIsRefreshing(false);
  }

  async function handleAuthSubmit(
    mode: "login" | "register",
    payload: { email: string; password: string; display_name?: string | null }
  ) {
    const email = payload.email.trim();
    if (!email || !payload.password.trim()) {
      setAuthNotice(
        toDashboardNotice("warning", "Campos obrigatorios", "Preencha email e senha antes de continuar.")
      );
      return;
    }

    if (mode === "register" && payload.password.trim().length < 8) {
      setAuthNotice(
        toDashboardNotice("warning", "Senha invalida", "Use ao menos 8 caracteres para criar a conta.")
      );
      return;
    }

    setPendingAction(mode);
    setAuthNotice(null);

    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const response = await apiClient.post<AuthTokenResponse>(path, payload, { retryOnUnauthorized: false });
      setStoredAuthToken(response.token);
      setCurrentUser(response.user);
      setAuthNotice(
        toDashboardNotice(
          "success",
          mode === "login" ? "Sessao iniciada" : "Conta criada",
          "Seu progresso local foi associado a esta conta quando aplicavel."
        )
      );
      setLoginValues({ email: "", password: "" });
      setRegisterValues({ displayName: "", email: "", password: "" });
      await refreshDashboard();
    } catch (error) {
      setAuthNotice(toDashboardNotice("danger", "Falha de autenticacao", readErrorMessage(error)));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogout() {
    setPendingAction("logout");
    setAuthNotice(null);

    try {
      await apiClient.post<{ ok: boolean }>("/auth/logout");
    } catch (_error) {
      // Token may already be invalid. The local cleanup below is still authoritative.
    } finally {
      clearStoredAuthToken();
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

    setPendingAction("launch");
    setLaunchNotice(null);

    try {
      const domains = launchValues.domain ? [launchValues.domain] : null;
      let session: SessionResponse;

      if (launchValues.mode === "study") {
        const payload: StudySessionRequest = {
          exam_id: launchValues.examId || null,
          total_questions: launchValues.totalQuestions,
          domains,
          strategy: launchValues.studyStrategy,
          queue_only: false
        };
        session = await apiClient.post<SessionResponse>("/study/sessions", payload);
      } else {
        const payload: SessionRequest = {
          exam_id: launchValues.examId || null,
          total_questions: launchValues.totalQuestions,
          domains,
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

        <div className="sq-grid-2">
          <AccountPanel
            user={currentUser}
            overview={studyOverview}
            loginValues={loginValues}
            registerValues={registerValues}
            notice={authNotice}
            pendingAction={
              pendingAction === "login" || pendingAction === "register" || pendingAction === "logout"
                ? pendingAction
                : null
            }
            onLoginChange={(field, value) => setLoginValues((current) => ({ ...current, [field]: value }))}
            onRegisterChange={(field, value) => setRegisterValues((current) => ({ ...current, [field]: value }))}
            onLoginSubmit={(event) => {
              event.preventDefault();
              void handleAuthSubmit("login", {
                email: loginValues.email,
                password: loginValues.password
              });
            }}
            onRegisterSubmit={(event) => {
              event.preventDefault();
              void handleAuthSubmit("register", {
                email: registerValues.email,
                password: registerValues.password,
                display_name: registerValues.displayName.trim() || null
              });
            }}
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
