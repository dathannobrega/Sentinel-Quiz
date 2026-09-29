"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { resolveResultHref, type AnswerFeedback, type RunnerMode, type Translate } from "@/features/session-runner/lib/runner-utils";
import { ApiError, apiClient, readErrorMessage } from "@/lib/api/client";
import { clearSessionId } from "@/lib/auth/storage";
import {
  runnerKeys,
  useExamQuestionQuery,
  useExamReviewScreenQuery,
  useExamSessionQuery,
  useStudyQuestionQuery,
  useStudySessionQuery
} from "@/lib/query/runner-hooks";
import type {
  ExamAnswerFeedback,
  ExamQuestionState,
  MarkForReviewResponse,
  SessionResponse,
  StudyAnswerFeedback,
  StudySessionResponse
} from "@/types/api";

export type ConfidenceLevel = "guess" | "not_sure" | "confident";
export type RunnerNotice = { tone: "neutral" | "warning" | "danger"; text: string };

interface Options {
  sessionId: string;
  mode: RunnerMode;
  t: Translate;
  /** Called before leaving a study question; resolve false to stay (e.g. notes failed to save). */
  beforeAdvance?: () => Promise<boolean>;
}

/**
 * Server state for the runner lives in react-query (session, current question, review screen).
 * Local state only holds UI concerns: selection, feedback, pending flags and notices.
 */
