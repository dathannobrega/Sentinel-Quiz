"use client";

import { startTransition, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { clearSessionId } from "@/lib/auth/storage";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { formatDateTime } from "@/lib/utils/format";
import type {
  ExamAnswerFeedback,
  SessionQuestionResponse,
  SessionResponse,
  StudyAnswerFeedback,
  StudyState
} from "@/types/api";

type RunnerMode = "exam" | "study";

interface SessionRunnerShellProps {
  sessionId: string;
  mode: RunnerMode;
}

function resolveSessionBasePath(mode: RunnerMode): string {
  return mode === "study" ? "/study/sessions" : "/sessions";
}

function resolveResultHref(mode: RunnerMode, sessionId: string): string {
  return mode === "study" ? `/study/${sessionId}/result` : `/exam/${sessionId}/result`;
}

function readRunnerError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Nao foi possivel carregar esta sessao.";
}

function buildLiveFeedbackBits(mode: RunnerMode, feedback: ExamAnswerFeedback | StudyAnswerFeedback): string[] {
  const bits: string[] = [];
  const insight = feedback.insight || {};
  const message = typeof insight.message === "string" ? insight.message.trim() : "";
  if (message) {
    bits.push(message);
  }
  const remaining = insight.remaining_questions;
  if (typeof remaining === "number") {
    bits.push(`Restantes: ${remaining}`);
  }
  const streak = insight.current_correct_streak;
  if (typeof streak === "number") {
    bits.push(`Streak atual: ${streak}`);
  }
  if (mode === "study") {
    const studyFeedback = feedback as StudyAnswerFeedback;
    if (studyFeedback.next_review_at) {
      bits.push(`Proxima revisao: ${formatDateTime(studyFeedback.next_review_at)}`);
    }
    bits.push(`Fila vencida: ${studyFeedback.review_due_count}`);
  }
  return bits;
}

