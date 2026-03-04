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
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type {
  ExamReviewScreen,
  ExamAnswerFeedback,
  LiveInsight,
  QuestionHint,
  QuestionIssueRequest,
  SessionQuestionResponse,
  SessionResponse,
  StudyAnswerFeedback,
  StudyState,
  TutorReply
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

function readRunnerError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function buildLiveFeedbackBits(
  mode: RunnerMode,
  feedback: ExamAnswerFeedback | StudyAnswerFeedback,
  t: (key: string, values?: Record<string, string | number>) => string
): string[] {
  const bits: string[] = [];
  const insight = (feedback.insight || {}) as LiveInsight;
  const message = typeof insight.message === "string" ? insight.message.trim() : "";
  if (message) {
    bits.push(message);
  }
  const remaining = insight.remaining_questions;
  if (typeof remaining === "number") {
    bits.push(t("runner.liveFeedback.remaining", { count: remaining }));
  }
  const streak = insight.current_correct_streak;
  if (typeof streak === "number") {
    bits.push(t("runner.liveFeedback.currentStreak", { count: streak }));
  }
  if (mode === "study") {
    const studyFeedback = feedback as StudyAnswerFeedback;
    if (studyFeedback.uncertain_correct) {
      bits.push(t("runner.liveFeedback.uncertainCorrect"));
    }
    if (studyFeedback.next_review_at) {
      bits.push(t("runner.liveFeedback.nextReview", { date: formatDateTime(studyFeedback.next_review_at) }));
    }
    bits.push(t("runner.liveFeedback.dueQueue", { count: studyFeedback.review_due_count }));
  }
  return bits;
}

function formatRemainingTime(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "--:--";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildHintEndpoint(mode: RunnerMode, sessionId: string, questionId: string, level: number): string | null {
  if (mode !== "study") {
    return null;
  }
  return `/study/sessions/${sessionId}/questions/${questionId}/hint?level=${level}`;
}

function buildMaterialPreviewHref(materialPath: string, locator?: string | null, pageStart?: number | null, pageEnd?: number | null) {
  const params = new URLSearchParams({ material_path: materialPath });
  if (locator) {
    params.set("locator", locator);
  }
  if (typeof pageStart === "number") {
    params.set("page_start", String(pageStart));
  }
  if (typeof pageEnd === "number") {
    params.set("page_end", String(pageEnd));
  }
  return `/api/materials/preview?${params.toString()}`;
}

function formatPedagogicalReference(reference: {
  label: string;
  reference?: string | null;
  locator?: string | null;
  page_start?: number | null;
  page_end?: number | null;
}): string {
  const parts: string[] = [reference.label];
  if (reference.reference) {
    parts.push(reference.reference);
  }
  if (typeof reference.page_start === "number" && typeof reference.page_end === "number") {
    parts.push(reference.page_start === reference.page_end ? `p. ${reference.page_start}` : `pp. ${reference.page_start}-${reference.page_end}`);
  } else if (typeof reference.page_start === "number") {
    parts.push(`p. ${reference.page_start}`);
  }
  if (reference.locator) {
    parts.push(reference.locator);
  }
  return parts.join(" · ");
}

function ExamNavigatorPanel({
  reviewScreen,
  sessionState,
  isLoading,
  onJump,
  minimal = false
}: {
  reviewScreen: ExamReviewScreen | null;
  sessionState: SessionResponse | null;
  isLoading: boolean;
  onJump: (position: number) => void;
  minimal?: boolean;
}) {
  const answeredCount = reviewScreen?.answered_count ?? sessionState?.answered_count ?? 0;
  const totalQuestions = reviewScreen?.total_questions ?? sessionState?.total_questions ?? 0;

  return (
    <div className="sq-runner-utility">
      <div className="sq-runner-utility__head">
        <div>
          <div className="sq-list-title">{minimal ? "Navegação" : "Navegador da prova"}</div>
          <div className="sq-list-meta">
            {minimal ? "Fluxo enxuto, sem recursos pedagógicos." : "Vá e volte livremente antes de enviar."}
          </div>
        </div>
        <span className="sq-chip">{`${answeredCount}/${totalQuestions}`}</span>
      </div>

      {reviewScreen ? (
        <>
          <div className="sq-chip-row sq-gap-top-sm">
            <span className="sq-chip">Pendentes: {reviewScreen.unanswered_count}</span>
            <span className="sq-chip">Marcadas: {reviewScreen.marked_for_review_count}</span>
          </div>
          <div className="sq-chip-row sq-gap-top-sm">
            {reviewScreen.items.map((item) => (
              <button
                key={`${item.question_id}-${item.position}`}
                type="button"
                className="sq-chip"
                onClick={() => onJump(item.position)}
                style={{
                  borderColor: item.is_current
                    ? "rgba(15, 118, 110, 0.45)"
                    : item.marked_for_review
                      ? "rgba(245, 158, 11, 0.35)"
                      : undefined,
                  background: item.is_current
                    ? "rgba(15, 118, 110, 0.12)"
                    : item.answered
                      ? "rgba(34, 197, 94, 0.1)"
                      : undefined
                }}
              >
                {item.position + 1}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="sq-list-meta sq-gap-top-sm">
          {isLoading ? "Carregando status da prova..." : "Sem dados do navegador ainda."}
        </div>
      )}
    </div>
  );
}

export function SessionRunnerShell({ sessionId, mode }: SessionRunnerShellProps) {
  const { t } = useI18n();
  const router = useRouter();
  const sessionBasePath = resolveSessionBasePath(mode);

  const [isBootLoading, setIsBootLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

  const [sessionState, setSessionState] = useState<SessionResponse | null>(null);
  const [questionState, setQuestionState] = useState<SessionQuestionResponse | null>(null);
  const [feedback, setFeedback] = useState<ExamAnswerFeedback | StudyAnswerFeedback | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [confidenceLevel, setConfidenceLevel] = useState<"guess" | "not_sure" | "confident">("not_sure");
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null);
  const [studyState, setStudyState] = useState<StudyState | null>(null);
  const [studyDraft, setStudyDraft] = useState({ bookmarked: false, noteText: "" });
  const [isStudyStateLoading, setIsStudyStateLoading] = useState(false);
  const [isStudyStateSaving, setIsStudyStateSaving] = useState(false);
  const [studyStateDirty, setStudyStateDirty] = useState(false);
  const [studyStateNotice, setStudyStateNotice] = useState<string | null>(null);
  const [activeHint, setActiveHint] = useState<QuestionHint | null>(null);
  const [isHintLoading, setIsHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [reviewScreen, setReviewScreen] = useState<ExamReviewScreen | null>(null);
  const [isReviewScreenLoading, setIsReviewScreenLoading] = useState(false);
  const [isFinalizingExam, setIsFinalizingExam] = useState(false);
  const [isTutorLoading, setIsTutorLoading] = useState(false);
  const [tutorReply, setTutorReply] = useState<TutorReply | null>(null);
  const [tutorError, setTutorError] = useState<string | null>(null);
  const [isIssueSubmitting, setIsIssueSubmitting] = useState(false);
  const [issueCategory, setIssueCategory] = useState<QuestionIssueRequest["category"]>("clareza");
  const [issueMessage, setIssueMessage] = useState("");
  const [issueNotice, setIssueNotice] = useState<string | null>(null);

  const currentQuestion = questionState?.question || null;
  const currentPosition = questionState?.current_position ?? sessionState?.current_position ?? questionState?.progress_index ?? 0;
  const questionNumber = currentPosition + 1;
  const totalQuestions = questionState?.total_questions ?? sessionState?.total_questions ?? 0;
  const isStudyMode = mode === "study";
  const isExamMode = mode === "exam";
  const isExamPaused = isExamMode && !!sessionState?.paused && !sessionState?.finished;
  const isExamDayMode = isExamMode && sessionState?.experience_mode === "exam_day";

  const refreshSessionState = useEffectEvent(async (): Promise<SessionResponse | null> => {
    const response = await apiClient.get<SessionResponse>(`${sessionBasePath}/${sessionId}`);
    setSessionState(response);
    if (response.finished) {
      clearSessionId(mode);
      startTransition(() => {
        router.replace(resolveResultHref(mode, sessionId));
      });
      return null;
    }
    return response;
  });

  const refreshReviewScreen = useEffectEvent(async () => {
    if (!isExamMode) {
      return;
    }
    setIsReviewScreenLoading(true);
    try {
      const response = await apiClient.get<ExamReviewScreen>(`/sessions/${sessionId}/review-screen`);
      setReviewScreen(response);
    } catch {
      setReviewScreen(null);
    } finally {
      setIsReviewScreenLoading(false);
    }
  });

  const loadExamQuestionAt = useEffectEvent(async (position: number) => {
    const response = await apiClient.get<SessionQuestionResponse>(`/sessions/${sessionId}/questions/${position}`);
    if (response.finished) {
      clearSessionId(mode);
      startTransition(() => {
        router.replace(resolveResultHref(mode, sessionId));
      });
      return;
    }
    setQuestionState(response);
    setSessionState((current) =>
      current
        ? {
            ...current,
            current_position: response.current_position ?? current.current_position,
            current_index: response.progress_index ?? current.current_index,
            answered_count: response.answered_count ?? current.answered_count,
            marked_for_review_count: response.marked_for_review_count ?? current.marked_for_review_count,
            experience_mode: response.experience_mode ?? current.experience_mode
          }
        : current
    );
    setSelectedKeys(response.question?.selected_keys || []);
    setQuestionStartedAt(Date.now());
    setFeedback(null);
    setActiveHint(null);
    setHintError(null);
    setTutorReply(null);
    setTutorError(null);
  });

  const boot = useEffectEvent(async () => {
    setIsBootLoading(true);
    setLoadError(null);

    try {
      const sessionResponse = await apiClient.get<SessionResponse>(`${sessionBasePath}/${sessionId}`);

      setSessionState(sessionResponse);
      if (mode === "exam") {
        await loadExamQuestionAt(sessionResponse.current_position ?? sessionResponse.current_index ?? 0);
        await refreshReviewScreen();
      } else {
        const nextResponse = await apiClient.get<SessionQuestionResponse>(`${sessionBasePath}/${sessionId}/next`);
        if (nextResponse.finished) {
          clearSessionId(mode);
          startTransition(() => {
            router.replace(resolveResultHref(mode, sessionId));
          });
          return;
        }
        setQuestionState(nextResponse);
        setSelectedKeys(nextResponse.question?.selected_keys || []);
      }
      setQuestionStartedAt(Date.now());
      setFeedback(null);
      setActiveHint(null);
      setHintError(null);
    } catch (error) {
      setLoadError(readRunnerError(error, t("runner.errors.loadSession")));
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

      if (isExamMode) {
        await loadExamQuestionAt(Math.min(currentPosition + 1, Math.max(totalQuestions - 1, 0)));
        await refreshReviewScreen();
      } else {
        const nextResponse = await apiClient.get<SessionQuestionResponse>(`${sessionBasePath}/${sessionId}/next`);
        if (nextResponse.finished) {
          clearSessionId(mode);
          startTransition(() => {
            router.replace(resolveResultHref(mode, sessionId));
          });
          return;
        }

        setQuestionState(nextResponse);
        setSelectedKeys(nextResponse.question?.selected_keys || []);
      }
      setFeedback(null);
      setQuestionStartedAt(Date.now());
      setActiveHint(null);
      setHintError(null);
      setTutorReply(null);
      setTutorError(null);
    } catch (error) {
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsAdvancing(false);
    }
  });

  const goPrevious = useEffectEvent(async () => {
    if (!isExamMode) {
      return;
    }
    setIsAdvancing(true);
    setPageNotice(null);
    try {
      await loadExamQuestionAt(Math.max(currentPosition - 1, 0));
      await refreshReviewScreen();
    } catch (error) {
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsAdvancing(false);
    }
  });

  useEffect(() => {
    void boot();
  }, [sessionId, mode]);

  useEffect(() => {
    if (!isExamMode || !sessionState || sessionState.finished || sessionState.paused) {
      return;
    }
    if ((sessionState.remaining_seconds ?? 0) <= 0) {
      clearSessionId(mode);
      startTransition(() => {
        router.replace(resolveResultHref(mode, sessionId));
      });
      return;
    }

    const timeout = window.setTimeout(() => {
      setSessionState((current) => {
        if (!current || current.finished || current.paused || typeof current.remaining_seconds !== "number") {
          return current;
        }
        return {
          ...current,
          remaining_seconds: Math.max(current.remaining_seconds - 1, 0)
        };
      });
    }, 1000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [isExamMode, mode, router, sessionId, sessionState?.finished, sessionState?.paused, sessionState?.remaining_seconds]);

  const loadCurrentStudyState = useEffectEvent(async (questionId: string) => {
    setIsStudyStateLoading(true);
    setStudyStateNotice(t("runner.notices.loadingStudyState"));

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
          ? t("runner.notices.syncedAt", { date: formatDateTime(response.updated_at), scope: response.scope })
          : t("runner.notices.noSavedNotes", { scope: response.scope })
      );
    } catch (error) {
      if (currentQuestion?.id !== questionId) {
        return;
      }
      setStudyStateNotice(readRunnerError(error, t("runner.errors.loadSession")));
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
    setStudyStateNotice(t("runner.notices.savingStudyState"));

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
          ? t("runner.notices.savedAt", { date: formatDateTime(response.updated_at), scope: response.scope })
          : t("runner.notices.syncedStatus", { scope: response.scope })
      );
      return true;
    } catch (error) {
      setStudyStateNotice(t("runner.notices.saveFailed", { error: readRunnerError(error, t("runner.errors.loadSession")) }));
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
      setActiveHint(null);
      setHintError(null);
      return;
    }

    setActiveHint(null);
    setHintError(null);
    void loadCurrentStudyState(currentQuestion.id);
  }, [currentQuestion?.id, isStudyMode]);

  useEffect(() => {
    setIssueMessage("");
    setIssueNotice(null);
  }, [currentQuestion?.id]);

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

  const canSubmit = selectedKeys.length > 0 && !feedback && !isSubmitting && !!currentQuestion && !isExamPaused;
  const feedbackBits = feedback ? buildLiveFeedbackBits(mode, feedback, t) : [];

  const strategyLabel = useMemo(() => {
    const raw = String(sessionState?.selection_strategy || "standard").toLowerCase();
    if (raw === "adaptive") {
      return t("common.strategies.adaptive");
    }
    if (raw === "review") {
      return t("common.labels.review");
    }
    return t("common.strategies.standard");
  }, [sessionState?.selection_strategy, t]);

  function toggleSelection(optionKey: string) {
    if (!currentQuestion || feedback || isExamPaused) {
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

  async function handleLoadHint(level: 1 | 2 | 3) {
    if (!currentQuestion || feedback || isExamPaused) {
      return;
    }
    const endpoint = buildHintEndpoint(mode, sessionId, currentQuestion.id, level);
    if (!endpoint) {
      return;
    }

    setIsHintLoading(true);
    setHintError(null);
    try {
      const response = await apiClient.get<QuestionHint>(endpoint);
      if (currentQuestion.id !== response.question_id) {
        return;
      }
      setActiveHint(response);
    } catch (error) {
      setHintError(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsHintLoading(false);
    }
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
              selected_keys: selectedKeys,
              elapsed_seconds: elapsedSeconds
            };

      const response =
        mode === "study"
          ? await apiClient.post<ExamAnswerFeedback | StudyAnswerFeedback>(`${sessionBasePath}/${sessionId}/answer`, payload)
          : await apiClient.put<ExamAnswerFeedback>(`/sessions/${sessionId}/questions/${currentQuestion.id}/response`, payload);

      setFeedback(response);
      setSessionState((current) =>
        current
          ? {
              ...current,
              current_index: response.progress_index,
              current_position: response.current_position ?? response.progress_index,
              correct_count: response.correct_count,
              wrong_count: response.wrong_count,
              finished: response.finished,
              answered_count: response.answered_count,
              marked_for_review_count:
                "marked_for_review_count" in response ? response.marked_for_review_count : current.marked_for_review_count
            }
          : current
      );
      if (isExamMode) {
        await refreshReviewScreen();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const detail = error.message.toLowerCase();
        if (detail.includes("time limit") || detail.includes("auto-submitted")) {
          await refreshSessionState();
          return;
        }
        await refreshSessionState();
      }
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleMarkForReview() {
    if (!isExamMode || !currentQuestion) {
      return;
    }
    setPageNotice(null);
    try {
      const response = await apiClient.post<{
        question_id: string;
        marked_for_review: boolean;
        marked_for_review_count: number;
        current_position: number;
      }>(`/sessions/${sessionId}/questions/${currentQuestion.id}/mark-review`);
      setQuestionState((current) =>
        current?.question
          ? {
              ...current,
              current_position: response.current_position,
              marked_for_review_count: response.marked_for_review_count,
              question: {
                ...current.question,
                marked_for_review: response.marked_for_review
              }
            }
          : current
      );
      setSessionState((current) =>
        current
          ? {
              ...current,
              current_position: response.current_position,
              marked_for_review_count: response.marked_for_review_count
            }
          : current
      );
      await refreshReviewScreen();
    } catch (error) {
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    }
  }

  async function handleJumpToPosition(position: number) {
    if (!isExamMode) {
      return;
    }
    setPageNotice(null);
    try {
      const response = await apiClient.post<SessionQuestionResponse>(`/sessions/${sessionId}/navigation`, { position });
      if (response.finished) {
        clearSessionId(mode);
        startTransition(() => {
          router.replace(resolveResultHref(mode, sessionId));
        });
        return;
      }
      setQuestionState(response);
      setSessionState((current) =>
        current
          ? {
              ...current,
              current_position: response.current_position ?? current.current_position,
              current_index: response.progress_index ?? current.current_index,
              answered_count: response.answered_count ?? current.answered_count,
              marked_for_review_count: response.marked_for_review_count ?? current.marked_for_review_count,
              experience_mode: response.experience_mode ?? current.experience_mode
            }
          : current
      );
      setSelectedKeys(response.question?.selected_keys || []);
      setFeedback(null);
      setQuestionStartedAt(Date.now());
      setTutorReply(null);
      setTutorError(null);
      await refreshReviewScreen();
    } catch (error) {
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    }
  }

  async function handleSubmitExamNow() {
    if (!isExamMode) {
      return;
    }
    setIsFinalizingExam(true);
    setPageNotice(null);
    try {
      await apiClient.post(`/sessions/${sessionId}/submit`, {});
      clearSessionId(mode);
      startTransition(() => {
        router.replace(resolveResultHref(mode, sessionId));
      });
    } catch (error) {
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsFinalizingExam(false);
    }
  }

  async function handleAskTutor(modeValue: "help" | "why_wrong" | "review") {
    if (!isExamMode || !currentQuestion || !feedback || isExamDayMode) {
      return;
    }
    setIsTutorLoading(true);
    setTutorError(null);
    try {
      const response = await apiClient.post<TutorReply>(`/sessions/${sessionId}/questions/${currentQuestion.id}/tutor`, { mode: modeValue });
      setTutorReply(response);
    } catch (error) {
      setTutorReply(null);
      setTutorError(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsTutorLoading(false);
    }
  }

  async function handleReportIssue() {
    if (!currentQuestion || issueMessage.trim().length < 8) {
      return;
    }
    setIsIssueSubmitting(true);
    setIssueNotice(null);
    try {
      await apiClient.post(`/questions/${currentQuestion.id}/issues`, {
        session_id: sessionId,
        mode: isStudyMode ? "study" : "exam",
        category: issueCategory,
        message: issueMessage.trim()
      } satisfies QuestionIssueRequest);
      setIssueMessage("");
      setIssueNotice("Reporte enviado para o backlog editorial.");
    } catch (error) {
      setIssueNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsIssueSubmitting(false);
    }
  }

  async function handlePauseToggle() {
    if (!isExamMode || !sessionState || sessionState.finished) {
      return;
    }

    setIsTogglingPause(true);
    setPageNotice(null);

    try {
      const endpoint = sessionState.paused ? "resume" : "pause";
      const response = await apiClient.post<SessionResponse>(`${sessionBasePath}/${sessionId}/${endpoint}`);
      setSessionState(response);
      if (!response.paused) {
        setQuestionStartedAt(Date.now());
      }
      setPageNotice(
        response.paused
          ? t("runner.notices.examPaused")
          : t("runner.notices.examResumed")
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshSessionState();
      }
      setPageNotice(readRunnerError(error, t("runner.errors.loadSession")));
    } finally {
      setIsTogglingPause(false);
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
            title={t("runner.errors.openSessionTitle")}
            message={loadError}
            role="alert"
            action={
              <>
                <Link href="/dashboard">{t("common.actions.backToDashboard")}</Link>
                <Link href={resolveResultHref(mode, sessionId)}>{t("common.actions.openResult")}</Link>
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
              <div className="sq-page-title">{mode === "study" ? t("runner.header.studyTitle") : t("runner.header.examTitle")}</div>
              <p className="sq-page-subtitle">{t("runner.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            {isExamMode ? (
              <Button variant="ghost" size="sm" busy={isTogglingPause} onClick={() => void handlePauseToggle()}>
                {isExamPaused ? t("common.actions.resume") : t("common.actions.pause")}
              </Button>
            ) : null}
            {!isExamDayMode ? <Link href="/dashboard">{t("common.labels.dashboard")}</Link> : null}
            {!isExamDayMode ? <Link href="/history">{t("common.labels.history")}</Link> : null}
          </div>
        </header>

        <div className="sq-runner-layout" style={isExamDayMode ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
          <div className="sq-page-stack">
            <Card
              title={t("runner.questionCard.title", { current: questionNumber, total: totalQuestions || "-" })}
              subtitle={
                isExamDayMode
                  ? "Modo prova: sem correção instantânea e sem recursos pedagógicos."
                  : currentQuestion?.multi_select
                  ? t("runner.questionCard.multiSelect")
                  : t("runner.questionCard.singleSelect")
              }
              actions={
                <div className="sq-chip-row">
                  <span className="sq-chip">
                    {mode === "study"
                      ? t("runner.questionCard.answered", { count: sessionState?.answered_count ?? 0 })
                      : isExamDayMode
                        ? `${sessionState?.answered_count ?? 0}/${sessionState?.total_questions ?? 0} respondidas`
                      : t("runner.questionCard.examSummary", {
                          correct: sessionState?.correct_count ?? 0,
                          wrong: sessionState?.wrong_count ?? 0
                        })}
                  </span>
                  {isExamMode ? (
                    <span
                      className="sq-chip"
                      style={
                        isExamDayMode
                          ? {
                              fontWeight: 700,
                              background: "rgba(127, 29, 29, 0.08)",
                              borderColor: "rgba(127, 29, 29, 0.22)"
                            }
                          : undefined
                      }
                    >
                      {isExamPaused ? t("runner.questionCard.paused") : t("runner.questionCard.time")}{" "}
                      {formatRemainingTime(sessionState?.remaining_seconds)}
                    </span>
                  ) : null}
                  {!isExamDayMode ? <span className="sq-chip">{strategyLabel}</span> : null}
                  {isExamDayMode ? <span className="sq-chip">Exam day</span> : null}
                </div>
              }
            >
              <div className="sq-surface-block">
                {pageNotice ? <StatusBanner tone="warning" title={t("common.errors.attention")} message={pageNotice} /> : null}
                {isExamDayMode ? (
                  <StatusBanner
                    tone="neutral"
                    title="Modo prova ativo"
                    message="Correção instantânea, tutor, referências e saídas rápidas foram reduzidos para simular o dia da prova."
                  />
                ) : null}
                {isExamPaused ? (
                  <StatusBanner
                    tone="neutral"
                    title={t("runner.errors.examPausedTitle")}
                    message={t("runner.errors.examPausedMessage")}
                  />
                ) : null}

                {currentQuestion ? (
                  <>
                    {!isExamDayMode ? (
                      <div className="sq-chip-row">
                        {currentQuestion.certification ? <span className="sq-chip">{currentQuestion.certification}</span> : null}
                        {currentQuestion.domain ? <span className="sq-chip">{currentQuestion.domain}</span> : null}
                        {currentQuestion.difficulty ? <span className="sq-chip">{currentQuestion.difficulty}</span> : null}
                        {currentQuestion.marked_for_review ? <span className="sq-chip">Marcada para revisão</span> : null}
                      </div>
                    ) : currentQuestion.marked_for_review ? (
                      <div className="sq-chip-row">
                        <span className="sq-chip">Marcada para revisão</span>
                      </div>
                    ) : null}

                    <div className="sq-runner-question">{currentQuestion.prompt}</div>

                    <div
                      className="sq-list"
                      role={currentQuestion.multi_select ? "group" : "radiogroup"}
                      aria-label={t("runner.questionCard.optionsAriaLabel")}
                    >
                      {currentQuestion.options.map((option) => {
                        const isSelected = selectedKeys.includes(option.key);
                        const isConfirmedCorrect = !!feedback && feedback.is_correct && isSelected;
                        const isWrongSelection = !!feedback && !feedback.is_correct && isSelected;

                        return (
                          <button
                            key={option.key}
                            type="button"
                            role={currentQuestion.multi_select ? "checkbox" : "radio"}
                            aria-checked={isSelected}
                            onClick={() => toggleSelection(option.key)}
                            disabled={!!feedback || isExamPaused}
                            className={cn(
                              "sq-list-item sq-runner-option sq-choice-card",
                              isConfirmedCorrect && "sq-choice-card--correct",
                              isWrongSelection && "sq-choice-card--wrong",
                              !isConfirmedCorrect && !isWrongSelection && isSelected && "sq-choice-card--selected"
                            )}
                          >
                            <div className="sq-runner-option__body">
                              <span className="sq-chip">{option.key}</span>
                              <span>{option.text}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {isStudyMode ? (
                      <Field label={t("runner.labels.confidence")} htmlFor="confidence-level">
                        <select
                          id="confidence-level"
                          className="sq-select"
                          value={confidenceLevel}
                          onChange={(event) => setConfidenceLevel(event.target.value as "guess" | "not_sure" | "confident")}
                          disabled={!!feedback}
                        >
                          <option value="guess">{t("common.confidence.guess")}</option>
                          <option value="not_sure">{t("common.confidence.notSure")}</option>
                          <option value="confident">{t("common.confidence.confident")}</option>
                        </select>
                      </Field>
                    ) : null}

                    {feedback ? (
                      isExamDayMode ? (
                        <StatusBanner
                          tone="neutral"
                          title="Resposta registrada"
                          message="No modo prova, o gabarito e a análise detalhada só aparecem depois do envio final."
                        />
                      ) : (
                        <StatusBanner
                          tone={feedback.is_correct ? "success" : "danger"}
                          title={feedback.is_correct ? t("runner.feedback.correct") : t("runner.feedback.wrong")}
                          message={
                            feedback.feedback_summary?.trim() ||
                            feedback.justification?.trim() ||
                            t("runner.feedback.missingJustification")
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
                      )
                    ) : null}

                    {isExamDayMode && isExamMode ? (
                      <ExamNavigatorPanel
                        reviewScreen={reviewScreen}
                        sessionState={sessionState}
                        isLoading={isReviewScreenLoading}
                        onJump={(position) => void handleJumpToPosition(position)}
                        minimal
                      />
                    ) : null}

                    <div className="sq-actions">
                      {isExamMode ? (
                        <Button variant="ghost" disabled={isExamPaused || !currentQuestion} onClick={() => void handleToggleMarkForReview()}>
                          {currentQuestion.marked_for_review ? "Desmarcar revisão" : "Marcar revisão"}
                        </Button>
                      ) : null}
                      {isExamMode ? (
                        <Button variant="ghost" busy={isAdvancing} disabled={isExamPaused || currentPosition <= 0} onClick={() => void goPrevious()}>
                          Anterior
                        </Button>
                      ) : null}
                      <Button busy={isSubmitting} disabled={!canSubmit} onClick={() => void handleSubmit()}>
                        {t("runner.actions.confirmAnswer")}
                      </Button>
                      <Button
                        variant="ghost"
                        busy={isAdvancing}
                        disabled={(isStudyMode && !feedback) || isStudyStateSaving || isExamPaused}
                        onClick={() => void goNext()}
                      >
                        {feedback?.finished ? t("common.actions.viewResult") : t("common.actions.nextQuestion")}
                      </Button>
                      {isExamMode ? (
                        <Button variant="secondary" size="sm" busy={isFinalizingExam} disabled={isExamPaused} onClick={() => void handleSubmitExamNow()}>
                          Enviar prova
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="sq-empty">{t("runner.labels.noActiveQuestion")}</div>
                )}
              </div>
            </Card>
          </div>

          {!isExamDayMode ? (
          <aside className="sq-runner-sidebar" aria-label={t("runner.labels.questionToolsAria")}>
            <details className="sq-card sq-disclosure" open>
              <summary className="sq-disclosure__summary">{t("runner.labels.tools")}</summary>

              <div className="sq-stack-md">
                {isStudyMode ? (
                  <>
                    <div className="sq-runner-utility">
                      <div className="sq-runner-utility__head">
                        <div>
                          <div className="sq-list-title">{t("runner.labels.hints")}</div>
                          <div className="sq-list-meta">{t("runner.labels.hintsSubtitle")}</div>
                        </div>
                        <span className="sq-chip">
                          {activeHint ? t("runner.labels.level", { level: activeHint.level }) : t("common.status.closed")}
                        </span>
                      </div>

                      <div className="sq-actions sq-gap-top-sm">
                        <Button variant="ghost" size="sm" busy={isHintLoading} disabled={!!feedback} onClick={() => void handleLoadHint(1)}>
                          {t("runner.hints.hintButton", { level: 1 })}
                        </Button>
                        <Button variant="ghost" size="sm" busy={isHintLoading} disabled={!!feedback} onClick={() => void handleLoadHint(2)}>
                          {t("runner.hints.hintButton", { level: 2 })}
                        </Button>
                        <Button variant="ghost" size="sm" busy={isHintLoading} disabled={!!feedback} onClick={() => void handleLoadHint(3)}>
                          {t("runner.hints.hintButton", { level: 3 })}
                        </Button>
                      </div>

                      {hintError ? <div className="sq-list-meta sq-gap-top-sm">{hintError}</div> : null}

                      {activeHint ? (
                        <div className="sq-stack-sm sq-gap-top-sm">
                          <div className="sq-list-title">{activeHint.title}</div>
                          <div className="sq-list-meta">{activeHint.message}</div>
                          <div className="sq-list-meta">{activeHint.caution}</div>
                          {activeHint.references.length ? (
                            <div className="sq-list" role="list" aria-label={t("runner.labels.referencesHintAria")}>
                              {activeHint.references.map((reference, index) => (
                                <div key={`${reference.label}-${index}`} className="sq-list-item">
                                  <div className="sq-list-title">{formatPedagogicalReference(reference)}</div>
                                  {reference.material_path ? (
                                    <a
                                      href={buildMaterialPreviewHref(
                                        reference.material_path,
                                        reference.locator,
                                        reference.page_start,
                                        reference.page_end
                                      )}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="sq-text-link"
                                    >
                                      {t("runner.labels.openExcerpt")}
                                    </a>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="sq-runner-utility">
                      <div className="sq-runner-utility__head">
                        <div>
                          <div className="sq-list-title">{t("runner.labels.notes")}</div>
                          <div className="sq-list-meta">{t("runner.labels.notesSubtitle")}</div>
                        </div>
                        <span className="sq-chip">{studyState?.scope || "device"}</span>
                      </div>

                      <label htmlFor="study-bookmark" className="sq-checkbox-row sq-gap-top-sm">
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
                            setStudyStateNotice(t("runner.studyState.pendingChanges"));
                          }}
                        />
                        {t("runner.labels.reviewLater")}
                      </label>

                      <div className="sq-gap-top-sm">
                        <Field label={t("runner.labels.note")} htmlFor="study-note">
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
                              setStudyStateNotice(t("runner.studyState.pendingChanges"));
                            }}
                          />
                        </Field>
                      </div>

                      <div className="sq-actions sq-gap-top-sm">
                        <Button
                          variant="ghost"
                          size="sm"
                          busy={isStudyStateSaving}
                          disabled={!studyStateDirty || isStudyStateLoading}
                          onClick={() => void saveCurrentStudyState()}
                        >
                          {t("runner.labels.save")}
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
                          {t("runner.labels.reload")}
                        </Button>
                      </div>

                      {studyStateNotice ? <div className="sq-list-meta sq-gap-top-sm">{studyStateNotice}</div> : null}
                    </div>
                  </>
                ) : (
                  <>
                    <ExamNavigatorPanel
                      reviewScreen={reviewScreen}
                      sessionState={sessionState}
                      isLoading={isReviewScreenLoading}
                      onJump={(position) => void handleJumpToPosition(position)}
                    />

                    {!isExamDayMode && feedback ? (
                      <div className="sq-runner-utility">
                        <div className="sq-runner-utility__head">
                          <div>
                            <div className="sq-list-title">Tutor da questão</div>
                            <div className="sq-list-meta">Disponível após responder, sem sair da prova.</div>
                          </div>
                        </div>
                        <div className="sq-actions sq-gap-top-sm">
                          <Button variant="ghost" size="sm" busy={isTutorLoading} onClick={() => void handleAskTutor("help")}>
                            Me explique
                          </Button>
                          <Button variant="ghost" size="sm" busy={isTutorLoading} onClick={() => void handleAskTutor("why_wrong")}>
                            Por que errei?
                          </Button>
                          <Button variant="ghost" size="sm" busy={isTutorLoading} onClick={() => void handleAskTutor("review")}>
                            Revisar assunto
                          </Button>
                        </div>
                        {tutorError ? <div className="sq-list-meta sq-gap-top-sm">{tutorError}</div> : null}
                        {tutorReply ? <div className="sq-list-meta sq-gap-top-sm">{tutorReply.message}</div> : null}
                      </div>
                    ) : null}

                    <div className="sq-runner-utility">
                      <div className="sq-runner-utility__head">
                        <div>
                          <div className="sq-list-title">Reportar questão</div>
                          <div className="sq-list-meta">Isso alimenta o backlog editorial.</div>
                        </div>
                      </div>
                      <div className="sq-gap-top-sm">
                        <Field label="Categoria" htmlFor="exam-issue-category">
                          <select
                            id="exam-issue-category"
                            className="sq-select"
                            value={issueCategory}
                            onChange={(event) =>
                              setIssueCategory(event.target.value as QuestionIssueRequest["category"])
                            }
                          >
                            <option value="clareza">Clareza</option>
                            <option value="gabarito">Gabarito</option>
                            <option value="explicacao">Explicação</option>
                            <option value="referencia">Referência</option>
                          </select>
                        </Field>
                      </div>
                      <div className="sq-gap-top-sm">
                        <Field label="Detalhe" htmlFor="exam-issue-message">
                          <textarea
                            id="exam-issue-message"
                            className="sq-textarea"
                            rows={4}
                            value={issueMessage}
                            onChange={(event) => setIssueMessage(event.target.value)}
                          />
                        </Field>
                      </div>
                      <div className="sq-actions sq-gap-top-sm">
                        <Button variant="ghost" size="sm" busy={isIssueSubmitting} disabled={issueMessage.trim().length < 8} onClick={() => void handleReportIssue()}>
                          Enviar reporte
                        </Button>
                      </div>
                      {issueNotice ? <div className="sq-list-meta sq-gap-top-sm">{issueNotice}</div> : null}
                    </div>
                  </>
                )}

                {feedback?.official_references?.length && !isExamDayMode ? (
                  <div className="sq-runner-utility">
                    <div className="sq-list-title">{t("runner.labels.references")}</div>
                    <div className="sq-list sq-gap-top-sm" role="list" aria-label={t("runner.labels.referencesOfficialAria")}>
                      {feedback.official_references.map((reference, index) => (
                        <div key={`${reference.label}-${index}`} className="sq-list-item">
                          <div className="sq-list-title">{formatPedagogicalReference(reference)}</div>
                          {reference.material_path ? (
                            <a
                              href={buildMaterialPreviewHref(
                                reference.material_path,
                                reference.locator,
                                reference.page_start,
                                reference.page_end
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="sq-text-link"
                            >
                              {t("runner.labels.openExcerpt")}
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          </aside>
          ) : null}
        </div>
      </div>
    </main>
  );
}
