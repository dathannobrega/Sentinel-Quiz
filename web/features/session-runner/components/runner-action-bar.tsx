"use client";

import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon, FlagIcon } from "@/components/ui/icons";
import { selectClassName } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import type { ConfidenceLevel, RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

interface RunnerActionBarProps {
  runner: RunnerController;
  isNotesSaving: boolean;
  t: Translate;
}

/**
 * Bottom action bar of the reading column. Exactly one dominant action at a time:
 * "Confirm answer" before grading, "Next question" (or "View result") after.
 * The forwarded ref points at the "Next" button so focus can land there after grading.
 */
export const RunnerActionBar = forwardRef<HTMLButtonElement, RunnerActionBarProps>(function RunnerActionBar(
  { runner, isNotesSaving, t },
  nextRef
) {
  const { isExamMode, isPaused, feedback, pending, currentPosition, currentQuestion } = runner;
  const isStudyMode = !isExamMode;
  const answered = !!feedback;
  const nextBusy = pending === "advance" || (runner.isQuestionLoading && runner.questionQuery.isFetching);

  if (!currentQuestion) {
    return null;
  }

  return (
    <div className="sticky bottom-0 z-20 border-t border-line bg-canvas/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-reading flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        {isExamMode ? (
          <>
            <Button
              variant="ghost"
              size="md"
              busy={runner.isQuestionLoading && runner.questionQuery.isFetching && !nextBusy}
              disabled={isPaused || currentPosition <= 0}
              onClick={runner.goPrevious}
              className="px-3"
            >
              <ChevronLeftIcon />
              <span className="max-sm:sr-only">{t("runner.actions.previous")}</span>
            </Button>
            <Button
              variant="ghost"
              size="md"
              aria-pressed={runner.examQuestionMarked}
              busy={pending === "mark"}
              disabled={isPaused}
              onClick={() => void runner.toggleMarkForReview()}
              className={cn("px-3", runner.examQuestionMarked && "text-warning hover:text-warning")}
            >
              <FlagIcon />
              <span className="max-sm:sr-only">
                {runner.examQuestionMarked ? t("runner.actions.unmarkReview") : t("runner.actions.markReview")}
              </span>
            </Button>
          </>
        ) : (
          <label htmlFor="confidence-level" className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
            <span className="max-sm:sr-only">{t("runner.labels.confidence")}</span>
            <select
              id="confidence-level"
              className={cn(selectClassName, "h-9 w-auto min-w-36")}
              value={runner.confidenceLevel}
              onChange={(event) => runner.setConfidenceLevel(event.target.value as ConfidenceLevel)}
              disabled={answered}
            >
              <option value="guess">{t("common.confidence.guess")}</option>
              <option value="not_sure">{t("common.confidence.notSure")}</option>
              <option value="confident">{t("common.confidence.confident")}</option>
            </select>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!answered ? (
            <>
              {isExamMode ? (
                <Button variant="ghost" size="lg" busy={nextBusy} disabled={isPaused} onClick={() => void runner.goNext()} className="px-3 max-sm:hidden">
                  {t("common.actions.nextQuestion")}
                </Button>
              ) : null}
              <Button size="lg" busy={pending === "submit"} disabled={!runner.canSubmit} onClick={() => void runner.submitAnswer()}>
                {t("runner.actions.confirmAnswer")}
                <Kbd className="max-md:hidden">↵</Kbd>
              </Button>
            </>
          ) : feedback?.finished ? (
            <Button ref={nextRef} size="lg" disabled={isPaused} onClick={runner.goToResult}>
              {t("common.actions.viewResult")}
              <ChevronRightIcon />
            </Button>
          ) : (
            <Button
              ref={nextRef}
              size="lg"
              busy={nextBusy}
              disabled={(isStudyMode && !feedback) || isNotesSaving || isPaused}
              onClick={() => void runner.goNext()}
            >
              {t("common.actions.nextQuestion")}
              <ChevronRightIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
