"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient, buildApiUrl } from "@/lib/api/client";
import { getOrCreateClientKey, getStoredAuthToken } from "@/lib/auth/storage";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import type {
  AdminAuditLog,
  AdminAnalyticsSnapshotCapture,
  AdminCreateExamInput,
  AdminIngestResponse,
  AdminMutationResponse,
  AdminOverview,
  AdminQuestionAnalytics,
  AdminQuestionAnalyticsSnapshot,
  AdminQuestion,
  AdminQuestionInput,
  AdminQuestionSummary,
  AdminQuestionVersion,
  AdminReviewActionInput,
  AdminRollbackInput,
  CitationItem,
  Exam
} from "@/types/api";

interface ExamDraft {
  id: string;
  title: string;
  source: string;
  questionCount: string;
}

interface OptionDraft {
  rowId: string;
  key: string;
  text: string;
  isCorrect: boolean;
}

interface CitationDraft {
  rowId: string;
  source: string;
  reference: string;
  original: CitationItem;
}

interface QuestionDraft {
  lookupId: string;
  id: string;
  examId: string;
  prompt: string;
  multiSelect: boolean;
  domain: string;
  difficulty: string;
  certification: string;
  subject: string;
  subtopic: string;
  subdomain: string;
  objectiveCode: string;
  blueprintCode: string;
  keywords: string[];
  trapPatterns: string[];
  questionFormat: string;
  tagsText: string;
  justification: string;
  correctRationale: string;
  incorrectRationales: string[];
  avgTimeSeconds: string;
  globalAccuracyPercent: string;
  changeSummary: string;
  options: OptionDraft[];
  citations: CitationDraft[];
}

const DEFAULT_ADMIN_OVERVIEW: AdminOverview = {
  exam_count: 0,
  question_count: 0,
  completed_session_count: 0,
  question_breakdown: {}
};

const DEFAULT_ADMIN_ANALYTICS: AdminQuestionAnalytics = {
  summary: {
    tracked_questions: 0,
    questions_with_signals: 0,
    total_attempts: 0,
    exam_attempts: 0,
    study_attempts: 0,
    total_review_pressure: 0,
    average_wrong_rate_percent: 0,
    snapshot_batch_count: 0,
    latest_snapshot_at: null
  },
  hardest_questions: [],
  weakest_domains: [],
  weakest_exams: []
};

const QUESTION_FORMAT_OPTIONS = [
  { value: "", label: "Auto" },
  { value: "single_choice", label: "Single choice" },
  { value: "multiple_response", label: "Multiple response" },
  { value: "best_answer", label: "Best answer" },
  { value: "matching", label: "Matching" },
  { value: "ordering", label: "Ordering" }
] as const;

type QuestionQuality = NonNullable<AdminQuestion["quality"]>;

let rowSequence = 0;

function createRowId(prefix: string): string {
  rowSequence += 1;
  return `${prefix}-${rowSequence}-${Math.random().toString(36).slice(2, 8)}`;
}

function createOptionDraft(key = "", text = "", isCorrect = false): OptionDraft {
  return {
    rowId: createRowId("opt"),
    key,
    text,
    isCorrect
  };
}

function createCitationDraft(citation: CitationItem = {}): CitationDraft {
  return {
    rowId: createRowId("cite"),
    source: String(citation.source || ""),
    reference: String(citation.reference || ""),
    original: { ...citation }
  };
}

function createEmptyQuestionDraft(preferredExamId = ""): QuestionDraft {
  return {
    lookupId: "",
    id: "",
    examId: preferredExamId,
    prompt: "",
    multiSelect: false,
    domain: "",
    difficulty: "",
    certification: "",
    subject: "",
    subtopic: "",
    subdomain: "",
    objectiveCode: "",
    blueprintCode: "",
    keywords: [],
    trapPatterns: [],
    questionFormat: "",
    tagsText: "",
    justification: "",
    correctRationale: "",
    incorrectRationales: [],
    avgTimeSeconds: "",
    globalAccuracyPercent: "",
    changeSummary: "",
    options: [
      createOptionDraft("A"),
      createOptionDraft("B"),
      createOptionDraft("C"),
      createOptionDraft("D")
    ],
    citations: [createCitationDraft()]
  };
}

function createEmptyExamDraft(): ExamDraft {
  return {
    id: "",
    title: "",
    source: "",
    questionCount: ""
  };
}

function buildAdminRequestOptions() {
  return {
    retryOnUnauthorized: false as const
  };
}

function summarizePrompt(value: string): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= 150) {
    return normalized;
  }
  return `${normalized.slice(0, 147)}...`;
}

function readAdminError(error: unknown, fallback = "Nao foi possivel concluir esta acao."): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "Entre com uma conta admin autenticada para continuar.";
    }
    if (error.status === 403) {
      return "Somente contas admin podem executar esta operacao.";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function nextOptionKey(options: OptionDraft[]): string {
  const used = new Set(options.map((item) => item.key.trim().toUpperCase()).filter(Boolean));
  for (let index = 0; index < 26; index += 1) {
    const key = String.fromCharCode(65 + index);
    if (!used.has(key)) {
      return key;
    }
  }
  return "";
}

function normalizeTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const lowered = item.toLowerCase();
      if (seen.has(lowered)) {
        return;
      }
      seen.add(lowered);
      tags.push(item);
    });

  return tags;
}

function joinTextList(values: string[] | null | undefined): string {
  if (!Array.isArray(values) || !values.length) {
    return "";
  }
  return values.join(", ");
}

function splitTextareaLines(text: string): string[] {
  return text
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatQualityStatus(value: string | undefined): string {
  if (!value) {
    return "Sem dado";
  }
  if (value === "ok" || value === "provided") {
    return "OK";
  }
  if (value === "unverified") {
    return "Nao verificado";
  }
  if (value === "missing") {
    return "Pendente";
  }
  return value;
}

function qualityTone(value: string | undefined): "default" | "good" | "warning" {
  if (value === "ok" || value === "provided") {
    return "good";
  }
  if (value === "unverified") {
    return "warning";
  }
  return "default";
}

function hasCitationValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return true;
}

function buildCitationPayload(rows: CitationDraft[]): CitationItem[] {
  const out: CitationItem[] = [];
  const seen = new Set<string>();

  rows.forEach((row) => {
    const citation: CitationItem = {
      ...row.original,
      source: row.source.trim(),
      reference: row.reference.trim()
    };

    if (!hasCitationValue(citation.source) && !hasCitationValue(citation.reference)) {
      if (!hasCitationValue(citation.material_path) && !hasCitationValue(citation.locator)) {
        const extraKeys = Object.keys(citation).filter((key) => key !== "source" && key !== "reference");
        if (!extraKeys.some((key) => hasCitationValue(citation[key]))) {
          return;
        }
      }
    }

    const key = JSON.stringify(citation);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(citation);
  });

  return out;
}

function buildQuestionPayload(draft: QuestionDraft): AdminQuestionInput {
  const options = draft.options
    .map((item) => ({
      key: item.key.trim().toUpperCase(),
      text: item.text.trim(),
      is_correct: item.isCorrect
    }))
    .filter((item) => item.key && item.text);

  const correctKeys = options.filter((item) => item.is_correct).map((item) => item.key);
  const multiSelect = draft.multiSelect || correctKeys.length > 1;

  return {
    id: draft.id.trim(),
    exam_id: draft.examId.trim(),
    prompt: draft.prompt.trim(),
    multi_select: multiSelect,
    domain: draft.domain.trim() || null,
    difficulty: draft.difficulty.trim() || null,
    certification: draft.certification.trim() || null,
    subject: draft.subject.trim() || null,
    subtopic: draft.subtopic.trim() || null,
    subdomain: draft.subdomain.trim() || null,
    objective_code: draft.objectiveCode.trim() || null,
    blueprint_code: draft.blueprintCode.trim() || null,
    keywords: draft.keywords.length ? draft.keywords : null,
    trap_patterns: draft.trapPatterns.length ? draft.trapPatterns : null,
    question_format: draft.questionFormat.trim() || null,
    tags: normalizeTags(draft.tagsText),
    citations: buildCitationPayload(draft.citations),
    options,
    correct_keys: correctKeys,
    justification: draft.justification.trim() || null,
    correct_rationale: draft.correctRationale.trim() || null,
    incorrect_rationales: draft.incorrectRationales.length ? draft.incorrectRationales : null,
    avg_time_seconds: draft.avgTimeSeconds.trim() ? Number(draft.avgTimeSeconds) : null,
    global_accuracy_percent: draft.globalAccuracyPercent.trim() ? Number(draft.globalAccuracyPercent) : null,
    change_summary: draft.changeSummary.trim() || null
  };
}

