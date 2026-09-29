"use client";

import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";

import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { BookmarkIcon, NoteIcon } from "@/components/ui/icons";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader } from "@/components/ui/section";
import { clampPbqCount } from "@/features/session-runner/lib/pbq-utils";
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
  timeLimitMinutes: 45,
  pbqCount: 0
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
  next.pbqCount = clampPbqCount(next.pbqCount);
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
          queue_only: selectedPresetKey === "daily_review",
          pbq_count: clampPbqCount(values.pbqCount)
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
        experience_mode: values.experienceMode,
        pbq_count: clampPbqCount(values.pbqCount)
      };
      const session = await apiClient.post<SessionResponse>("/sessions", payload);
      return { mode: "exam", id: session.id };
    },
    onSuccess: (result) => {
      persistSessionId(result.mode, result.id);
      startTransition(() => {
        router.push(result.mode === "study" ? `/study/${encodeURIComponent(result.id)}` : `/exam/${encodeURIComponent(result.id)}`);
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

  // Open automatically only when discovery filters are in use (not merely while results load).
  const shouldExpandDiscovery = Boolean(
      discoveryFilters.query.trim() ||
        discoveryFilters.domain ||
        discoveryFilters.tag.trim() ||
        discoveryFilters.bookmarkedOnly ||
        discoveryFilters.notesOnly
    );

  if (examsQuery.isPending) {
    return <PageSkeleton blocks={[72, 180, 320]} />;
  }

  return (
    <Page>
      <PageHeader title={t("start.header.title")} description={t("start.header.subtitle")} />

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

      <Disclosure
        summary={t("start.discovery.summary")}
        hint={t("start.discovery.subtitle")}
        meta={<span className="nums text-[0.8125rem] text-fg-muted">{t("start.discovery.foundCount", { count: questionSearch.total })}</span>}
        open={shouldExpandDiscovery ? true : undefined}
      >
        <div className="flex flex-col gap-5">
          {questionSearchQuery.isError ? (
            <QueryErrorBanner
              tone="warning"
              title={t("common.errors.attention")}
              error={questionSearchQuery.error}
              onRetry={() => void questionSearchQuery.refetch()}
              retrying={questionSearchQuery.isFetching}
            />
          ) : null}
          <div className="grid gap-x-4 gap-y-5 sm:grid-cols-3">
            <Field label={t("start.discovery.query")} htmlFor="question-search-query">
              <Input
                id="question-search-query"
                type="search"
                value={discoveryFilters.query}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, query: event.target.value }))}
                placeholder={t("start.discovery.queryPlaceholder")}
              />
            </Field>
            <Field label={t("start.discovery.tag")} htmlFor="question-search-tag">
              <Input
                id="question-search-tag"
                value={discoveryFilters.tag}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, tag: event.target.value }))}
                placeholder={t("start.discovery.tagPlaceholder")}
              />
            </Field>
            <Field label={t("start.discovery.domain")} htmlFor="question-search-domain">
              <Select
                id="question-search-domain"
                value={discoveryFilters.domain}
                onChange={(event) => setDiscoveryFilters((current) => ({ ...current, domain: event.target.value }))}
              >
                <option value="">{t("common.filters.allDomains")}</option>
                {domains.map((domainItem) => (
                  <option key={domainItem.value} value={domainItem.value}>
                    {domainItem.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6">
            <Checkbox
              id="question-search-bookmarked"
              checked={discoveryFilters.bookmarkedOnly}
              onChange={(event) => setDiscoveryFilters((current) => ({ ...current, bookmarkedOnly: event.target.checked }))}
              label={t("start.discovery.bookmarkedOnly")}
            />
            <Checkbox
              id="question-search-notes"
              checked={discoveryFilters.notesOnly}
              onChange={(event) => setDiscoveryFilters((current) => ({ ...current, notesOnly: event.target.checked }))}
              label={t("start.discovery.notesOnly")}
            />
          </div>

          <div aria-busy={isDiscoveryLoading || undefined}>
            {isDiscoveryLoading && !questionSearch.items.length ? (
              <p className="text-sm text-fg-muted" role="status">
                {t("start.discovery.loading")}
              </p>
            ) : questionSearch.items.length ? (
              <ul className="divide-y divide-line border-y border-line" aria-label={t("start.discovery.resultsAriaLabel")}>
                {questionSearch.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-3">
                    <p className="font-serif text-[0.9375rem] leading-relaxed text-fg">{item.prompt_excerpt}</p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                      <span>{[item.exam_title || item.exam_id, item.domain, item.certification].filter(Boolean).join(" · ")}</span>
                      {item.tags.slice(0, 3).map((tag) => (
                        <span key={`${item.id}-${tag}`} className="rounded-sm bg-surface-muted px-1.5 py-0.5">
                          {tag}
                        </span>
                      ))}
                      {item.is_bookmarked ? (
                        <span className="inline-flex items-center gap-1 text-fg">
                          <BookmarkIcon size={12} />
                          {t("common.status.marked")}
                        </span>
                      ) : null}
                      {item.has_note ? (
                        <span className="inline-flex items-center gap-1 text-fg">
                          <NoteIcon size={12} />
                          {t("common.status.withNote")}
                        </span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState size="compact" description={t("start.discovery.empty")} />
            )}
          </div>
        </div>
      </Disclosure>
    </Page>
  );
}
