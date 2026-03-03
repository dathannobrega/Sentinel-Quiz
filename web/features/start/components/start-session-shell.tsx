"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import type {
  DomainCatalogResponse,
  Exam,
  QuestionSearchResponse,
  SessionRequest,
  SessionResponse,
  StudySessionRequest
} from "@/types/api";

import { ExamLauncher } from "@/features/dashboard/components/exam-launcher";
import type { DashboardNotice, LaunchFormValues } from "@/features/dashboard/types";

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
  totalQuestions: 30,
  timeLimitMinutes: 45
};

const START_LAUNCH_STORAGE_KEY = "sentinel.start.launch_filters";
const START_DISCOVERY_STORAGE_KEY = "sentinel.start.discovery_filters";

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

function toNotice(
  tone: DashboardNotice["tone"],
  title: string,
  message: string
): DashboardNotice {
  return { tone, title, message };
}

function readErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function parseCsvFilter(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

export function StartSessionShell() {
  const { t } = useI18n();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isDomainLoading, setIsDomainLoading] = useState(false);
  const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState(false);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [launchNotice, setLaunchNotice] = useState<DashboardNotice | null>(null);

  const [exams, setExams] = useState<Exam[]>([]);
  const [domains, setDomains] = useState<DomainCatalogResponse["domains"]>([]);
  const [launchValues, setLaunchValues] = useState<LaunchFormValues>(DEFAULT_LAUNCH_FORM);
  const [discoveryFilters, setDiscoveryFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [questionSearch, setQuestionSearch] = useState<QuestionSearchResponse>({
    items: [],
    total: 0,
    limit: 8,
    offset: 0,
    applied_filters: {}
  });

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
    setPageNotice(null);

    try {
      setExams(await apiClient.get<Exam[]>("/exams"));
    } catch (error) {
      setExams([]);
      setPageNotice(readErrorMessage(error, t("start.errors.unexpected")));
    } finally {
      setIsLoading(false);
    }
  });

  const loadDomains = useEffectEvent(async (examId: string) => {
    setIsDomainLoading(true);
    try {
      const query = examId ? `?exam_id=${encodeURIComponent(examId)}` : "";
      const response = await apiClient.get<DomainCatalogResponse>(`/domains${query}`);
      setDomains(response.domains);
    } catch {
      setDomains([]);
    } finally {
      setIsDomainLoading(false);
    }
  });

  const refreshQuestionSearch = useEffectEvent(async () => {
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
      setQuestionSearch({ items: [], total: 0, limit: 8, offset: 0, applied_filters: {} });
      setPageNotice(t("start.errors.searchUnavailable", { message: readErrorMessage(error, t("start.errors.unexpected")) }));
    } finally {
      setIsDiscoveryLoading(false);
    }
  });

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const rawLaunch = window.localStorage.getItem(START_LAUNCH_STORAGE_KEY);
      if (rawLaunch) {
        const parsed = JSON.parse(rawLaunch) as Partial<LaunchFormValues>;
        setLaunchValues((current) => ({ ...current, ...parsed }));
      }
      const rawDiscovery = window.localStorage.getItem(START_DISCOVERY_STORAGE_KEY);
      if (rawDiscovery) {
        const parsed = JSON.parse(rawDiscovery) as Partial<DiscoveryFilters>;
        setDiscoveryFilters((current) => ({ ...current, ...parsed }));
      }
    } catch {
      // Ignore invalid local cache.
    }
  }, []);

  useEffect(() => {
    void loadDomains(launchValues.examId);
  }, [launchValues.examId, loadDomains]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(START_LAUNCH_STORAGE_KEY, JSON.stringify(launchValues));
  }, [launchValues]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(START_DISCOVERY_STORAGE_KEY, JSON.stringify(discoveryFilters));
  }, [discoveryFilters]);

  useEffect(() => {
    void refreshQuestionSearch();
  }, [
    discoveryFilters.query,
    discoveryFilters.domain,
    discoveryFilters.tag,
    discoveryFilters.bookmarkedOnly,
    discoveryFilters.notesOnly,
    launchValues.examId,
    refreshQuestionSearch
  ]);

  async function handleLaunch() {
    if (launchValues.totalQuestions < 1) {
      setLaunchNotice(
        toNotice("warning", t("start.errors.invalidQuantityTitle"), t("start.errors.invalidQuantityMessage"))
      );
      return;
    }

    const maxQuestions = launchValues.mode === "study" ? 120 : 180;
    if (launchValues.totalQuestions > maxQuestions) {
      setLaunchNotice(
        toNotice(
          "warning",
          t("start.errors.quantityLimitTitle"),
          t("start.errors.quantityLimitMessage", {
            mode: launchValues.mode === "study" ? t("common.labels.study").toLowerCase() : t("common.labels.exam").toLowerCase(),
            count: maxQuestions
          })
        )
      );
      return;
    }

    if (launchValues.mode === "exam" && (launchValues.timeLimitMinutes < 5 || launchValues.timeLimitMinutes > 360)) {
      setLaunchNotice(toNotice("warning", t("start.errors.invalidTimeTitle"), t("start.errors.invalidTimeMessage")));
      return;
    }

    setPendingLaunch(true);
    setLaunchNotice(null);

    try {
      const domainsFilter = launchValues.domain ? [launchValues.domain] : null;
      const difficulties = parseCsvFilter(launchValues.difficultyQuery);
      const tags = parseCsvFilter(launchValues.tagQuery);
      let session: SessionResponse;

      if (launchValues.mode === "study") {
        const payload: StudySessionRequest = {
          exam_id: launchValues.examId || null,
          total_questions: launchValues.totalQuestions,
          domains: domainsFilter,
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
          domains: domainsFilter,
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
      startTransition(() => {
        router.push(launchValues.mode === "study" ? `/study/${session.id}` : `/exam/${session.id}`);
      });
    } catch (error) {
      setLaunchNotice(
        toNotice("danger", t("start.errors.createSessionTitle"), readErrorMessage(error, t("start.errors.unexpected")))
      );
    } finally {
      setPendingLaunch(false);
    }
  }

  const shouldExpandDiscovery =
    isDiscoveryLoading ||
    Boolean(
      discoveryFilters.query.trim() ||
        discoveryFilters.domain ||
        discoveryFilters.tag.trim() ||
        discoveryFilters.bookmarkedOnly ||
        discoveryFilters.notesOnly
    );

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
              <div className="sq-page-title">{t("start.header.title")}</div>
              <p className="sq-page-subtitle">{t("start.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
            <Link href="/history">{t("common.labels.history")}</Link>
          </div>
        </header>

        {pageNotice ? <StatusBanner tone="warning" title={t("common.errors.attention")} message={pageNotice} /> : null}

        <ExamLauncher
          exams={exams}
          domains={domains}
          values={launchValues}
          notice={
            isDomainLoading && !launchNotice
              ? toNotice("neutral", t("start.notices.loadingDomainsTitle"), t("start.notices.loadingDomainsMessage"))
              : launchNotice
          }
          pending={pendingLaunch}
          onChange={updateLaunchValue}
          onSubmit={() => {
            void handleLaunch();
          }}
        />

        <details className="sq-card sq-disclosure" open={shouldExpandDiscovery ? true : undefined}>
          <summary className="sq-disclosure__summary">
            {t("start.discovery.summary")}
            <span className="sq-chip">{t("start.discovery.foundCount", { count: questionSearch.total })}</span>
          </summary>

          <div className="sq-stack-md">
            <div className="sq-form-grid">
              <Field label={t("start.discovery.query")} htmlFor="question-search-query">
                <input
                  id="question-search-query"
                  className="sq-input"
                  value={discoveryFilters.query}
                  onChange={(event) => setDiscoveryFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder={t("start.discovery.queryPlaceholder")}
                />
              </Field>

              <Field label={t("start.discovery.tag")} htmlFor="question-search-tag">
                <input
                  id="question-search-tag"
                  className="sq-input"
                  value={discoveryFilters.tag}
                  onChange={(event) => setDiscoveryFilters((current) => ({ ...current, tag: event.target.value }))}
                  placeholder={t("start.discovery.tagPlaceholder")}
                />
              </Field>

              <Field label={t("start.discovery.domain")} htmlFor="question-search-domain">
                <select
                  id="question-search-domain"
                  className="sq-select"
                  value={discoveryFilters.domain}
                  onChange={(event) => setDiscoveryFilters((current) => ({ ...current, domain: event.target.value }))}
                >
                  <option value="">{t("common.filters.allDomains")}</option>
                  {domains.map((domainItem) => (
                    <option key={domainItem.value} value={domainItem.value}>
                      {domainItem.label}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="sq-runner-utility">
                <div className="sq-checkbox-grid">
                  <label className="sq-checkbox-row">
                    <input
                      type="checkbox"
                      checked={discoveryFilters.bookmarkedOnly}
                      onChange={(event) =>
                        setDiscoveryFilters((current) => ({ ...current, bookmarkedOnly: event.target.checked }))
                      }
                    />
                    {t("start.discovery.bookmarkedOnly")}
                  </label>
                  <label className="sq-checkbox-row">
                    <input
                      type="checkbox"
                      checked={discoveryFilters.notesOnly}
                      onChange={(event) => setDiscoveryFilters((current) => ({ ...current, notesOnly: event.target.checked }))}
                    />
                    {t("start.discovery.notesOnly")}
                  </label>
                </div>
              </div>
            </div>

            <div className="sq-list" role="list" aria-label={t("start.discovery.resultsAriaLabel")}>
              {isDiscoveryLoading ? (
                <div className="sq-empty sq-empty--compact">{t("start.discovery.loading")}</div>
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
                      {item.is_bookmarked ? <span className="sq-chip">{t("common.status.marked")}</span> : null}
                      {item.has_note ? <span className="sq-chip">{t("common.status.withNote")}</span> : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="sq-empty">{t("start.discovery.empty")}</div>
              )}
            </div>
          </div>
        </details>
      </div>
    </main>
  );
}