export function SessionRunnerShell({ sessionId, mode }: SessionRunnerShellProps) {
  const router = useRouter();
  const sessionBasePath = resolveSessionBasePath(mode);

  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [sessionState, setSessionState] = useState<SessionResponse | null>(null);
  const [questionState, setQuestionState] = useState<SessionQuestionResponse | null>(null);
  const [feedback, setFeedback] = useState<ExamAnswerFeedback | StudyAnswerFeedback | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [confidenceLevel, setConfidenceLevel] = useState<"low" | "medium" | "high">("medium");
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null);
  const [studyState, setStudyState] = useState<StudyState | null>(null);
  const [studyDraft, setStudyDraft] = useState({ bookmarked: false, noteText: "" });
  const [isStudyStateLoading, setIsStudyStateLoading] = useState(false);
  const [isStudyStateSaving, setIsStudyStateSaving] = useState(false);
  const [studyStateDirty, setStudyStateDirty] = useState(false);
  const [studyStateNotice, setStudyStateNotice] = useState<string | null>(null);

  const currentQuestion = questionState?.question || null;
  const questionNumber = (questionState?.progress_index ?? 0) + 1;
  const totalQuestions = questionState?.total_questions ?? sessionState?.total_questions ?? 0;
  const isStudyMode = mode === "study";

  const boot = useEffectEvent(async () => {
    setIsBootLoading(true);
    setLoadError(null);

    try {
      const [sessionResponse, nextResponse] = await Promise.all([
        apiClient.get<SessionResponse>(`${sessionBasePath}/${sessionId}`),
        apiClient.get<SessionQuestionResponse>(`${sessionBasePath}/${sessionId}/next`)
      ]);

      setSessionState(sessionResponse);
      if (nextResponse.finished) {
        clearSessionId(mode);
        startTransition(() => {
          router.replace(resolveResultHref(mode, sessionId));
        });
        return;
      }
      setQuestionState(nextResponse);
      setQuestionStartedAt(Date.now());
      setSelectedKeys([]);
      setFeedback(null);
    } catch (error) {
      setLoadError(readRunnerError(error));
    } finally {
      setIsBootLoading(false);
    }
  });

  const goNext = useEffectEvent(async () => {
    setIsAdvancing(true);
    setPageNotice(null);

    try {
      if (isStudyMode && studyStateDirty) {
        const saved = await saveCurrentStudyState();
        if (!saved) {
          return;
        }
      }

      const nextResponse = await apiClient.get<SessionQuestionResponse>(`${sessionBasePath}/${sessionId}/next`);
      if (nextResponse.finished) {
        clearSessionId(mode);
        startTransition(() => {
          router.replace(resolveResultHref(mode, sessionId));
        });
        return;
      }

      setQuestionState(nextResponse);
      setSelectedKeys([]);
      setFeedback(null);
      setQuestionStartedAt(Date.now());
    } catch (error) {
      setPageNotice(readRunnerError(error));
    } finally {
      setIsAdvancing(false);
    }
  });

  useEffect(() => {
    void boot();
  }, [sessionId, mode]);

  const loadCurrentStudyState = useEffectEvent(async (questionId: string) => {
    setIsStudyStateLoading(true);
    setStudyStateNotice("Carregando status de estudo...");

    try {
      const response = await apiClient.get<StudyState>(`/study/questions/${questionId}/state`);
      if (currentQuestion?.id !== questionId) {
        return;
      }

      setStudyState(response);
      setStudyDraft({
        bookmarked: response.bookmarked,
        noteText: response.note_text || ""
      });
      setStudyStateDirty(false);
      setStudyStateNotice(
        response.updated_at
          ? `Sincronizado em ${formatDateTime(response.updated_at)} (${response.scope}).`
          : `Sem anotacoes salvas ainda (${response.scope}).`
      );
    } catch (error) {
      if (currentQuestion?.id !== questionId) {
        return;
      }
      setStudyStateNotice(readRunnerError(error));
    } finally {
      if (currentQuestion?.id === questionId) {
        setIsStudyStateLoading(false);
      }
    }
  });

  const saveCurrentStudyState = useEffectEvent(async (): Promise<boolean> => {
    if (!isStudyMode || !currentQuestion) {
      return true;
    }

    if (!studyStateDirty) {
      return true;
    }

    setIsStudyStateSaving(true);
    setStudyStateNotice("Salvando status de estudo...");

    try {
      const response = await apiClient.put<StudyState>(`/study/questions/${currentQuestion.id}/state`, {
        bookmarked: studyDraft.bookmarked,
        note_text: studyDraft.noteText.trim() ? studyDraft.noteText : null
      });

      if (currentQuestion?.id !== response.question_id) {
        return true;
      }

      setStudyState(response);
      setStudyDraft({
        bookmarked: response.bookmarked,
        noteText: response.note_text || ""
      });
      setStudyStateDirty(false);
      setStudyStateNotice(
        response.updated_at
          ? `Salvo em ${formatDateTime(response.updated_at)} (${response.scope}).`
          : `Status sincronizado (${response.scope}).`
      );
      return true;
    } catch (error) {
      setStudyStateNotice(`Nao foi possivel salvar: ${readRunnerError(error)}`);
      return false;
    } finally {
      setIsStudyStateSaving(false);
    }
  });

  useEffect(() => {
    if (!isStudyMode || !currentQuestion) {
      setStudyState(null);
      setStudyDraft({ bookmarked: false, noteText: "" });
      setStudyStateDirty(false);
      setStudyStateNotice(null);
      setIsStudyStateLoading(false);
      return;
    }

    void loadCurrentStudyState(currentQuestion.id);
  }, [currentQuestion?.id, isStudyMode]);

  useEffect(() => {
    if (!isStudyMode || !currentQuestion || !studyStateDirty || isStudyStateSaving) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveCurrentStudyState();
    }, 900);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isStudyMode, currentQuestion?.id, studyDraft.bookmarked, studyDraft.noteText, studyStateDirty, isStudyStateSaving]);

  useEffect(() => {
    if (!sessionState || sessionState.finished) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [sessionState]);

  const canSubmit = selectedKeys.length > 0 && !feedback && !isSubmitting && !!currentQuestion;
  const feedbackBits = feedback ? buildLiveFeedbackBits(mode, feedback) : [];

  const strategyLabel = useMemo(() => {
    const raw = String(sessionState?.selection_strategy || "standard").toLowerCase();
    if (raw === "adaptive") {
      return "Adaptativa";
    }
    if (raw === "review") {
      return "Revisao";
    }
    return "Padrao";
  }, [sessionState?.selection_strategy]);

  function toggleSelection(optionKey: string) {
    if (!currentQuestion || feedback) {
      return;
    }

    setSelectedKeys((current) => {
      if (currentQuestion.multi_select) {
        return current.includes(optionKey)
          ? current.filter((item) => item !== optionKey)
          : [...current, optionKey].sort();
      }
      if (current.includes(optionKey)) {
        return [];
      }
      return [optionKey];
    });
  }

  async function handleSubmit() {
    if (!currentQuestion || !canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setPageNotice(null);

    try {
      const elapsedSeconds = questionStartedAt ? Math.max(1, Math.round((Date.now() - questionStartedAt) / 1000)) : null;
      const payload =
        mode === "study"
          ? {
              question_id: currentQuestion.id,
              selected_keys: selectedKeys,
              confidence_level: confidenceLevel,
              elapsed_seconds: elapsedSeconds
            }
          : {
              question_id: currentQuestion.id,
              selected_keys: selectedKeys
            };

      const response = await apiClient.post<ExamAnswerFeedback | StudyAnswerFeedback>(
        `${sessionBasePath}/${sessionId}/answer`,
        payload
      );

      setFeedback(response);
      setSessionState((current) =>
        current
          ? {
              ...current,
              current_index: response.progress_index,
              correct_count: response.correct_count,
              wrong_count: response.wrong_count,
              finished: response.finished,
              answered_count:
                mode === "study" && "answered_count" in response ? response.answered_count : current.answered_count
            }
          : current
      );
    } catch (error) {
      setPageNotice(readRunnerError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isBootLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={140} />
          <Skeleton height={420} />
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <StatusBanner
            tone="danger"
            title="Nao foi possivel abrir a sessao"
            message={loadError}
            role="alert"
            action={
              <>
                <Link href="/">Voltar ao dashboard</Link>
                <Link href={resolveResultHref(mode, sessionId)}>Tentar abrir o resultado</Link>
              </>
            }
          />
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
              <div className="sq-page-title">{mode === "study" ? "Study Mode" : "Exam Mode"}</div>
              <p className="sq-page-subtitle">
                Sessao {sessionId} · estrategia {strategyLabel}. Esta etapa ja roda totalmente no novo frontend.
              </p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/">Dashboard</Link>
            <Link href="/history">Historico</Link>
            <Link href="/admin">Admin</Link>
          </div>
        </header>

        <Card
          title={`Questao ${questionNumber} de ${totalQuestions || "-"}`}
          subtitle={
            currentQuestion?.multi_select
              ? "Selecione todas as alternativas corretas."
              : "Selecione uma alternativa."
          }
          actions={
            <span className="sq-chip">
              {mode === "study"
                ? `${sessionState?.answered_count ?? 0} respondidas`
                : `${sessionState?.correct_count ?? 0} acertos · ${sessionState?.wrong_count ?? 0} erros`}
            </span>
          }
        >
          <div className="sq-surface-block">
            {pageNotice ? <StatusBanner tone="warning" title="Atencao" message={pageNotice} /> : null}

            {currentQuestion ? (
              <>
                <div className="sq-chip-row">
                  {currentQuestion.certification ? <span className="sq-chip">{currentQuestion.certification}</span> : null}
                  {currentQuestion.domain ? <span className="sq-chip">{currentQuestion.domain}</span> : null}
                  {currentQuestion.difficulty ? <span className="sq-chip">{currentQuestion.difficulty}</span> : null}
                </div>

                <div
                  style={{
                    fontSize: "1.08rem",
                    lineHeight: 1.7
                  }}
                >
                  {currentQuestion.prompt}
                </div>

                <div className="sq-list" role="list" aria-label="Alternativas">
                  {currentQuestion.options.map((option) => {
                    const isSelected = selectedKeys.includes(option.key);
                    const isCorrect = feedback ? feedback.correct_keys.includes(option.key) : false;
                    const isWrong = !!feedback && isSelected && !isCorrect;

                    return (
                      <button
                        key={option.key}
                        type="button"
                        role={currentQuestion.multi_select ? "checkbox" : "radio"}
                        aria-checked={isSelected}
                        onClick={() => toggleSelection(option.key)}
                        disabled={!!feedback}
                        className="sq-list-item"
                        style={{
                          textAlign: "left",
                          borderColor: isCorrect
                            ? "rgba(15,157,88,0.32)"
                            : isWrong
                              ? "rgba(209,67,67,0.28)"
                              : isSelected
                                ? "rgba(21,122,110,0.32)"
                                : "var(--sq-border)",
                          background: isCorrect
                            ? "rgba(15,157,88,0.08)"
                            : isWrong
                              ? "rgba(209,67,67,0.08)"
                              : isSelected
                                ? "rgba(21,122,110,0.08)"
                                : "rgba(255,255,255,0.74)"
                        }}
                      >
                        <div style={{ display: "flex", gap: "var(--sq-space-3)", alignItems: "flex-start" }}>
                          <span className="sq-chip">{option.key}</span>
                          <span>{option.text}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {isStudyMode ? (
                  <div className="sq-surface-block">
                    <Field
                      label="Confianca"
                      htmlFor="confidence-level"
                      hint="Esse nivel alimenta o algoritmo de repeticao e a proxima revisao."
                    >
                      <select
                        id="confidence-level"
                        className="sq-select"
                        value={confidenceLevel}
                        onChange={(event) => setConfidenceLevel(event.target.value as "low" | "medium" | "high")}
                        disabled={!!feedback}
                      >
                        <option value="low">Chutei / baixa confianca</option>
                        <option value="medium">Confianca media</option>
                        <option value="high">Tenho certeza</option>
                      </select>
                    </Field>

                    <div
                      className="sq-list-item"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "var(--sq-space-3)"
                      }}
                    >
                      <div className="sq-progress-head">
                        <div>
                          <div className="sq-list-title">Revisao pessoal</div>
                          <div className="sq-list-meta">
                            Bookmark e nota sincronizados por questao no mesmo fluxo do study mode.
                          </div>
                        </div>
                        <span className="sq-chip">{studyState?.scope || "device"}</span>
                      </div>

                      <label
                        htmlFor="study-bookmark"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--sq-space-2)",
                          fontWeight: 700
                        }}
                      >
                        <input
                          id="study-bookmark"
                          type="checkbox"
                          checked={studyDraft.bookmarked}
                          disabled={isStudyStateLoading}
                          onChange={(event) => {
                            setStudyDraft((current) => ({
                              ...current,
                              bookmarked: event.target.checked
                            }));
                            setStudyStateDirty(true);
                            setStudyStateNotice("Alteracoes pendentes...");
                          }}
                        />
                        Marcar para revisar depois
                      </label>

                      <Field
                        label="Nota"
                        htmlFor="study-note"
                        hint="Use este campo para registrar contexto, pegadinhas e por que voce errou."
                      >
                        <textarea
                          id="study-note"
                          className="sq-textarea"
                          rows={5}
                          value={studyDraft.noteText}
                          disabled={isStudyStateLoading}
                          onChange={(event) => {
                            setStudyDraft((current) => ({
                              ...current,
                              noteText: event.target.value
                            }));
                            setStudyStateDirty(true);
                            setStudyStateNotice("Alteracoes pendentes...");
                          }}
                        />
                      </Field>

                      <div className="sq-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={isStudyStateSaving}
                          disabled={!studyStateDirty || isStudyStateLoading}
                          onClick={() => void saveCurrentStudyState()}
                        >
                          Salvar anotacoes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={isStudyStateLoading || !currentQuestion}
                          onClick={() => {
                            if (currentQuestion) {
                              void loadCurrentStudyState(currentQuestion.id);
                            }
                          }}
                        >
                          Recarregar
                        </Button>
                      </div>

                      {studyStateNotice ? <div className="sq-list-meta">{studyStateNotice}</div> : null}
                    </div>
                  </div>
                ) : null}

                {feedback ? (
                  <StatusBanner
                    tone={feedback.is_correct ? "success" : "danger"}
                    title={feedback.is_correct ? "Resposta correta" : "Resposta incorreta"}
                    message={
                      feedback.justification?.trim() ||
                      "Sem justificativa cadastrada para esta questao. Revise o topico e siga para a proxima."
                    }
                    action={
                      feedbackBits.length ? (
                        <div className="sq-chip-row">
                          {feedbackBits.map((item) => (
                            <span key={item} className="sq-chip">
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : undefined
                    }
                  />
                ) : null}

                <div className="sq-actions">
                  <Button busy={isSubmitting} disabled={!canSubmit} onClick={() => void handleSubmit()}>
                    Confirmar resposta
                  </Button>
                  <Button
                    variant="ghost"
                    busy={isAdvancing}
                    disabled={!feedback || isStudyStateSaving}
                    onClick={() => void goNext()}
                  >
                    {feedback?.finished ? "Ver resultado" : "Proxima questao"}
                  </Button>
                </div>

                <div className="sq-empty">
                  Navegacao sequencial: a API atual avanca a sessao a cada resposta. A revisao completa fica disponivel
                  no resultado final.
                </div>
              </>
            ) : (
              <div className="sq-empty">Nenhuma questao ativa encontrada para esta sessao.</div>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
}
