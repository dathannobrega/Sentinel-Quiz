"use client";

import { forwardRef, useId, type ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { FlagIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { AnswerFeedbackView } from "@/features/session-runner/components/answer-feedback";
import { PbqQuestion } from "@/features/session-runner/components/pbq/pbq-question";
import { QuestionOptions } from "@/features/session-runner/components/question-options";
import type { RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

interface QuestionStageProps {
  runner: RunnerController;
  focusMode: boolean;
  /** Study-mode hints, rendered in the "think" step under the options. */
  hints?: ReactNode;
  t: Translate;
}

/**
 * The reading column: context → question number (h1, focus target) → prompt → options → hints →
 * verdict and resolution. Metadata is set small and quiet so it never competes with the prompt.
 */
export const QuestionStage = forwardRef<HTMLHeadingElement, QuestionStageProps>(function QuestionStage(
  { runner, focusMode, hints, t },
  headingRef
) {
  const headingId = useId();
  const helpId = useId();
  const { isExamDayMode, isPaused, currentQuestion, currentPosition, totalQuestions, feedback, pending, isPbq } = runner;
  const locked = !!feedback || isPaused || pending === "submit" || runner.isQuestionLoading;

  const context = currentQuestion && !isExamDayMode && !focusMode
    ? [currentQuestion.certification, currentQuestion.domain, currentQuestion.difficulty].filter(Boolean).join(" · ")
    : "";

  const instruction = isExamDayMode
    ? t("runner.examDay.subtitle")
    : isPbq
      ? t("pbq.subtitle")
      : currentQuestion?.multi_select
        ? t("runner.questionCard.multiSelect")
        : t("runner.questionCard.singleSelect");

  return (
    <article className={cn("flex flex-col gap-7", runner.isQuestionLoading && "opacity-60 transition-opacity")} aria-labelledby={headingId}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="nums rounded-sm text-sm font-medium text-fg-muted outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
          >
            {t("runner.questionCard.title", { current: currentPosition + 1, total: totalQuestions || "-" })}
          </h1>
          {runner.examQuestionMarked ? (
            <Badge tone="warning">
              <FlagIcon />
              {t("runner.tags.markedForReview")}
            </Badge>
          ) : null}
        </div>
        {context ? <p className="text-[0.8125rem] text-fg-subtle">{context}</p> : null}
      </header>

      {runner.notice ? (
        <Alert
          tone={runner.notice.tone}
          role={runner.notice.tone === "neutral" ? "status" : "alert"}
          title={runner.notice.tone === "neutral" ? undefined : t("common.errors.attention")}
          message={runner.notice.text}
        />
      ) : null}
      {runner.questionQuery.isError ? (
        <QueryErrorBanner error={runner.questionQuery.error} onRetry={() => void runner.questionQuery.refetch()} retrying={runner.questionQuery.isFetching} />
      ) : null}
      {isPaused ? <Alert tone="neutral" title={t("runner.errors.examPausedTitle")} message={t("runner.errors.examPausedMessage")} /> : null}

      {currentQuestion ? (
        <>
          {isPbq && currentQuestion.pbq ? (
            <PbqQuestion
              key={runner.questionKey}
              payload={currentQuestion.pbq}
              response={runner.pbqResponse}
              onChange={runner.updatePbqResponse}
              disabled={locked}
              // exam_day: never show grading before the end, even if a backend sent it.
              result={isExamDayMode ? null : feedback}
              t={t}
            />
          ) : (
            <div className="flex flex-col gap-6">
              <p id={`${headingId}-prompt`} className="font-serif text-[1.1875rem] leading-[1.65] whitespace-pre-line text-fg sm:text-[1.25rem]">
                {currentQuestion.prompt}
              </p>

              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="text-[0.8125rem] font-medium text-fg-muted">{instruction}</p>
                  {!locked ? (
                    <p aria-hidden="true" className="hidden items-center gap-1.5 text-xs text-fg-muted md:flex">
                      <Kbd>A</Kbd>–<Kbd>{String.fromCharCode(64 + Math.min(currentQuestion.options.length, 8))}</Kbd>
                      <span className="mr-2">{t("runner.layout.legendSelect")}</span>
                      <Kbd>X</Kbd>
                      <span className="mr-2">{t("runner.layout.legendEliminate")}</span>
                      {currentQuestion.multi_select ? <Kbd>Ctrl</Kbd> : null}
                      <Kbd>Enter</Kbd>
                      <span>{t("runner.layout.legendConfirm")}</span>
                    </p>
                  ) : null}
                </div>
                <p id={helpId} className="sr-only">
                  {t("runner.keyboard.help")} {t("runner.elimination.hint")}
                </p>

                <QuestionOptions
                  questionId={runner.questionKey}
                  options={currentQuestion.options}
                  multiSelect={currentQuestion.multi_select}
                  selectedKeys={runner.selectedKeys}
                  disabled={locked}
                  feedback={isExamDayMode ? null : feedback}
                  labelledBy={`${headingId} ${headingId}-prompt`}
                  describedBy={helpId}
                  onToggle={runner.toggleSelection}
                  onConfirm={() => void runner.submitAnswer()}
                  t={t}
                />
              </div>
            </div>
          )}

          {hints}

          {feedback ? <AnswerFeedbackView feedback={feedback} isPbq={isPbq} isExamDayMode={isExamDayMode} t={t} /> : null}
          {!feedback && isExamDayMode && !isPaused ? (
            <p className="text-xs text-fg-subtle">
              {t("runner.examDay.activeTitle")} · {t("runner.examDay.activeMessage")}
            </p>
          ) : null}
        </>
      ) : runner.isQuestionLoading ? null : (
        <p className="text-fg-muted">{t("runner.labels.noActiveQuestion")}</p>
      )}
    </article>
  );
});