export function useRunnerSession({ sessionId, mode, t, beforeAdvance }: Options) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isExamMode = mode === "exam";
  const sessionKey = runnerKeys.session(mode, sessionId);

  const examSessionQuery = useExamSessionQuery(sessionId, isExamMode);
  const studySessionQuery = useStudySessionQuery(sessionId, !isExamMode);
  const sessionQuery = isExamMode ? examSessionQuery : studySessionQuery;
  const examSession: SessionResponse | null = isExamMode ? examSessionQuery.data ?? null : null;
  const studySession: StudySessionResponse | null = !isExamMode ? studySessionQuery.data ?? null : null;

  // Exam: explicit position (null = follow the server cursor). Study: per-mount step token.
  const [examPosition, setExamPosition] = useState<number | null>(null);
  const [mountToken] = useState(() => Date.now().toString(36));
  const [studyStep, setStudyStep] = useState(0);
  const position = examPosition ?? examSession?.current_position ?? null;

  const examQuestionQuery = useExamQuestionQuery(sessionId, isExamMode && examSession ? position : null);
  const studyQuestionQuery = useStudyQuestionQuery(sessionId, `${mountToken}:${studyStep}`, !isExamMode);
  const questionQuery = isExamMode ? examQuestionQuery : studyQuestionQuery;
  const isExamDayMode = isExamMode && examSession?.experience_mode === "exam_day";
  const reviewScreenQuery = useExamReviewScreenQuery(sessionId, isExamMode && !!examSession);

  const examQuestionState: ExamQuestionState | null = isExamMode ? examQuestionQuery.data ?? null : null;
  const currentQuestion = isExamMode ? examQuestionState?.question ?? null : studyQuestionQuery.data?.question ?? null;
  const currentPosition = isExamMode
    ? examQuestionState?.current_position ?? position ?? 0
    : studyQuestionQuery.data?.progress_index ?? studySession?.current_index ?? 0;
  const totalQuestions = isExamMode
    ? examQuestionState?.total_questions ?? examSession?.total_questions ?? 0
    : studyQuestionQuery.data?.total_questions ?? studySession?.total_questions ?? 0;
  // Keyed by the data's own position so placeholder data (previous question while the next one
  // loads) keeps its selection/feedback instead of briefly looking unanswered.
  const questionKey = currentQuestion ? `${currentQuestion.id}@${currentPosition}` : "";
  const isQuestionLoading = questionQuery.isPending || questionQuery.isPlaceholderData;

  const [selection, setSelection] = useState<{ key: string; keys: string[] } | null>(null);
  const [feedbackState, setFeedbackState] = useState<{ key: string; feedback: AnswerFeedback } | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState<ConfidenceLevel>("not_sure");
  const [notice, setNotice] = useState<RunnerNotice | null>(null);
  const [pending, setPending] = useState<"submit" | "pause" | "mark" | "finalize" | "advance" | null>(null);
  const [announcementState, setAnnouncementState] = useState<{ key: string; text: string } | null>(null);

  const selectedKeys =
    selection && selection.key === questionKey
      ? selection.keys
      : examQuestionState?.question?.selected_keys ?? [];
  const feedback = feedbackState && feedbackState.key === questionKey ? feedbackState.feedback : null;
  const isPaused = isExamMode && !!examSession?.paused && !examSession?.finished;
  const announcement = announcementState && announcementState.key === questionKey ? announcementState.text : "";
  const announce = (key: string, text: string) => setAnnouncementState({ key, text });

  // Elapsed time per question, reset whenever the question (or pause state) changes.
  const startedAtRef = useRef<{ key: string; at: number }>({ key: "", at: Date.now() });
  useEffect(() => {
    startedAtRef.current = { key: questionKey, at: Date.now() };
  }, [questionKey, isPaused]);

  // ------------------------------------------------------------------ redirects
  const redirectedRef = useRef(false);
  const goToResult = useCallback(() => {
    if (redirectedRef.current) {
      return;
    }
    redirectedRef.current = true;
    clearSessionId(mode);
    startTransition(() => {
      router.replace(resolveResultHref(mode, sessionId));
    });
  }, [mode, router, sessionId]);

  const sessionFinished = Boolean(
    (isExamMode ? examSession?.finished : studySession?.finished) ||
      (isExamMode ? examQuestionState?.finished : studyQuestionQuery.data?.finished)
  );
  useEffect(() => {
    if (sessionFinished) {
      goToResult();
    }
  }, [goToResult, sessionFinished]);

  // Leaving an unfinished session asks for confirmation.
  const hasActiveSession = !!sessionQuery.data && !sessionFinished;
  useEffect(() => {
    if (!hasActiveSession) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveSession]);

  // ------------------------------------------------------------------ helpers
  const patchExamSession = useCallback(
    (patch: Partial<SessionResponse>) => {
      queryClient.setQueryData<SessionResponse>(runnerKeys.session("exam", sessionId), (current) =>
        current ? { ...current, ...patch } : current
      );
    },
    [queryClient, sessionId]
  );

  const patchCurrentExamQuestion = useCallback(
    (patch: Partial<NonNullable<ExamQuestionState["question"]>>, statePatch?: Partial<ExamQuestionState>) => {
      if (position === null) {
        return;
      }
      queryClient.setQueryData<ExamQuestionState>(runnerKeys.examQuestion(sessionId, position), (current) =>
        current?.question ? { ...current, ...statePatch, question: { ...current.question, ...patch } } : current
      );
    },
    [position, queryClient, sessionId]
  );

  const refreshReviewScreen = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: runnerKeys.reviewScreen(sessionId) });
  }, [queryClient, sessionId]);

  const refreshSession = useCallback(async () => {
    try {
      const fresh = await queryClient.fetchQuery<SessionResponse | StudySessionResponse>({
        queryKey: sessionKey,
        queryFn: () =>
          apiClient.get<SessionResponse | StudySessionResponse>(
            isExamMode ? `/sessions/${encodeURIComponent(sessionId)}` : `/study/sessions/${encodeURIComponent(sessionId)}`
          ),
        staleTime: 0
      });
      return fresh;
    } catch (error) {
      setNotice({ tone: "warning", text: readErrorMessage(error, t("runner.errors.loadSession")) });
      return null;
    }
  }, [isExamMode, queryClient, sessionId, sessionKey, t]);

  // ------------------------------------------------------------------ actions
  function toggleSelection(optionKey: string) {
    if (!currentQuestion || feedback || isPaused || isQuestionLoading) {
      return;
    }
    let next: string[];
    if (currentQuestion.multi_select) {
      next = selectedKeys.includes(optionKey)
        ? selectedKeys.filter((item) => item !== optionKey)
        : [...selectedKeys, optionKey].sort();
    } else {
      next = selectedKeys.includes(optionKey) ? [] : [optionKey];
    }
    setSelection({ key: questionKey, keys: next });
  }

  const canSubmit =
    selectedKeys.length > 0 && !feedback && pending === null && !!currentQuestion && !isPaused && !isQuestionLoading;

  async function submitAnswer() {
    if (!currentQuestion || !canSubmit) {
      return;
    }
    const key = questionKey;
    setPending("submit");
    setNotice(null);
    const startedAt = startedAtRef.current.key === key ? startedAtRef.current.at : Date.now();
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    try {
      if (isExamMode) {
        const response = await apiClient.put<ExamAnswerFeedback>(
          `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(currentQuestion.id)}/response`,
          { question_id: currentQuestion.id, selected_keys: selectedKeys, elapsed_seconds: elapsedSeconds }
        );
        setFeedbackState({ key, feedback: response });
        patchExamSession({
          correct_count: response.correct_count,
          wrong_count: response.wrong_count,
          answered_count: response.answered_count,
          marked_for_review_count: response.marked_for_review_count,
          current_index: response.progress_index,
          current_position: response.current_position ?? response.progress_index
        });
        patchCurrentExamQuestion({ selected_keys: selectedKeys, is_answered: true });
        refreshReviewScreen();
        announce(
          key,
          isExamDayMode
            ? t("runner.announce.answerRecorded")
            : response.is_correct
              ? t("runner.announce.answerCorrect")
              : t("runner.announce.answerWrong")
        );
      } else {
        const response = await apiClient.post<StudyAnswerFeedback>(
          `/study/sessions/${encodeURIComponent(sessionId)}/answer`,
          {
            question_id: currentQuestion.id,
            selected_keys: selectedKeys,
            confidence_level: confidenceLevel,
            elapsed_seconds: elapsedSeconds
          }
        );
        setFeedbackState({ key, feedback: response });
        queryClient.setQueryData<StudySessionResponse>(runnerKeys.session("study", sessionId), (current) =>
          current
            ? {
                ...current,
                current_index: response.progress_index,
                answered_count: response.answered_count,
                // Counts are only withheld in exam_day sessions; keep the cached value if absent.
                correct_count: response.correct_count ?? current.correct_count,
                wrong_count: response.wrong_count ?? current.wrong_count
              }
            : current
        );
        announce(key, response.is_correct ? t("runner.announce.answerCorrect") : t("runner.announce.answerWrong"));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Time limit / pause / auto-submit: resync; the redirect effect handles finished sessions.
        await refreshSession();
      }
      setNotice({ tone: "warning", text: readErrorMessage(error, t("runner.errors.actionFailed")) });
    } finally {
      setPending(null);
    }
  }

  /** Exam navigation: answers can be revised, so drop local feedback/selection for the new view. */
  function moveExamTo(targetPosition: number) {
    setNotice(null);
    setFeedbackState(null);
    setSelection(null);
    setExamPosition(targetPosition);
  }

  async function goNext() {
    setNotice(null);
    if (isExamMode) {
      moveExamTo(Math.min(currentPosition + 1, Math.max(totalQuestions - 1, 0)));
      return;
    }
    if (beforeAdvance) {
      setPending("advance");
      try {
        const ok = await beforeAdvance();
        if (!ok) {
          return;
        }
      } finally {
        setPending(null);
      }
    }
    setStudyStep((step) => step + 1);
  }

  function goPrevious() {
    if (!isExamMode) {
      return;
    }
    moveExamTo(Math.max(currentPosition - 1, 0));
  }

  function jumpTo(targetPosition: number) {
    if (!isExamMode) {
      return;
    }
    moveExamTo(targetPosition);
  }

  async function toggleMarkForReview() {
    if (!isExamMode || !currentQuestion) {
      return;
    }
    setPending("mark");
    setNotice(null);
    try {
      const response = await apiClient.post<MarkForReviewResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(currentQuestion.id)}/mark-review`
      );
      patchCurrentExamQuestion(
        { marked_for_review: response.marked_for_review },
        { marked_for_review_count: response.marked_for_review_count }
      );
      patchExamSession({ marked_for_review_count: response.marked_for_review_count });
      refreshReviewScreen();
    } catch (error) {
      setNotice({ tone: "warning", text: readErrorMessage(error, t("runner.errors.actionFailed")) });
    } finally {
      setPending(null);
    }
  }

  async function togglePause() {
    if (!isExamMode || !examSession || examSession.finished) {
      return;
    }
    setPending("pause");
    setNotice(null);
    try {
      const endpoint = examSession.paused ? "resume" : "pause";
      const response = await apiClient.post<SessionResponse>(`/sessions/${encodeURIComponent(sessionId)}/${endpoint}`);
      queryClient.setQueryData(runnerKeys.session("exam", sessionId), response);
      setNotice({ tone: "neutral", text: response.paused ? t("runner.notices.examPaused") : t("runner.notices.examResumed") });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshSession();
      }
      setNotice({ tone: "warning", text: readErrorMessage(error, t("runner.errors.actionFailed")) });
    } finally {
      setPending(null);
    }
  }

  async function submitExam() {
    if (!isExamMode) {
      return;
    }
    setPending("finalize");
    setNotice(null);
    try {
      await apiClient.post(`/sessions/${encodeURIComponent(sessionId)}/submit`, {});
      goToResult();
    } catch (error) {
      setNotice({ tone: "danger", text: readErrorMessage(error, t("runner.errors.actionFailed")) });
    } finally {
      setPending(null);
    }
  }

  /** Timer reached zero: resync with the server, which auto-submits expired exams. */
  const handleTimerExpired = useCallback(async () => {
    const fresh = (await refreshSession()) as SessionResponse | null;
    if (fresh && (fresh.finished || (fresh.remaining_seconds ?? 1) <= 0)) {
      goToResult();
    }
  }, [goToResult, refreshSession]);

  return {
    isExamMode,
    isExamDayMode,
    isPaused,
    sessionQuery,
    questionQuery,
    reviewScreenQuery,
    examSession,
    studySession,
    currentQuestion,
    examQuestionMarked: !!examQuestionState?.question?.marked_for_review,
    currentPosition,
    totalQuestions,
    questionKey,
    isQuestionLoading,
    selectedKeys,
    feedback,
    confidenceLevel,
    setConfidenceLevel,
    notice,
    pending,
    announcement,
    canSubmit,
    toggleSelection,
    submitAnswer,
    goNext,
    goPrevious,
    jumpTo,
    toggleMarkForReview,
    togglePause,
    submitExam,
    goToResult,
    handleTimerExpired
  };
}

export type RunnerController = ReturnType<typeof useRunnerSession>;