function validateQuestionPayload(payload: AdminQuestionInput): string | null {
  if (!payload.id) {
    return "ID da questao e obrigatorio.";
  }
  if (!payload.exam_id) {
    return "Selecione a prova antes de salvar.";
  }
  if (!payload.prompt) {
    return "Escreva o enunciado completo da questao.";
  }
  if (payload.options.length < 2) {
    return "Adicione pelo menos duas alternativas validas.";
  }
  if (payload.correct_keys.length === 0) {
    return "Marque ao menos uma alternativa correta.";
  }

  const uniqueKeys = new Set(payload.options.map((item) => item.key));
  if (uniqueKeys.size !== payload.options.length) {
    return "As chaves das alternativas precisam ser unicas.";
  }

  return null;
}

function toQuestionDraft(question: AdminQuestion): QuestionDraft {
  return {
    lookupId: question.id,
    id: question.id,
    examId: question.exam_id,
    prompt: question.prompt,
    multiSelect: question.multi_select,
    domain: String(question.domain || ""),
    difficulty: String(question.difficulty || ""),
    certification: String(question.certification || ""),
    subject: String(question.subject || ""),
    subtopic: String(question.subtopic || ""),
    subdomain: String(question.subdomain || ""),
    objectiveCode: String(question.objective_code || ""),
    blueprintCode: String(question.blueprint_code || ""),
    keywords: Array.isArray(question.keywords) ? [...question.keywords] : [],
    trapPatterns: Array.isArray(question.trap_patterns) ? [...question.trap_patterns] : [],
    questionFormat: String(question.question_format || ""),
    tagsText: Array.isArray(question.tags) ? question.tags.join(", ") : "",
    justification: String(question.justification || ""),
    correctRationale: String(question.correct_rationale || ""),
    incorrectRationales: Array.isArray(question.incorrect_rationales) ? [...question.incorrect_rationales] : [],
    avgTimeSeconds:
      typeof question.avg_time_seconds === "number" && Number.isFinite(question.avg_time_seconds)
        ? String(question.avg_time_seconds)
        : "",
    globalAccuracyPercent:
      typeof question.global_accuracy_percent === "number" && Number.isFinite(question.global_accuracy_percent)
        ? String(question.global_accuracy_percent)
        : "",
    changeSummary: String(question.change_summary || ""),
    options: question.options.length
      ? question.options.map((option) => createOptionDraft(option.key, option.text, option.is_correct))
      : [createOptionDraft("A"), createOptionDraft("B")],
    citations: question.citations?.length ? question.citations.map((citation) => createCitationDraft(citation)) : [createCitationDraft()]
  };
}

function formatBreakdown(breakdown: Record<string, number>): string {
  const entries = Object.entries(breakdown).sort((left, right) => right[1] - left[1]);
  if (!entries.length) {
    return "-";
  }
  return entries.map(([label, count]) => `${label}: ${count}`).join(" | ");
}

