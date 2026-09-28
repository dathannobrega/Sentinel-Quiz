"use client";

import { forwardRef, useId } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { StatusBanner } from "@/components/ui/status-banner";
import { ExamNavigator } from "@/features/session-runner/components/exam-navigator";
import { ExamTimer } from "@/features/session-runner/components/exam-timer";
import { QuestionOptions } from "@/features/session-runner/components/question-options";
import type { ConfidenceLevel, RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import { buildLiveFeedbackBits, type Translate } from "@/features/session-runner/lib/runner-utils";

interface QuestionCardProps {
  runner: RunnerController;
  strategyLabel: string;
  isNotesSaving: boolean;
  onRequestSubmitExam: () => void;
  t: Translate;
}

/** Main question area. The forwarded ref points at the question heading (focus target). */
export const QuestionCard = forwardRef<HTMLHeadingElement, QuestionCardProps>(function QuestionCard(
  { runner, strategyLabel, isNotesSaving, onRequestSubmitExam, t },
  headingRef
) {
  const headingId = useId();
  const helpId = useId();
  const {
    isExamMode,
    isExamDayMode,
    isPaused,
    examSession,
    studySession,
    currentQuestion,
    currentPosition,
    totalQuestions,
    feedback,
    pending
  } = runner;
  const isStudyMode = !isExamMode;
  const answeredCount = examSession?.answered_count ?? studySession?.answered_count ?? 0;
  const feedbackBits = feedback && !isExamDayMode ? buildLiveFeedbackBits(feedback, t) : [];

  let summaryChip: string;
  if (isStudyMode) {
    summaryChip = t("runner.questionCard.answered", { count: answeredCount });
  } else if (isExamDayMode) {
    summaryChip = t("runner.examDay.answeredOfTotal", { answered: answeredCount, total: totalQuestions });
  } else {
    summaryChip = t("runner.questionCard.examSummary", {
      correct: examSession?.correct_count ?? 0,
      wrong: examSession?.wrong_count ?? 0
    });
  }

  return (
    <Card
      subtitle={
        isExamDayMode
          ? t("runner.examDay.subtitle")
          : currentQuestion?.multi_select
            ? t("runner.questionCard.multiSelect")
            : t("runner.questionCard.singleSelect")
      }
      actions={
        <div className="sq-chip-row">
          <span className="sq-chip">{summaryChip}</span>
          {isExamMode && examSession ? (
            <ExamTimer
              expiresAt={examSession.expires_at}
              remainingSeconds={examSession.remaining_seconds}
              paused={isPaused}
              emphasized={isExamDayMode}
              onExpire={() => void runner.handleTimerExpired()}
              t={t}
            />
          ) : null}
          {!isExamDayMode ? <span className="sq-chip">{strategyLabel}</span> : null}
          {isExamDayMode ? <span className="sq-chip">{t("runner.examDay.tag")}</span> : null}
        </div>
      }
    >
      <div className="sq-surface-block">
        <h1 ref={headingRef} id={headingId} tabIndex={-1} className="sq-section-title sq-runner-question-heading">
          {t("runner.questionCard.title", { current: currentPosition + 1, total: totalQuestions || "-" })}
        </h1>

        {runner.notice ? (
          <StatusBanner
            tone={runner.notice.tone}
            role={runner.notice.tone === "neutral" ? "status" : "alert"}
            title={runner.notice.tone === "neutral" ? undefined : t("common.errors.attention")}
            message={runner.notice.text}
          />
        ) : null}
        {runner.questionQuery.isError ? (
          <QueryErrorBanner
            error={runner.questionQuery.error}
            onRetry={() => void runner.questionQuery.refetch()}
            retrying={runner.questionQuery.isFetching}
          />
        ) : null}
        {isExamDayMode ? (
          <StatusBanner tone="neutral" title={t("runner.examDay.activeTitle")} message={t("runner.examDay.activeMessage")} />
        ) : null}
        {isPaused ? (
          <StatusBanner tone="neutral" title={t("runner.errors.examPausedTitle")} message={t("runner.errors.examPausedMessage")} />
        ) : null}

        {currentQuestion ? (
          <>
            <div className="sq-chip-row">
              {!isExamDayMode && currentQuestion.certification ? <span className="sq-chip">{currentQuestion.certification}</span> : null}
              {!isExamDayMode && currentQuestion.domain ? <span className="sq-chip">{currentQuestion.domain}</span> : null}
              {!isExamDayMode && currentQuestion.difficulty ? <span className="sq-chip">{currentQuestion.difficulty}</span> : null}
              {runner.examQuestionMarked ? <span className="sq-chip">{t("runner.tags.markedForReview")}</span> : null}
            </div>

            <p className="sq-runner-question" id={`${headingId}-prompt`}>
              {currentQuestion.prompt}
            </p>

            <p id={helpId} className="sq-list-meta sq-runner-keyboard-help">
              {t("runner.keyboard.help")}
            </p>

            <QuestionOptions
              questionId={runner.questionKey}
              options={currentQuestion.options}
              multiSelect={currentQuestion.multi_select}
              selectedKeys={runner.selectedKeys}
              disabled={!!feedback || isPaused || pending === "submit" || runner.isQuestionLoading}
              feedback={isExamDayMode ? null : feedback}
              labelledBy={`${headingId} ${headingId}-prompt`}
              describedBy={helpId}
              onToggle={runner.toggleSelection}
              t={t}
            />

            {isStudyMode ? (
              <Field label={t("runner.labels.confidence")} htmlFor="confidence-level">
                <select
                  id="confidence-level"
                  className="sq-select"
                  value={runner.confidenceLevel}
                  onChange={(event) => runner.setConfidenceLevel(event.target.value as ConfidenceLevel)}
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
                  title={t("runner.examDay.answerRecordedTitle")}
                  message={t("runner.examDay.answerRecordedMessage")}
                />
              ) : (
                <StatusBanner
                  tone={feedback.is_correct ? "success" : "danger"}
                  title={`${feedback.is_correct ? "✓" : "✗"} ${feedback.is_correct ? t("runner.feedback.correct") : t("runner.feedback.wrong")}`}
                  message={
                    feedback.feedback_summary?.trim() || feedback.justification?.trim() || t("runner.feedback.missingJustification")
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

            {isExamDayMode ? (
              <ExamNavigator
                reviewScreen={runner.reviewScreenQuery.data ?? null}
                answeredCount={answeredCount}
                totalQuestions={totalQuestions}
                currentPosition={currentPosition}
                isLoading={runner.reviewScreenQuery.isPending}
                disabled={isPaused}
                onJump={runner.jumpTo}
                minimal
                t={t}
              />
            ) : null}

            <div className="sq-actions">
              {isExamMode ? (
                <Button variant="ghost" busy={pending === "mark"} disabled={isPaused} onClick={() => void runner.toggleMarkForReview()}>
                  {runner.examQuestionMarked ? t("runner.actions.unmarkReview") : t("runner.actions.markReview")}
                </Button>
              ) : null}
              {isExamMode ? (
                <Button
                  variant="ghost"
                  busy={runner.isQuestionLoading && runner.questionQuery.isFetching}
                  disabled={isPaused || currentPosition <= 0}
                  onClick={runner.goPrevious}
                >
                  {t("runner.actions.previous")}
                </Button>
              ) : null}
              <Button busy={pending === "submit"} disabled={!runner.canSubmit} onClick={() => void runner.submitAnswer()}>
                {t("runner.actions.confirmAnswer")}
              </Button>
              {feedback?.finished ? (
                <Button variant="ghost" disabled={isPaused} onClick={runner.goToResult}>
                  {t("common.actions.viewResult")}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  busy={pending === "advance" || (runner.isQuestionLoading && runner.questionQuery.isFetching)}
                  disabled={(isStudyMode && !feedback) || isNotesSaving || isPaused}
                  onClick={() => void runner.goNext()}
                >
                  {t("common.actions.nextQuestion")}
                </Button>
              )}
              {isExamMode ? (
                <Button variant="secondary" size="sm" busy={pending === "finalize"} disabled={isPaused} onClick={onRequestSubmitExam}>
                  {t("runner.actions.submitExam")}
                </Button>
              ) : null}
            </div>
          </>
        ) : runner.isQuestionLoading ? null : (
          <div className="sq-empty">{t("runner.labels.noActiveQuestion")}</div>
        )}
      </div>
    </Card>
  );
});
