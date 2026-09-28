"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Field } from "@/components/ui/field";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient, readErrorMessage } from "@/lib/api/client";
import { persistSessionId } from "@/lib/auth/storage";
import { useI18n } from "@/lib/i18n";
import { useDomainsQuery, useExamsQuery, useQuestionSearchQuery } from "@/lib/query/hooks";
import type {
  QuestionSearchResponse,
  SessionRequest,
  SessionResponse,
  StudySessionRequest,
  StudySessionResponse
} from "@/types/api";

import { ExamLauncher } from "@/features/dashboard/components/exam-launcher";
import type { DashboardNotice, LaunchFormValues, LaunchPresetKey } from "@/features/dashboard/types";

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
  experienceMode: "standard",
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

function buildPresetValues(presetKey: LaunchPresetKey, current: LaunchFormValues): LaunchFormValues {
  switch (presetKey) {
    case "placement":
      return {
        ...current,
        mode: "study",
        studyStrategy: "adaptive",
        totalQuestions: 20,
        timeLimitMinutes: 25,
        bookmarkedOnly: false,
        notesOnly: false,
        incorrectOnly: false,
        unseenOnly: false,
        lowConfidenceOnly: false
      };
    case "daily_review":
      return {
        ...current,
        mode: "study",
        studyStrategy: "adaptive",
        totalQuestions: 10,
        lowConfidenceOnly: true,
        bookmarkedOnly: false,
        notesOnly: false,
        incorrectOnly: false,
        unseenOnly: false
      };
    case "quick_15":
      return {
        ...current,
        mode: "exam",
        examStrategy: "standard",
        totalQuestions: 15,
        timeLimitMinutes: 15
      };
    case "comptia_exam":
      return {
        ...current,
        mode: "exam",
        examStrategy: "adaptive",
        totalQuestions: 45,
        timeLimitMinutes: 45
      };
    case "sprint_25":
      return {
        ...current,
        mode: "study",
        studyStrategy: "adaptive",
        totalQuestions: 20,
        timeLimitMinutes: 25
      };
    case "risk_focus":
      return {
        ...current,
        mode: "study",
        studyStrategy: "adaptive",
        totalQuestions: 5
      };
    case "custom":
    default:
      return current;
  }
}

function toNotice(
  tone: DashboardNotice["tone"],
  title: string,
  message: string
): DashboardNotice {
  return { tone, title, message };
}

function parseCsvFilter(value: string): string[] | null {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : null;
}

const EMPTY_SEARCH: QuestionSearchResponse = { items: [], total: 0, limit: 8, offset: 0, applied_filters: {} };
const PRESET_KEYS: LaunchPresetKey[] = ["placement", "daily_review", "quick_15", "comptia_exam", "sprint_25", "risk_focus"];

function readStoredJson<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort only (private mode / quota).
  }
}

function sanitizeStoredLaunch(value: Partial<LaunchFormValues> | null): Partial<LaunchFormValues> {
  if (!value) {
    return {};
  }
  const next: Partial<LaunchFormValues> = { ...value };
  if (next.experienceMode !== "standard" && next.experienceMode !== "exam_day") {
    delete next.experienceMode;
  }
  if (next.mode !== "exam" && next.mode !== "study") {
    delete next.mode;
  }
  return next;
}

type LaunchResult = { mode: "exam" | "study"; id: string };