export function AdminShell() {
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isProtectedLoading, setIsProtectedLoading] = useState(false);
  const [isQuestionLoading, setIsQuestionLoading] = useState(false);
  const [activeTask, setActiveTask] = useState<
    | "refresh"
    | "ingest"
    | "export"
    | "captureSnapshot"
    | "saveExam"
    | "saveQuestion"
    | "submitReview"
    | "approveQuestion"
    | "publishQuestion"
    | "rollbackQuestion"
    | "deleteQuestion"
    | null
  >(null);

  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [toolbarNotice, setToolbarNotice] = useState<string | null>(null);
  const [examNotice, setExamNotice] = useState<string | null>(null);
  const [questionNotice, setQuestionNotice] = useState<string | null>(null);

  const [overview, setOverview] = useState<AdminOverview>(DEFAULT_ADMIN_OVERVIEW);
  const [analytics, setAnalytics] = useState<AdminQuestionAnalytics>(DEFAULT_ADMIN_ANALYTICS);
  const [exams, setExams] = useState<Exam[]>([]);
  const [questionItems, setQuestionItems] = useState<AdminQuestionSummary[]>([]);
  const [questionVersions, setQuestionVersions] = useState<AdminQuestionVersion[]>([]);
  const [questionAudit, setQuestionAudit] = useState<AdminAuditLog[]>([]);
  const [questionAnalyticsHistory, setQuestionAnalyticsHistory] = useState<AdminQuestionAnalyticsSnapshot[]>([]);
  const [questionQuality, setQuestionQuality] = useState<QuestionQuality | null>(null);
  const [questionQualitySignature, setQuestionQualitySignature] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  const [browserExamId, setBrowserExamId] = useState("");
  const [questionSearch, setQuestionSearch] = useState("");
  const [examDraft, setExamDraft] = useState<ExamDraft>(createEmptyExamDraft);
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft>(() => createEmptyQuestionDraft());

  const deferredQuestionSearch = useDeferredValue(questionSearch);
  const requestOptions = useMemo(() => buildAdminRequestOptions(), []);

  const questionPayload = useMemo(() => buildQuestionPayload(questionDraft), [questionDraft]);
  const questionPayloadSignature = useMemo(() => JSON.stringify(questionPayload), [questionPayload]);
  const questionValidationError = useMemo(() => validateQuestionPayload(questionPayload), [questionPayload]);

  const questionStats = useMemo(() => {
    const uniqueKeys = new Set(questionPayload.options.map((item) => item.key));
    return [
      { label: "Alternativas", value: String(questionPayload.options.length) },
      { label: "Corretas", value: String(questionPayload.correct_keys.length) },
      { label: "Tags", value: String(questionPayload.tags?.length || 0) },
      { label: "Referencias", value: String(questionPayload.citations?.length || 0) },
      { label: "Formato", value: questionPayload.multi_select ? "Multi-select" : "Single-select" },
      { label: "Chaves unicas", value: uniqueKeys.size === questionPayload.options.length ? "Sim" : "Nao" }
    ];
  }, [questionPayload]);

  const questionPreview = useMemo(() => JSON.stringify(questionPayload, null, 2), [questionPayload]);
  const hasQuestionDraftContent = useMemo(() => {
    return Boolean(
      questionDraft.id.trim() ||
        questionDraft.prompt.trim() ||
        questionDraft.changeSummary.trim() ||
        questionDraft.tagsText.trim() ||
        questionDraft.justification.trim() ||
        questionDraft.options.some((item) => item.text.trim()) ||
        questionDraft.citations.some((item) => item.source.trim() || item.reference.trim())
    );
  }, [questionDraft]);
  const currentDraftVersion = useMemo(
    () => questionVersions.find((item) => item.is_current_draft) || null,
    [questionVersions]
  );
  const currentPublishedVersion = useMemo(
    () => questionVersions.find((item) => item.is_current_published) || null,
    [questionVersions]
  );
  const isQualityStale = useMemo(
    () => Boolean(questionQuality && questionQualitySignature && questionQualitySignature !== questionPayloadSignature),
    [questionQuality, questionQualitySignature, questionPayloadSignature]
  );
  const currentWorkflowStatus = questionDraft.id.trim()
    ? currentDraftVersion?.status || currentPublishedVersion?.status || "draft"
    : "sem rascunho";
  const canSubmitForReview = Boolean(questionDraft.id.trim() && currentDraftVersion && currentDraftVersion.status === "draft");
  const canApprove = Boolean(questionDraft.id.trim() && currentDraftVersion && currentDraftVersion.status === "in_review");
  const canPublish = Boolean(questionDraft.id.trim() && currentDraftVersion && currentDraftVersion.status === "approved");

  const loadExams = useEffectEvent(async () => {
    try {
      const response = await apiClient.get<Exam[]>("/exams");
      setExams(response);
    } catch (_error) {
      setExams([]);
    }
  });

  const loadQuestionWorkflow = useEffectEvent(async (questionId: string) => {
    const normalizedQuestionId = questionId.trim();
    if (!normalizedQuestionId) {
      setQuestionVersions([]);
      setQuestionAudit([]);
      setQuestionAnalyticsHistory([]);
      setQuestionQuality(null);
      setQuestionQualitySignature("");
      return;
    }

    const [versionsResult, auditResult, historyResult] = await Promise.allSettled([
      apiClient.get<AdminQuestionVersion[]>(`/admin/questions/${encodeURIComponent(normalizedQuestionId)}/versions`, requestOptions),
      apiClient.get<AdminAuditLog[]>(`/admin/audit/logs?question_id=${encodeURIComponent(normalizedQuestionId)}&limit=20`, requestOptions),
      apiClient.get<AdminQuestionAnalyticsSnapshot[]>(
        `/admin/questions/${encodeURIComponent(normalizedQuestionId)}/analytics-history?limit=12`,
        requestOptions
      )
    ]);

    if (versionsResult.status === "fulfilled") {
      setQuestionVersions(versionsResult.value);
    } else {
      setQuestionVersions([]);
    }

    if (auditResult.status === "fulfilled") {
      setQuestionAudit(auditResult.value);
    } else {
      setQuestionAudit([]);
    }

    if (historyResult.status === "fulfilled") {
      setQuestionAnalyticsHistory(historyResult.value);
    } else {
      setQuestionAnalyticsHistory([]);
    }
  });

  const refreshProtectedData = useEffectEvent(async () => {
    setIsProtectedLoading(true);
    setPageNotice(null);

    const params = new URLSearchParams();
    params.set("limit", "200");
    if (browserExamId) {
      params.set("exam_id", browserExamId);
    }
    if (deferredQuestionSearch.trim()) {
      params.set("search", deferredQuestionSearch.trim());
    }

    const [overviewResult, analyticsResult, questionsResult] = await Promise.allSettled([
      apiClient.get<AdminOverview>("/admin/overview", requestOptions),
      apiClient.get<AdminQuestionAnalytics>("/admin/analytics/questions?limit=8", requestOptions),
      apiClient.get<AdminQuestionSummary[]>(`/admin/questions?${params.toString()}`, requestOptions)
    ]);

    const failures: string[] = [];

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
    } else {
      setOverview(DEFAULT_ADMIN_OVERVIEW);
      failures.push("overview");
    }

    if (analyticsResult.status === "fulfilled") {
      setAnalytics(analyticsResult.value);
    } else {
      setAnalytics(DEFAULT_ADMIN_ANALYTICS);
      failures.push("analytics editoriais");
    }

    if (questionsResult.status === "fulfilled") {
      setQuestionItems(questionsResult.value);
    } else {
      setQuestionItems([]);
      failures.push("lista de questoes");
    }

    if (failures.length) {
      const primaryError =
        overviewResult.status === "rejected"
          ? overviewResult.reason
          : analyticsResult.status === "rejected"
            ? analyticsResult.reason
            : questionsResult.status === "rejected"
              ? questionsResult.reason
              : null;
      setPageNotice(
        `${readAdminError(primaryError, "Nao foi possivel carregar o painel editorial.")} Blocos afetados: ${failures.join(", ")}.`
      );
    }

    setIsProtectedLoading(false);
  });

  const loadQuestion = useEffectEvent(async (questionId: string) => {
    const targetId = questionId.trim();
    if (!targetId) {
      setQuestionNotice("Informe um ID de questao para carregar.");
      return;
    }

    setIsQuestionLoading(true);
    setQuestionNotice(null);

    try {
      const response = await apiClient.get<AdminQuestion>(`/admin/questions/${encodeURIComponent(targetId)}`, requestOptions);
      const nextDraft = toQuestionDraft(response);
      setQuestionDraft(nextDraft);
      setQuestionQuality((response.quality as QuestionQuality | null) || null);
      setQuestionQualitySignature(JSON.stringify(buildQuestionPayload(nextDraft)));
      setSelectedQuestionId(response.id);
      await loadQuestionWorkflow(response.id);
      setQuestionNotice(`Questao ${response.id} carregada para edicao.`);
    } catch (error) {
      setQuestionVersions([]);
      setQuestionAudit([]);
      setQuestionAnalyticsHistory([]);
      setQuestionQuality(null);
      setQuestionQualitySignature("");
      setQuestionNotice(readAdminError(error, "Nao foi possivel carregar esta questao."));
    } finally {
      setIsQuestionLoading(false);
    }
  });

  useEffect(() => {
    void (async () => {
      await loadExams();
      setIsBootLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (isBootLoading) {
      return;
    }
    void refreshProtectedData();
  }, [browserExamId, deferredQuestionSearch, isBootLoading]);

  function updateQuestionDraft(patch: Partial<QuestionDraft>) {
    setQuestionDraft((current) => ({ ...current, ...patch }));
    setQuestionNotice(null);
  }

  function applyExamToDraft(examId: string) {
    const match = exams.find((item) => item.id === examId);
    if (!match) {
      setExamDraft(createEmptyExamDraft());
      return;
    }

    setExamDraft({
      id: match.id,
      title: match.title,
      source: String(match.source || ""),
      questionCount: match.question_count === null || match.question_count === undefined ? "" : String(match.question_count)
    });

    if (!questionDraft.examId) {
      updateQuestionDraft({ examId: match.id });
    }
  }

  function startNewQuestion() {
    setSelectedQuestionId(null);
    setQuestionDraft(createEmptyQuestionDraft(browserExamId || examDraft.id || questionDraft.examId));
    setQuestionVersions([]);
    setQuestionAudit([]);
    setQuestionAnalyticsHistory([]);
    setQuestionQuality(null);
    setQuestionQualitySignature("");
    setQuestionNotice("Novo rascunho criado. Preencha os campos e salve.");
  }

  function duplicateQuestion() {
    setSelectedQuestionId(null);
    setQuestionVersions([]);
    setQuestionAudit([]);
    setQuestionAnalyticsHistory([]);
    setQuestionQuality(null);
    setQuestionQualitySignature("");
    setQuestionDraft((current) => ({
      ...current,
      lookupId: "",
      id: "",
      changeSummary: "Duplicado a partir de uma questao existente"
    }));
    setQuestionNotice("Conteudo duplicado. Defina um novo ID antes de salvar.");
  }

  function clearExamForm() {
    setExamDraft(createEmptyExamDraft());
    setExamNotice(null);
  }

  async function handleRefresh() {
    setActiveTask("refresh");
    setToolbarNotice(null);

    try {
      await loadExams();
      await refreshProtectedData();
      setToolbarNotice("Painel editorial atualizado.");
    } catch (error) {
      setToolbarNotice(readAdminError(error));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleIngest() {
    setActiveTask("ingest");
    setToolbarNotice(null);

    try {
      const response = await apiClient.post<AdminIngestResponse>("/admin/ingest", {}, requestOptions);
      await loadExams();
      await refreshProtectedData();
      setToolbarNotice(
        `Importacao concluida. Importadas: ${response.imported}, puladas: ${response.skipped}, erros: ${response.errors?.length || 0}.`
      );
    } catch (error) {
      setToolbarNotice(readAdminError(error));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleExport() {
    setActiveTask("export");
    setToolbarNotice(null);

    try {
      const headers = new Headers();
      headers.set("X-Client-Key", getOrCreateClientKey());

      const token = getStoredAuthToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(buildApiUrl("/admin/export"), {
        method: "GET",
        headers,
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const blob = await response.blob();
      const link = document.createElement("a");
      const downloadUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get("content-disposition") || "";
      const filenameMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
      link.href = downloadUrl;
      link.download = filenameMatch?.[1] || "sentinel-quiz-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setToolbarNotice("Exportacao concluida. O arquivo JSON foi gerado pelo backend real.");
    } catch (error) {
      setToolbarNotice(readAdminError(error, "Nao foi possivel exportar o banco agora."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleCaptureSnapshot() {
    setActiveTask("captureSnapshot");
    setToolbarNotice(null);

    try {
      const response = await apiClient.post<AdminAnalyticsSnapshotCapture>("/admin/analytics/questions/snapshots", {}, requestOptions);
      if (!response.schema_ready) {
        setToolbarNotice(response.message || "O schema de snapshots ainda nao esta disponivel. Rode as migrations e tente novamente.");
        return;
      }
      await refreshProtectedData();
      if (selectedQuestionId) {
        await loadQuestionWorkflow(selectedQuestionId);
      }
      setToolbarNotice(
        response.snapshot_count > 0
          ? `Snapshot editorial registrado para ${response.snapshot_count} questao(oes).`
          : "Nenhuma questao elegivel para snapshot neste momento."
      );
    } catch (error) {
      setToolbarNotice(readAdminError(error, "Nao foi possivel registrar o snapshot editorial."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleSaveExam() {
    setActiveTask("saveExam");
    setExamNotice(null);

    try {
      const payload: AdminCreateExamInput = {
        id: examDraft.id.trim(),
        title: examDraft.title.trim(),
        source: examDraft.source.trim() || null,
        question_count: examDraft.questionCount.trim() ? Number(examDraft.questionCount.trim()) : null
      };

      if (!payload.id || !payload.title) {
        setExamNotice("Preencha ID e titulo antes de salvar.");
        return;
      }

      await apiClient.post<AdminMutationResponse>("/admin/exams", payload, requestOptions);
      await loadExams();
      await refreshProtectedData();
      setExamNotice(`Prova ${payload.id} salva.`);
      updateQuestionDraft({ examId: payload.id });
    } catch (error) {
      setExamNotice(readAdminError(error, "Nao foi possivel salvar a prova."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleSaveQuestion() {
    setActiveTask("saveQuestion");
    setQuestionNotice(null);

    try {
      const validationError = validateQuestionPayload(questionPayload);
      if (validationError) {
        setQuestionNotice(validationError);
        return;
      }

      const response = await apiClient.post<AdminMutationResponse>("/admin/questions", questionPayload, requestOptions);
      setSelectedQuestionId(questionPayload.id);
      await loadQuestion(questionPayload.id);
      await refreshProtectedData();
      setQuestionNotice(
        `Rascunho salvo para ${questionPayload.id}${response.version_number ? ` (v${response.version_number})` : ""}.`
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel salvar a questao."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleSubmitReview() {
    const questionId = questionDraft.id.trim();
    if (!questionId) {
      setQuestionNotice("Salve um rascunho antes de enviar para revisao.");
      return;
    }

    setActiveTask("submitReview");
    setQuestionNotice(null);

    try {
      const payload: AdminReviewActionInput = {
        reason: questionDraft.changeSummary.trim() || null
      };
      const response = await apiClient.post<AdminMutationResponse>(
        `/admin/questions/${encodeURIComponent(questionId)}/submit-review`,
        payload,
        requestOptions
      );
      await loadQuestion(questionId);
      await refreshProtectedData();
      setQuestionNotice(
        `Questao ${questionId} enviada para revisao${response.version_number ? ` (v${response.version_number})` : ""}.`
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel enviar a questao para revisao."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleApproveQuestion() {
    const questionId = questionDraft.id.trim();
    if (!questionId) {
      setQuestionNotice("Salve e envie um rascunho para revisao antes de aprovar.");
      return;
    }

    setActiveTask("approveQuestion");
    setQuestionNotice(null);

    try {
      const payload: AdminReviewActionInput = {
        reason: questionDraft.changeSummary.trim() || null
      };
      const response = await apiClient.post<AdminMutationResponse>(
        `/admin/questions/${encodeURIComponent(questionId)}/approve`,
        payload,
        requestOptions
      );
      await loadQuestion(questionId);
      await refreshProtectedData();
      setQuestionNotice(
        `Questao ${questionId} aprovada para publicacao${response.version_number ? ` (v${response.version_number})` : ""}.`
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel aprovar a questao."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handlePublishQuestion() {
    const questionId = questionDraft.id.trim();
    if (!questionId) {
      setQuestionNotice("Salve um rascunho antes de publicar.");
      return;
    }

    setActiveTask("publishQuestion");
    setQuestionNotice(null);

    try {
      const payload: AdminReviewActionInput = {
        reason: questionDraft.changeSummary.trim() || null
      };
      const response = await apiClient.post<AdminMutationResponse>(
        `/admin/questions/${encodeURIComponent(questionId)}/publish`,
        payload,
        requestOptions
      );
      await loadQuestion(questionId);
      await refreshProtectedData();
      setQuestionNotice(
        `Questao ${questionId} publicada${response.version_number ? ` (v${response.version_number})` : ""}.`
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel publicar a questao."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleRollbackQuestion(versionId: number) {
    const questionId = questionDraft.id.trim();
    if (!questionId) {
      setQuestionNotice("Carregue uma questao antes de reverter.");
      return;
    }

    const reason = window.prompt(
      `Explique o rollback da questao ${questionId} para a versao selecionada:`,
      `Rollback para a versao ${versionId}`
    );
    if (reason === null) {
      return;
    }

    setActiveTask("rollbackQuestion");
    setQuestionNotice(null);

    try {
      const payload: AdminRollbackInput = {
        version_id: versionId,
        reason: reason.trim() || null
      };
      const response = await apiClient.post<AdminMutationResponse>(
        `/admin/questions/${encodeURIComponent(questionId)}/rollback`,
        payload,
        requestOptions
      );
      await loadQuestion(questionId);
      await refreshProtectedData();
      setQuestionNotice(
        `Questao ${questionId} revertida e republicada${response.version_number ? ` (v${response.version_number})` : ""}.`
      );
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel reverter a questao."));
    } finally {
      setActiveTask(null);
    }
  }

  async function handleDeleteQuestion() {
    const questionId = questionDraft.id.trim();
    if (!questionId) {
      setQuestionNotice("Nenhuma questao selecionada para exclusao.");
      return;
    }

    if (!window.confirm(`Excluir a questao ${questionId}? Esta acao nao pode ser desfeita.`)) {
      return;
    }

    setActiveTask("deleteQuestion");
    setQuestionNotice(null);

    try {
      await apiClient.delete<AdminMutationResponse>(
        `/admin/questions/${encodeURIComponent(questionId)}`,
        requestOptions
      );
      await refreshProtectedData();
      setSelectedQuestionId(null);
      setQuestionVersions([]);
      setQuestionAudit([]);
      setQuestionAnalyticsHistory([]);
      setQuestionQuality(null);
      setQuestionQualitySignature("");
      setQuestionDraft(createEmptyQuestionDraft(browserExamId || examDraft.id));
      setQuestionNotice(`Questao ${questionId} excluida.`);
    } catch (error) {
      setQuestionNotice(readAdminError(error, "Nao foi possivel excluir a questao."));
    } finally {
      setActiveTask(null);
    }
  }

  if (isBootLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={320} />
          <Skeleton height={620} />
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
              <div className="sq-page-title">Sentinel Quiz Admin</div>
              <p className="sq-page-subtitle">
                Painel editorial migrado para Next.js com CRUD real, preview de payload e acesso seguro por sessao.
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/history">Historico</Link>
          </div>
        </header>

        {pageNotice ? (
          <StatusBanner
            tone="warning"
            title="Acesso editorial"
            message={pageNotice}
            role="alert"
          />
        ) : null}

        <Card
          title="Acesso e manutencao"
          subtitle="Todas as operacoes editoriais exigem uma sessao autenticada com papel admin."
          actions={
            <div className="sq-actions">
              <Button variant="ghost" size="sm" busy={activeTask === "refresh"} onClick={() => void handleRefresh()}>
                Atualizar
              </Button>
              <Button variant="secondary" size="sm" busy={activeTask === "ingest"} onClick={() => void handleIngest()}>
                Reimportar JSONs
              </Button>
              <Button variant="ghost" size="sm" busy={activeTask === "export"} onClick={() => void handleExport()}>
                Exportar banco
              </Button>
            </div>
          }
        >
          <div className="sq-surface-block">
            <div className="sq-form-grid">
              <div className="sq-surface-block">
                <div className="sq-list-title">Controle de acesso</div>
                <div className="sq-list-meta">
                  O backend aceita apenas usuarios admin autenticados. O painel nao usa mais chave estatica nem header editorial.
                </div>
              </div>

              <div className="sq-surface-block">
                <div className="sq-list-title">Resumo rapido</div>
                <div className="sq-list-meta">{formatBreakdown(overview.question_breakdown)}</div>
              </div>
            </div>

            {toolbarNotice ? <StatusBanner tone="neutral" title="Status" message={toolbarNotice} /> : null}

            <div className="sq-metric-grid" aria-label="Resumo editorial">
              <div className="sq-metric-card">
                <span className="sq-muted">Provas</span>
                <strong>{overview.exam_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Questoes</span>
                <strong>{overview.question_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">Sessoes concluidas</span>
                <strong>{overview.completed_session_count}</strong>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Insights editoriais"
          subtitle="Veja onde o banco esta mais sensivel antes de editar ou publicar."
          actions={
            <Button variant="secondary" size="sm" busy={activeTask === "captureSnapshot"} onClick={() => void handleCaptureSnapshot()}>
              Registrar snapshot
            </Button>
          }
        >
          <div className="sq-metric-grid" aria-label="Resumo de sinais editoriais">
            <div className="sq-metric-card">
              <span className="sq-muted">Questoes com sinal</span>
              <strong>{analytics.summary.questions_with_signals}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Tentativas totais</span>
              <strong>{analytics.summary.total_attempts}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Erro medio</span>
              <strong>{analytics.summary.average_wrong_rate_percent}%</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Pressao de revisao</span>
              <strong>{analytics.summary.total_review_pressure}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Snapshots</span>
              <strong>{analytics.summary.snapshot_batch_count}</strong>
            </div>
            <div className="sq-metric-card">
              <span className="sq-muted">Ultimo snapshot</span>
              <strong>{analytics.summary.latest_snapshot_at || "-"}</strong>
            </div>
          </div>

          <div className="sq-grid-2" style={{ marginTop: "var(--sq-space-5)" }}>
            <div className="sq-surface-block">
              <div className="sq-list-title">Questoes mais sensiveis</div>
              {analytics.hardest_questions.length ? (
                <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                  {analytics.hardest_questions.map((item) => (
                    <div key={item.id} className="sq-list-item">
                      <div className="sq-list-title">{item.id}</div>
                      <div className="sq-list-meta">
                        {item.exam_title || item.exam_id} · {item.domain || "Sem dominio"} · erro {item.wrong_rate_percent}% ·
                        score {item.difficulty_score}
                      </div>
                      <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                        {item.prompt}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
                  Ainda nao ha sinal suficiente para destacar questoes.
                </div>
              )}
            </div>

            <div className="sq-page-stack">
              <div className="sq-surface-block">
                <div className="sq-list-title">Dominios mais fracos</div>
                {analytics.weakest_domains.length ? (
                  <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                    {analytics.weakest_domains.map((item) => (
                      <div key={item.domain} className="sq-list-item">
                        <div className="sq-list-title">{item.domain}</div>
                        <div className="sq-list-meta">
                          erro {item.wrong_rate_percent}% · {item.attempts_total} tentativa(s) · pressao {item.review_pressure_count}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
                    Sem dominios com historico relevante ainda.
                  </div>
                )}
              </div>

              <div className="sq-surface-block">
                <div className="sq-list-title">Provas com maior atrito</div>
                {analytics.weakest_exams.length ? (
                  <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                    {analytics.weakest_exams.map((item) => (
                      <div key={item.exam_id} className="sq-list-item">
                        <div className="sq-list-title">{item.exam_title}</div>
                        <div className="sq-list-meta">
                          {item.exam_id} · erro {item.wrong_rate_percent}% · {item.tracked_questions} questao(oes) com sinal
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sq-empty" style={{ marginTop: "var(--sq-space-3)" }}>
                    Sem prova com atrito consolidado ainda.
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "var(--sq-space-6)",
            alignItems: "start"
          }}
        >
          <div className="sq-page-stack">
            <Card
              title="Explorar questoes"
              subtitle="Filtre, navegue e carregue uma questao sem sair da mesma tela."
              actions={
                <Button variant="secondary" size="sm" onClick={startNewQuestion}>
                  Nova questao
                </Button>
              }
            >
              <div className="sq-surface-block">
                <div className="sq-form-grid">
                  <Field label="Prova" htmlFor="browser-exam-filter">
                    <select
                      id="browser-exam-filter"
                      className="sq-select"
                      value={browserExamId}
                      onChange={(event) => setBrowserExamId(event.target.value)}
                    >
                      <option value="">Todas</option>
                      {exams.map((exam) => (
                        <option key={exam.id} value={exam.id}>
                          {exam.title}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="Buscar"
                    htmlFor="admin-question-search"
                    hint="Procure por ID, dominio, certificacao ou trecho do enunciado."
                  >
                    <input
                      id="admin-question-search"
                      className="sq-input"
                      type="search"
                      value={questionSearch}
                      onChange={(event) => setQuestionSearch(event.target.value)}
                    />
                  </Field>
                </div>

                <div className="sq-list-meta">
                  {isProtectedLoading ? "Atualizando lista..." : `${questionItems.length} questao(oes) encontradas.`}
                </div>

                {questionItems.length ? (
                  <div className="sq-list" role="list" aria-label="Lista de questoes">
                    {questionItems.map((item) => {
                      const isActive = item.id === selectedQuestionId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="sq-list-item"
                          onClick={() => void loadQuestion(item.id)}
                          aria-pressed={isActive}
                          style={{
                            textAlign: "left",
                            borderColor: isActive ? "rgba(21,122,110,0.3)" : "var(--sq-border)",
                            background: isActive ? "rgba(21,122,110,0.08)" : "rgba(255,255,255,0.78)"
                          }}
                        >
                          <div className="sq-list-title">
                            {item.id} · {item.exam_id}
                          </div>
                          <div className="sq-list-meta">{summarizePrompt(item.prompt)}</div>
                          <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
                            {item.certification ? <span className="sq-chip">{item.certification}</span> : null}
                            {item.domain ? <span className="sq-chip">{item.domain}</span> : null}
                            {item.difficulty ? <span className="sq-chip">{item.difficulty}</span> : null}
                            {item.editorial_status ? <span className="sq-chip">{item.editorial_status}</span> : null}
                            {item.draft_version_number ? <span className="sq-chip">draft v{item.draft_version_number}</span> : null}
                            {item.published_version_number ? (
                              <span className="sq-chip">pub v{item.published_version_number}</span>
                            ) : null}
                            <span className="sq-chip">
                              {item.correct_count}/{item.option_count} corretas
                            </span>
                            <span className="sq-chip">{item.multi_select ? "multi" : "single"}</span>
                            {item.loaded_from === "draft" ? <span className="sq-chip">rascunho</span> : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="sq-empty">
                    Nenhuma questao carregada. Revise a permissao editorial ou ajuste os filtros para continuar.
                  </div>
                )}
              </div>
            </Card>

            <Card title="Cadastro de prova" subtitle="Atualize o catalogo de provas sem sair do editor.">
              <div className="sq-surface-block">
                <Field label="Provas cadastradas" htmlFor="admin-exam-select">
                  <select
                    id="admin-exam-select"
                    className="sq-select"
                    value={examDraft.id}
                    onChange={(event) => applyExamToDraft(event.target.value)}
                  >
                    <option value="">Selecione uma prova</option>
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.title} ({exam.id})
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="sq-form-grid">
                  <Field label="ID da prova" htmlFor="admin-exam-id">
                    <input
                      id="admin-exam-id"
                      className="sq-input"
                      type="text"
                      value={examDraft.id}
                      onChange={(event) => {
                        setExamDraft((current) => ({ ...current, id: event.target.value }));
                        setExamNotice(null);
                      }}
                    />
                  </Field>

                  <Field label="Qtd. de questoes" htmlFor="admin-exam-count">
                    <input
                      id="admin-exam-count"
                      className="sq-input"
                      type="number"
                      min="0"
                      value={examDraft.questionCount}
                      onChange={(event) => {
                        setExamDraft((current) => ({ ...current, questionCount: event.target.value }));
                        setExamNotice(null);
                      }}
                    />
                  </Field>
                </div>

                <Field label="Titulo" htmlFor="admin-exam-title">
                  <input
                    id="admin-exam-title"
                    className="sq-input"
                    type="text"
                    value={examDraft.title}
                    onChange={(event) => {
                      setExamDraft((current) => ({ ...current, title: event.target.value }));
                      setExamNotice(null);
                    }}
                  />
                </Field>

                <Field label="Fonte" htmlFor="admin-exam-source" hint="Ex.: questions/securityplus.json">
                  <input
                    id="admin-exam-source"
                    className="sq-input"
                    type="text"
                    value={examDraft.source}
                    onChange={(event) => {
                      setExamDraft((current) => ({ ...current, source: event.target.value }));
                      setExamNotice(null);
                    }}
                  />
                </Field>

                {examNotice ? <StatusBanner tone="neutral" title="Prova" message={examNotice} /> : null}

                <div className="sq-actions">
                  <Button busy={activeTask === "saveExam"} onClick={() => void handleSaveExam()}>
                    Salvar prova
                  </Button>
                  <Button variant="ghost" onClick={clearExamForm}>
                    Limpar
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <Card
            title="Editor de questao"
            subtitle="Edite tudo em um fluxo unico: metadados, alternativas, justificativa, referencias e preview do payload."
            actions={
              <div className="sq-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  busy={isQuestionLoading}
                  onClick={() => void loadQuestion(questionDraft.lookupId || questionDraft.id)}
                >
                  Carregar
                </Button>
                <Button variant="ghost" size="sm" onClick={duplicateQuestion}>
                  Duplicar
                </Button>
                <Button variant="danger" size="sm" busy={activeTask === "deleteQuestion"} onClick={() => void handleDeleteQuestion()}>
                  Excluir
                </Button>
              </div>
            }
          >
            <div className="sq-surface-block">
              {questionNotice ? <StatusBanner tone="neutral" title="Questao" message={questionNotice} /> : null}
              {hasQuestionDraftContent && questionValidationError ? (
                <StatusBanner tone="warning" title="Validacao" message={questionValidationError} />
              ) : null}

              <div className="sq-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <Field label="Buscar por ID" htmlFor="admin-q-lookup">
                  <input
                    id="admin-q-lookup"
                    className="sq-input"
                    type="text"
                    value={questionDraft.lookupId}
                    onChange={(event) => updateQuestionDraft({ lookupId: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void loadQuestion(questionDraft.lookupId || questionDraft.id);
                      }
                    }}
                  />
                </Field>

                <Field label="ID da questao" htmlFor="admin-q-id">
                  <input
                    id="admin-q-id"
                    className="sq-input"
                    type="text"
                    value={questionDraft.id}
                    onChange={(event) => updateQuestionDraft({ id: event.target.value })}
                  />
                </Field>

                <Field label="Prova" htmlFor="admin-q-exam">
                  <select
                    id="admin-q-exam"
                    className="sq-select"
                    value={questionDraft.examId}
                    onChange={(event) => updateQuestionDraft({ examId: event.target.value })}
                  >
                    <option value="">Selecione uma prova</option>
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.title}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="sq-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <Field label="Certificacao" htmlFor="admin-q-certification">
                  <input
                    id="admin-q-certification"
                    className="sq-input"
                    type="text"
                    value={questionDraft.certification}
                    onChange={(event) => updateQuestionDraft({ certification: event.target.value })}
                  />
                </Field>

                <Field label="Dominio" htmlFor="admin-q-domain">
                  <input
                    id="admin-q-domain"
                    className="sq-input"
                    type="text"
                    value={questionDraft.domain}
                    onChange={(event) => updateQuestionDraft({ domain: event.target.value })}
                  />
                </Field>

                <Field label="Dificuldade" htmlFor="admin-q-difficulty">
                  <select
                    id="admin-q-difficulty"
                    className="sq-select"
                    value={questionDraft.difficulty}
                    onChange={(event) => updateQuestionDraft({ difficulty: event.target.value })}
                  >
                    <option value="">Nao definido</option>
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </Field>

                <Field label="Selecao" htmlFor="admin-q-selection-mode">
                  <select
                    id="admin-q-selection-mode"
                    className="sq-select"
                    value={questionDraft.multiSelect ? "true" : "false"}
                    onChange={(event) => updateQuestionDraft({ multiSelect: event.target.value === "true" })}
                  >
                    <option value="false">Single-select</option>
                    <option value="true">Multi-select</option>
                  </select>
                </Field>
              </div>

              <div className="sq-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <Field label="Assunto" htmlFor="admin-q-subject">
                  <input
                    id="admin-q-subject"
                    className="sq-input"
                    type="text"
                    value={questionDraft.subject}
                    onChange={(event) => updateQuestionDraft({ subject: event.target.value })}
                  />
                </Field>

                <Field label="Subtopico" htmlFor="admin-q-subtopic">
                  <input
                    id="admin-q-subtopic"
                    className="sq-input"
                    type="text"
                    value={questionDraft.subtopic}
                    onChange={(event) => updateQuestionDraft({ subtopic: event.target.value })}
                  />
                </Field>

                <Field label="Subdominio" htmlFor="admin-q-subdomain">
                  <input
                    id="admin-q-subdomain"
                    className="sq-input"
                    type="text"
                    value={questionDraft.subdomain}
                    onChange={(event) => updateQuestionDraft({ subdomain: event.target.value })}
                  />
                </Field>

                <Field label="Formato pedagogico" htmlFor="admin-q-format">
                  <select
                    id="admin-q-format"
                    className="sq-select"
                    value={questionDraft.questionFormat}
                    onChange={(event) => updateQuestionDraft({ questionFormat: event.target.value })}
                  >
                    {QUESTION_FORMAT_OPTIONS.map((option) => (
                      <option key={option.value || "auto"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Objective code" htmlFor="admin-q-objective-code">
                  <input
                    id="admin-q-objective-code"
                    className="sq-input"
                    type="text"
                    value={questionDraft.objectiveCode}
                    onChange={(event) => updateQuestionDraft({ objectiveCode: event.target.value })}
                  />
                </Field>

                <Field label="Blueprint code" htmlFor="admin-q-blueprint-code">
                  <input
                    id="admin-q-blueprint-code"
                    className="sq-input"
                    type="text"
                    value={questionDraft.blueprintCode}
                    onChange={(event) => updateQuestionDraft({ blueprintCode: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="Pergunta" htmlFor="admin-q-prompt">
                <textarea
                  id="admin-q-prompt"
                  className="sq-textarea"
                  rows={7}
                  value={questionDraft.prompt}
                  onChange={(event) => updateQuestionDraft({ prompt: event.target.value })}
                />
              </Field>

              <div className="sq-form-grid">
                <Field
                  label="Tags (separadas por virgula)"
                  htmlFor="admin-q-tags"
                  hint="Use tags curtas e consistentes para filtros e analytics."
                >
                  <input
                    id="admin-q-tags"
                    className="sq-input"
                    type="text"
                    value={questionDraft.tagsText}
                    onChange={(event) => updateQuestionDraft({ tagsText: event.target.value })}
                  />
                </Field>

                <Field
                  label="Racional correto"
                  htmlFor="admin-q-justification"
                  hint="Explique com clareza por que a resposta correta e a melhor escolha."
                >
                  <textarea
                    id="admin-q-justification"
                    className="sq-textarea"
                    rows={6}
                    value={questionDraft.correctRationale}
                    onChange={(event) => updateQuestionDraft({ correctRationale: event.target.value, justification: event.target.value })}
                  />
                </Field>
              </div>

              <div className="sq-form-grid">
                <Field
                  label="Keywords"
                  htmlFor="admin-q-keywords"
                  hint="Separadas por virgula. Alimentam busca, analytics e sugestoes."
                >
                  <input
                    id="admin-q-keywords"
                    className="sq-input"
                    type="text"
                    value={joinTextList(questionDraft.keywords)}
                    onChange={(event) => updateQuestionDraft({ keywords: normalizeTags(event.target.value) })}
                  />
                </Field>

                <Field
                  label="Pegadinhas comuns"
                  htmlFor="admin-q-traps"
                  hint="Liste erros conceituais ou confusoes frequentes."
                >
                  <input
                    id="admin-q-traps"
                    className="sq-input"
                    type="text"
                    value={joinTextList(questionDraft.trapPatterns)}
                    onChange={(event) => updateQuestionDraft({ trapPatterns: normalizeTags(event.target.value) })}
                  />
                </Field>
              </div>

              <div className="sq-form-grid">
                <Field
                  label="Racionais das incorretas"
                  htmlFor="admin-q-incorrect-rationales"
                  hint="Uma linha por distrator, sem revelar o gabarito diretamente."
                >
                  <textarea
                    id="admin-q-incorrect-rationales"
                    className="sq-textarea"
                    rows={5}
                    value={questionDraft.incorrectRationales.join("\n")}
                    onChange={(event) =>
                      updateQuestionDraft({ incorrectRationales: splitTextareaLines(event.target.value) })
                    }
                  />
                </Field>

                <Field
                  label="Justificativa legada"
                  htmlFor="admin-q-legacy-justification"
                  hint="Mantida por compatibilidade com a projeção usada pelos modos de estudo/prova."
                >
                  <textarea
                    id="admin-q-legacy-justification"
                    className="sq-textarea"
                    rows={5}
                    value={questionDraft.justification}
                    onChange={(event) => updateQuestionDraft({ justification: event.target.value })}
                  />
                </Field>
              </div>

              <div className="sq-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <Field label="Tempo medio (s)" htmlFor="admin-q-avg-time">
                  <input
                    id="admin-q-avg-time"
                    className="sq-input"
                    type="number"
                    min={0}
                    step="1"
                    value={questionDraft.avgTimeSeconds}
                    onChange={(event) => updateQuestionDraft({ avgTimeSeconds: event.target.value })}
                  />
                </Field>

                <Field label="Acerto global (%)" htmlFor="admin-q-global-accuracy">
                  <input
                    id="admin-q-global-accuracy"
                    className="sq-input"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={questionDraft.globalAccuracyPercent}
                    onChange={(event) => updateQuestionDraft({ globalAccuracyPercent: event.target.value })}
                  />
                </Field>
              </div>

              <Field
                label="Resumo da mudanca"
                htmlFor="admin-q-change-summary"
                hint="Registre o motivo da edicao. Esse texto entra no historico e ajuda na auditoria."
              >
                <textarea
                  id="admin-q-change-summary"
                  className="sq-textarea"
                  rows={3}
                  value={questionDraft.changeSummary}
                  onChange={(event) => updateQuestionDraft({ changeSummary: event.target.value })}
                />
              </Field>

              <div className="sq-grid-2">
                <Card
                  title="Alternativas"
                  subtitle="Marque a(s) correta(s). A API valida duplicidades e consistencia final."
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setQuestionDraft((current) => ({
                          ...current,
                          options: [...current.options, createOptionDraft(nextOptionKey(current.options))]
                        }))
                      }
                    >
                      Adicionar
                    </Button>
                  }
                >
                  <div className="sq-list">
                    {questionDraft.options.map((option, index) => (
                      <div key={option.rowId} className="sq-list-item" style={{ display: "grid", gap: "var(--sq-space-3)" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "88px minmax(0, 1fr) auto auto",
                            gap: "var(--sq-space-3)",
                            alignItems: "center"
                          }}
                        >
                          <input
                            className="sq-input"
                            aria-label={`Chave da alternativa ${index + 1}`}
                            type="text"
                            maxLength={2}
                            value={option.key}
                            onChange={(event) =>
                              setQuestionDraft((current) => ({
                                ...current,
                                options: current.options.map((item) =>
                                  item.rowId === option.rowId ? { ...item, key: event.target.value.toUpperCase() } : item
                                )
                              }))
                            }
                          />

                          <input
                            className="sq-input"
                            aria-label={`Texto da alternativa ${index + 1}`}
                            type="text"
                            value={option.text}
                            onChange={(event) =>
                              setQuestionDraft((current) => ({
                                ...current,
                                options: current.options.map((item) =>
                                  item.rowId === option.rowId ? { ...item, text: event.target.value } : item
                                )
                              }))
                            }
                          />

                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "var(--sq-space-2)",
                              fontSize: "0.9rem"
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={option.isCorrect}
                              onChange={(event) =>
                                setQuestionDraft((current) => ({
                                  ...current,
                                  options: current.options.map((item) =>
                                    item.rowId === option.rowId ? { ...item, isCorrect: event.target.checked } : item
                                  )
                                }))
                              }
                            />
                            Correta
                          </label>

                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={questionDraft.options.length <= 2}
                            onClick={() =>
                              setQuestionDraft((current) => ({
                                ...current,
                                options:
                                  current.options.length <= 2
                                    ? current.options
                                    : current.options.filter((item) => item.rowId !== option.rowId)
                              }))
                            }
                          >
                            Remover
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card
                  title="Referencias de estudo"
                  subtitle="As referencias aparecem na revisao. Metadados extras de EPUB sao preservados no save."
                  actions={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setQuestionDraft((current) => ({
                          ...current,
                          citations: [...current.citations, createCitationDraft()]
                        }))
                      }
                    >
                      Adicionar
                    </Button>
                  }
                >
                  <div className="sq-list">
                    {questionDraft.citations.map((citation, index) => {
                      const hasExtraMetadata = Object.keys(citation.original).some(
                        (key) => !["source", "reference"].includes(key) && hasCitationValue(citation.original[key])
                      );

                      return (
                        <div key={citation.rowId} className="sq-list-item" style={{ display: "grid", gap: "var(--sq-space-3)" }}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
                              gap: "var(--sq-space-3)",
                              alignItems: "center"
                            }}
                          >
                            <input
                              className="sq-input"
                              aria-label={`Fonte da referencia ${index + 1}`}
                              type="text"
                              value={citation.source}
                              onChange={(event) =>
                                setQuestionDraft((current) => ({
                                  ...current,
                                  citations: current.citations.map((item) =>
                                    item.rowId === citation.rowId ? { ...item, source: event.target.value } : item
                                  )
                                }))
                              }
                            />

                            <input
                              className="sq-input"
                              aria-label={`Descricao da referencia ${index + 1}`}
                              type="text"
                              value={citation.reference}
                              onChange={(event) =>
                                setQuestionDraft((current) => ({
                                  ...current,
                                  citations: current.citations.map((item) =>
                                    item.rowId === citation.rowId ? { ...item, reference: event.target.value } : item
                                  )
                                }))
                              }
                            />

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setQuestionDraft((current) => {
                                  const remaining = current.citations.filter((item) => item.rowId !== citation.rowId);
                                  return {
                                    ...current,
                                    citations: remaining.length ? remaining : [createCitationDraft()]
                                  };
                                })
                              }
                            >
                              Remover
                            </Button>
                          </div>

                          {hasExtraMetadata ? (
                            <div className="sq-chip-row">
                              <span className="sq-chip">Metadados EPUB preservados no payload</span>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              </div>

              <div className="sq-grid-2">
                <div className="sq-page-stack">
                  <Card
                    title="Qualidade editorial"
                    subtitle="Completude, bloqueios e aderencia ao blueprint antes de seguir no workflow."
                  >
                    {questionQuality ? (
                      <div className="sq-page-stack">
                        <div className="sq-metric-grid">
                          <div className="sq-metric-card">
                            <span className="sq-muted">Completude</span>
                            <strong>{questionQuality.completeness_score}%</strong>
                          </div>
                          <div className="sq-metric-card">
                            <span className="sq-muted">Pronta para publicar</span>
                            <strong>{questionQuality.is_publish_ready ? "Sim" : "Nao"}</strong>
                          </div>
                          <div className="sq-metric-card">
                            <span className="sq-muted">Bloqueios</span>
                            <strong>{questionQuality.blocking_issues.length}</strong>
                          </div>
                          <div className="sq-metric-card">
                            <span className="sq-muted">Alertas</span>
                            <strong>{questionQuality.warnings.length}</strong>
                          </div>
                        </div>

                        {isQualityStale ? (
                          <StatusBanner
                            tone="warning"
                            title="Analise desatualizada"
                            message="Voce alterou o rascunho depois da ultima avaliacao do backend. Salve para recalcular a qualidade."
                          />
                        ) : null}

                        {questionQuality.blocking_issues.length ? (
                          <StatusBanner
                            tone="warning"
                            title="Bloqueios editoriais"
                            message={questionQuality.blocking_issues.join(" | ")}
                          />
                        ) : (
                          <StatusBanner
                            tone="success"
                            title="Base editorial valida"
                            message="Nao ha bloqueios criticos nesta avaliacao."
                          />
                        )}

                        {questionQuality.warnings.length ? (
                          <div className="sq-surface-block">
                            <div className="sq-list-title">Alertas de melhoria</div>
                            <div className="sq-list" style={{ marginTop: "var(--sq-space-3)" }}>
                              {questionQuality.warnings.map((item) => (
                                <div key={item} className="sq-list-item">
                                  <div className="sq-list-meta">{item}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="sq-surface-block">
                          <div className="sq-list-title">Checklist por campo</div>
                          <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                            {Object.entries(questionQuality.field_status).map(([field, status]) => (
                              <span
                                key={field}
                                className="sq-chip"
                                style={{
                                  background:
                                    qualityTone(status) === "good"
                                      ? "rgba(34, 197, 94, 0.12)"
                                      : qualityTone(status) === "warning"
                                        ? "rgba(245, 158, 11, 0.14)"
                                        : undefined,
                                  borderColor:
                                    qualityTone(status) === "good"
                                      ? "rgba(34, 197, 94, 0.25)"
                                      : qualityTone(status) === "warning"
                                        ? "rgba(245, 158, 11, 0.25)"
                                        : undefined
                                }}
                              >
                                {field}: {formatQualityStatus(status)}
                              </span>
                            ))}
                          </div>
                        </div>

                        {(questionQuality.blueprint?.certification ||
                          questionQuality.blueprint?.blueprint_code ||
                          questionQuality.blueprint?.objective_code) ? (
                          <div className="sq-surface-block">
                            <div className="sq-list-title">Blueprint vinculado</div>
                            <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-3)" }}>
                              {questionQuality.blueprint?.certification ? (
                                <span className="sq-chip">{questionQuality.blueprint.certification}</span>
                              ) : null}
                              {questionQuality.blueprint?.domain ? (
                                <span className="sq-chip">{questionQuality.blueprint.domain}</span>
                              ) : null}
                              {questionQuality.blueprint?.subdomain ? (
                                <span className="sq-chip">{questionQuality.blueprint.subdomain}</span>
                              ) : null}
                              {questionQuality.blueprint?.objective_code ? (
                                <span className="sq-chip">OBJ {questionQuality.blueprint.objective_code}</span>
                              ) : null}
                              {questionQuality.blueprint?.blueprint_code ? (
                                <span className="sq-chip">BP {questionQuality.blueprint.blueprint_code}</span>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="sq-empty">
                        Salve ou carregue uma questao para receber o diagnostico editorial completo do backend.
                      </div>
                    )}
                  </Card>

                  <Card
                    title="Workflow editorial"
                    subtitle="Fluxo real: draft -> in_review -> approved -> published. A publicacao exige aprovacao explicita."
                  >
                    <div className="sq-metric-grid">
                      <div className="sq-metric-card">
                        <span className="sq-muted">Status atual</span>
                        <strong>{currentWorkflowStatus}</strong>
                      </div>
                      <div className="sq-metric-card">
                        <span className="sq-muted">Rascunho atual</span>
                        <strong>
                          {currentDraftVersion?.version_number ? `v${currentDraftVersion.version_number}` : "-"}
                        </strong>
                      </div>
                      <div className="sq-metric-card">
                        <span className="sq-muted">Publicado</span>
                        <strong>
                          {currentPublishedVersion?.version_number ? `v${currentPublishedVersion.version_number}` : "-"}
                        </strong>
                      </div>
                      <div className="sq-metric-card">
                        <span className="sq-muted">Eventos auditados</span>
                        <strong>{questionAudit.length}</strong>
                      </div>
                      <div className="sq-metric-card">
                        <span className="sq-muted">Snapshots</span>
                        <strong>{questionAnalyticsHistory.length}</strong>
                      </div>
                    </div>

                    <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-4)" }}>
                      <span className="sq-chip">1. Salvar rascunho</span>
                      <span className="sq-chip">2. Enviar para revisao</span>
                      <span className="sq-chip">3. Aprovar</span>
                      <span className="sq-chip">4. Publicar</span>
                    </div>

                    <div className="sq-actions" style={{ marginTop: "var(--sq-space-4)" }}>
                      <Button busy={activeTask === "saveQuestion"} onClick={() => void handleSaveQuestion()}>
                        Salvar rascunho
                      </Button>
                      <Button
                        variant="secondary"
                        busy={activeTask === "submitReview"}
                        disabled={!canSubmitForReview}
                        onClick={() => void handleSubmitReview()}
                        title={canSubmitForReview ? "Enviar o rascunho atual para revisao" : "Somente rascunhos podem seguir para revisao"}
                      >
                        Enviar para revisao
                      </Button>
                      <Button
                        variant="secondary"
                        busy={activeTask === "approveQuestion"}
                        disabled={!canApprove}
                        onClick={() => void handleApproveQuestion()}
                        title={canApprove ? "Aprovar a versao em revisao" : "Aprovacao so fica disponivel para versoes em revisao"}
                      >
                        Aprovar
                      </Button>
                      <Button
                        variant="ghost"
                        busy={activeTask === "publishQuestion"}
                        disabled={!canPublish}
                        onClick={() => void handlePublishQuestion()}
                        title={canPublish ? "Publicar a versao aprovada" : "A publicacao exige uma versao aprovada"}
                      >
                        Publicar
                      </Button>
                      <Button variant="ghost" onClick={startNewQuestion}>
                        Novo rascunho
                      </Button>
                    </div>
                  </Card>
                </div>

                <div className="sq-page-stack">
                  <Card title="Historico de versoes" subtitle="Cada publicacao ou rollback gera uma nova versao rastreavel.">
                    {questionVersions.length ? (
                      <div className="sq-list">
                        {questionVersions.map((item) => (
                          <div key={item.id} className="sq-list-item">
                            <div className="sq-list-title">
                              v{item.version_number} · {item.status}
                            </div>
                            <div className="sq-list-meta">
                              {item.published_at ? `Publicado em ${item.published_at}` : `Atualizado em ${item.updated_at || item.created_at}`}
                            </div>
                            {item.change_summary ? (
                              <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                                {item.change_summary}
                              </div>
                            ) : null}
                            <div className="sq-chip-row" style={{ marginTop: "var(--sq-space-2)" }}>
                              {item.is_current_published ? <span className="sq-chip">Publicado atual</span> : null}
                              {item.is_current_draft ? <span className="sq-chip">Rascunho atual</span> : null}
                              <span className="sq-chip">
                                {item.correct_count}/{item.option_count} corretas
                              </span>
                            </div>
                            {!item.is_current_published ? (
                              <div className="sq-actions" style={{ marginTop: "var(--sq-space-3)" }}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  busy={activeTask === "rollbackQuestion"}
                                  onClick={() => void handleRollbackQuestion(item.id)}
                                >
                                  Reverter para esta versao
                                </Button>
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sq-empty">Nenhuma versao registrada ainda. Salve o primeiro rascunho para iniciar o fluxo.</div>
                    )}
                  </Card>

                  <Card title="Auditoria" subtitle="Quem mudou, quando mudou e por qual motivo.">
                    {questionAudit.length ? (
                      <div className="sq-list">
                        {questionAudit.map((item) => (
                          <div key={item.id} className="sq-list-item">
                            <div className="sq-list-title">
                              {item.action} · {item.actor_role || "sistema"}
                            </div>
                            <div className="sq-list-meta">{item.created_at || "-"}</div>
                            {item.reason ? (
                              <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                                {item.reason}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sq-empty">Sem eventos auditados para esta questao ainda.</div>
                    )}
                  </Card>

                  <Card title="Historico de desempenho" subtitle="Snapshots preservam a leitura de dificuldade da versao publicada ao longo do tempo.">
                    {questionAnalyticsHistory.length ? (
                      <div className="sq-list">
                        {questionAnalyticsHistory.map((item) => (
                          <div key={item.id} className="sq-list-item">
                            <div className="sq-list-title">
                              {item.version_number ? `v${item.version_number}` : "Sem versao"} · score {item.difficulty_score}
                            </div>
                            <div className="sq-list-meta">
                              {item.captured_at || "-"} · erro {item.wrong_rate_percent}% · {item.attempts_total} tentativa(s)
                            </div>
                            <div className="sq-list-meta" style={{ marginTop: "var(--sq-space-1)" }}>
                              baixa confianca {item.low_confidence_rate_percent}% · pressao {item.review_pressure_count}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="sq-empty">Ainda nao ha snapshot historico para esta questao. Use “Registrar snapshot” no topo do painel.</div>
                    )}
                  </Card>
                </div>
              </div>

              <div className="sq-grid-2">
                <Card title="Checklist rapido" subtitle="Leitura instantanea antes de salvar.">
                  <div className="sq-metric-grid">
                    {questionStats.map((item) => (
                      <div key={item.label} className="sq-metric-card">
                        <span className="sq-muted">{item.label}</span>
                        <strong>{item.value}</strong>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Preview do payload" subtitle="Este e o JSON enviado para o backend sem transformacoes ocultas.">
                  <pre
                    style={{
                      margin: 0,
                      maxHeight: 320,
                      overflow: "auto",
                      padding: "var(--sq-space-4)",
                      borderRadius: "var(--sq-radius-md)",
                      border: "1px solid var(--sq-border)",
                      background: "rgba(255,255,255,0.78)",
                      fontSize: "0.84rem",
                      lineHeight: 1.55
                    }}
                  >
                    {questionPreview}
                  </pre>
                </Card>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
