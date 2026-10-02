"use client";

import { useEffect, useRef, type RefObject } from "react";

import { XIcon } from "@/components/ui/icons";
import { ExamNavigator } from "@/features/session-runner/components/exam-navigator";
import { IssueReportPanel } from "@/features/session-runner/components/issue-report-panel";
import { NotesPanel } from "@/features/session-runner/components/notes-panel";
import { TutorPanel } from "@/features/session-runner/components/tutor-panel";
import type { RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import type { StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

interface RunnerPanelProps {
  sessionId: string;
  runner: RunnerController;
  notes: StudyNotesState;
  /** Docked = a column next to the question (wide screens, focus mode off). */
  docked: boolean;
  open: boolean;
  onClose: () => void;
  /** Where focus returns when the overlay closes. */
  returnFocusRef: RefObject<HTMLElement | null>;
  t: Translate;
}

export function runnerPanelTitle(runner: RunnerController, t: Translate): string {
  return runner.isExamMode ? t("runner.layout.panelExam") : t("runner.layout.panelStudy");
}

/**
 * Secondary tools for the current question. Exam: the answer sheet (+ tutor gate, report).
 * Study: bookmark/notes (error notebook) and report. One DOM instance for both presentations.
 */
export function RunnerPanel({ sessionId, runner, notes, docked, open, onClose, returnFocusRef, t }: RunnerPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayOpen = !docked && open;
  const { isExamMode, isExamDayMode, currentQuestion, feedback, examSession } = runner;
  const questionId = currentQuestion?.id ?? null;
  const title = runnerPanelTitle(runner, t);

  useEffect(() => {
    if (!overlayOpen) {
      return;
    }
    closeRef.current?.focus();
    const returnTarget = returnFocusRef.current;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTarget?.focus();
    };
  }, [overlayOpen, onClose, returnFocusRef]);

  return (
    <>
      {overlayOpen ? <div aria-hidden="true" className="fixed inset-0 z-40 bg-overlay" onClick={onClose} /> : null}
      <aside
        id="runner-panel"
        aria-label={title}
        inert={!docked && !open}
        className={cn(
          "flex flex-col gap-7 overflow-y-auto overscroll-contain bg-canvas px-5 pt-6 pb-10",
          docked
            ? "sticky top-14 h-[calc(100dvh-3.5rem)] w-[22rem] shrink-0 border-l border-line"
            : "fixed inset-y-0 right-0 z-50 w-[min(24rem,100vw)] border-l border-line bg-surface-raised pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(2.5rem,env(safe-area-inset-bottom))] shadow-overlay transition-[transform,visibility] duration-200 ease-out",
          !docked && (open ? "visible translate-x-0" : "invisible translate-x-full")
        )}
      >
        {!docked ? (
          <div className="-mt-1 flex items-center justify-between">
            <p className="text-base font-semibold text-fg">{title}</p>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("runner.layout.panelClose")}
              className="focus-ring -mr-2 inline-grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <XIcon size={18} />
            </button>
          </div>
        ) : null}

        {isExamMode ? (
          <ExamNavigator
            reviewScreen={runner.reviewScreenQuery.data ?? null}
            answeredCount={examSession?.answered_count ?? 0}
            totalQuestions={runner.totalQuestions}
            currentPosition={runner.currentPosition}
            isLoading={runner.reviewScreenQuery.isPending}
            disabled={runner.isPaused}
            minimal={isExamDayMode}
            onJump={(position) => {
              runner.jumpTo(position);
              if (!docked) {
                onClose();
              }
            }}
            t={t}
          />
        ) : null}

        {!isExamMode && questionId ? <NotesPanel notes={notes} canReload={!!questionId} t={t} /> : null}

        {/* The AI tutor only supports multiple-choice items (the API answers 409 for PBQs). */}
        {isExamMode && !isExamDayMode && questionId && feedback && !runner.isPbq ? (
          <TutorPanel
            key={`tutor-${runner.questionKey}`}
            sessionId={sessionId}
            questionId={questionId}
            lockedDuringExam={!examSession?.finished}
            answered={!!feedback}
            t={t}
          />
        ) : null}

        {!isExamDayMode && questionId ? (
          <div className="border-t border-line">
            <IssueReportPanel key={`issue-${runner.questionKey}`} sessionId={sessionId} questionId={questionId} mode={isExamMode ? "exam" : "study"} t={t} />
          </div>
        ) : null}
      </aside>
    </>
  );
}