export function StartSessionShell() {
  const { t } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [launchNotice, setLaunchNotice] = useState<DashboardNotice | null>(null);
  const [launchValues, setLaunchValues] = useState<LaunchFormValues>(DEFAULT_LAUNCH_FORM);
  const [selectedPresetKey, setSelectedPresetKey] = useState<LaunchPresetKey>("custom");
  const [discoveryFilters, setDiscoveryFilters] = useState<DiscoveryFilters>(DEFAULT_DISCOVERY_FILTERS);
  const [hasRestoredFilters, setHasRestoredFilters] = useState(false);

  const examsQuery = useExamsQuery();
  const domainsQuery = useDomainsQuery(launchValues.examId);
  const exams = examsQuery.data ?? [];
  const domains = domainsQuery.data?.domains ?? [];

  const deferredDiscovery = useDeferredValue(discoveryFilters);
  const searchParamsForQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (launchValues.examId) {
      params.set("exam_id", launchValues.examId);
    }
    if (deferredDiscovery.query.trim()) {
      params.set("query", deferredDiscovery.query.trim());
    }
    if (deferredDiscovery.domain) {
      params.set("domain", deferredDiscovery.domain);
    }
    if (deferredDiscovery.tag.trim()) {
      params.set("tag", deferredDiscovery.tag.trim());
    }
    if (deferredDiscovery.bookmarkedOnly) {
      params.set("bookmarked_only", "true");
    }
    if (deferredDiscovery.notesOnly) {
      params.set("notes_only", "true");
    }
    params.set("limit", "8");
    return params;
  }, [deferredDiscovery, launchValues.examId]);
  const questionSearchQuery = useQuestionSearchQuery(searchParamsForQuery);
  const questionSearch = questionSearchQuery.data ?? EMPTY_SEARCH;
  const isDiscoveryLoading = questionSearchQuery.isFetching;

  function updateLaunchValue(field: keyof LaunchFormValues, value: LaunchFormValues[keyof LaunchFormValues]) {
    setLaunchNotice(null);
    setSelectedPresetKey("custom");
    setLaunchValues((current) => {
      const nextState = { ...current, [field]: value } as LaunchFormValues;
      if (field === "examId") {
        nextState.domain = "";
      }
      return nextState;
    });
  }

  function applyPreset(presetKey: LaunchPresetKey) {
    setLaunchNotice(null);
    setSelectedPresetKey(presetKey);
    setLaunchValues((current) => buildPresetValues(presetKey, current));
  }

  useEffect(() => {
    const storedLaunch = sanitizeStoredLaunch(readStoredJson<LaunchFormValues>(START_LAUNCH_STORAGE_KEY));
    const storedDiscovery = readStoredJson<DiscoveryFilters>(START_DISCOVERY_STORAGE_KEY);
    setLaunchValues((current) => ({ ...current, ...storedLaunch }));
    if (storedDiscovery) {
      setDiscoveryFilters((current) => ({ ...current, ...storedDiscovery }));
    }
    setHasRestoredFilters(true);
  }, []);

  useEffect(() => {
    const presetParam = (searchParams.get("preset") || "").trim() as LaunchPresetKey;
    if (!presetParam || !PRESET_KEYS.includes(presetParam)) {
      return;
    }
    setSelectedPresetKey(presetParam);
    setLaunchValues((current) => {
      const nextValues = buildPresetValues(presetParam, current);
      const domain = (searchParams.get("domain") || "").trim();
      if (domain) {
        nextValues.domain = domain;
      }
      return nextValues;
    });
  }, [searchParams]);

  useEffect(() => {
    if (hasRestoredFilters) {
      writeStoredJson(START_LAUNCH_STORAGE_KEY, launchValues);
    }
  }, [hasRestoredFilters, launchValues]);

  useEffect(() => {
    if (hasRestoredFilters) {
      writeStoredJson(START_DISCOVERY_STORAGE_KEY, discoveryFilters);
    }
  }, [discoveryFilters, hasRestoredFilters]);

  const presetSummary = t(`launcher.presets.items.${selectedPresetKey}.summary`);

  const launchMutation = useMutation({
    mutationFn: async (values: LaunchFormValues): Promise<LaunchResult> => {
      const domainsFilter = values.domain ? [values.domain] : null;
      const difficulties = parseCsvFilter(values.difficultyQuery);
      const tags = parseCsvFilter(values.tagQuery);

      if (selectedPresetKey === "placement") {
        const query = values.examId ? `?exam_id=${encodeURIComponent(values.examId)}` : "";
        const session = await apiClient.post<StudySessionResponse>(`/study/placement/session${query}`);
        return { mode: "study", id: session.id };
      }
      if (values.mode === "study") {
        const payload: StudySessionRequest = {
          exam_id: values.examId || null,
          total_questions: values.totalQuestions,
          domains: domainsFilter,
          difficulties,
          tags,
          bookmarked_only: values.bookmarkedOnly,
          notes_only: values.notesOnly,
          incorrect_only: values.incorrectOnly,
          unseen_only: values.unseenOnly,
          low_confidence_only: values.lowConfidenceOnly,
          strategy: values.studyStrategy,
          queue_only: selectedPresetKey === "daily_review"
        };
        const session = await apiClient.post<StudySessionResponse>(
          selectedPresetKey === "daily_review" ? "/study/review/sessions" : "/study/sessions",
          payload
        );
        return { mode: "study", id: session.id };
      }
      const payload: SessionRequest = {
        exam_id: values.examId || null,
        total_questions: values.totalQuestions,
        domains: domainsFilter,
        difficulties,
        tags,
        bookmarked_only: values.bookmarkedOnly,
        notes_only: values.notesOnly,
        incorrect_only: values.incorrectOnly,
        unseen_only: values.unseenOnly,
        low_confidence_only: values.lowConfidenceOnly,
        time_limit_minutes: values.timeLimitMinutes,
        strategy: values.examStrategy,
        experience_mode: values.experienceMode
      };
      const session = await apiClient.post<SessionResponse>("/sessions", payload);
      return { mode: "exam", id: session.id };
    },
    onSuccess: (result) => {
      persistSessionId(result.mode, result.id);
      startTransition(() => {
        router.push(result.mode === "study" ? `/study/${result.id}` : `/exam/${result.id}`);
      });
    },
    onError: (error) => {
      setLaunchNotice(toNotice("danger", t("start.errors.createSessionTitle"), readErrorMessage(error, t("start.errors.unexpected"))));
    }
  });

  function handleLaunch() {
    if (launchValues.totalQuestions < 1) {
      setLaunchNotice(toNotice("warning", t("start.errors.invalidQuantityTitle"), t("start.errors.invalidQuantityMessage")));
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

    setLaunchNotice(null);
    launchMutation.mutate(launchValues);
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

  if (examsQuery.isPending) {
    return (
      <main className="sq-app-shell" aria-busy="true">
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

        {examsQuery.isError ? (
          <QueryErrorBanner
            tone="warning"
            title={t("common.errors.attention")}
            error={examsQuery.error}
            onRetry={() => void examsQuery.refetch()}
            retrying={examsQuery.isFetching}
          />
        ) : null}
        {domainsQuery.isError ? (
          <QueryErrorBanner
            tone="warning"
            title={t("common.errors.attention")}
            error={domainsQuery.error}
            onRetry={() => void domainsQuery.refetch()}
            retrying={domainsQuery.isFetching}
          />
        ) : null}
        {questionSearchQuery.isError ? (
          <QueryErrorBanner
            tone="warning"
            title={t("common.errors.attention")}
            error={questionSearchQuery.error}
            onRetry={() => void questionSearchQuery.refetch()}
            retrying={questionSearchQuery.isFetching}
          />
        ) : null}

        <ExamLauncher
          exams={exams}
          domains={domains}
          values={launchValues}
          notice={
            domainsQuery.isFetching && !launchNotice
              ? toNotice("neutral", t("start.notices.loadingDomainsTitle"), t("start.notices.loadingDomainsMessage"))
              : launchNotice
          }
          pending={launchMutation.isPending}
          selectedPresetKey={selectedPresetKey}
          presetSummary={presetSummary}
          onChange={updateLaunchValue}
          onApplyPreset={applyPreset}
          onSubmit={handleLaunch}
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
