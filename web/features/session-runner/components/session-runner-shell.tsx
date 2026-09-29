"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { HintsPanel } from "@/features/session-runner/components/hints-panel";
import { QuestionStage } from "@/features/session-runner/components/question-stage";
import { RunnerActionBar } from "@/features/session-runner/components/runner-action-bar";
import { RunnerHeader } from "@/features/session-runner/components/runner-header";
import { RunnerPanel, runnerPanelTitle } from "@/features/session-runner/components/runner-panel";
import { useFocusMode } from "@/features/session-runner/hooks/use-focus-mode";
import { useRunnerSession } from "@/features/session-runner/hooks/use-runner-session";
import { useStudyNotes, type StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import { isTypingTarget, resolveResultHref, type RunnerMode } from "@/features/session-runner/lib/runner-utils";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

interface SessionRunnerShellProps {
  sessionId: string;
  mode: RunnerMode;
}

/** Keys that must keep their native meaning on these targets (buttons, links, options, selects...). */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return !!target.closest("button, a, summary, select, [role='radio'], [role='checkbox'], [role='tab'], dialog, #runner-panel");
}

export function SessionRunnerShell({ sessionId, mode }: SessionRunnerShellProps) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  const focus = useFocusMode();
  const isWide = useMediaQuery("(min-width: 80rem)");
  const [panelOpen, setPanelOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const panelDocked = isWide && !focus.enabled;

  // Notes must be saved before a study session advances; the controller calls back into them.
  const notesRef = useRef<StudyNotesState | null>(null);
  const beforeAdvance = useCallback(async () => {
    const notes = notesRef.current;
    return notes && notes.dirty ? notes.save() : true;
  }, []);

  const runner = useRunnerSession({ sessionId, mode, t, beforeAdvance });
  const notes = useStudyNotes(!runner.isExamMode ? runner.currentQuestion?.id ?? null : null, t);
  useEffect(() => {
    notesRef.current = notes;
  });

  const { isExamMode, sessionQuery, questionKey, currentPosition, totalQuestions, feedback } = runner;

  // Focus management: the question heading on every new question, the "Next" action after grading.
  useEffect(() => {
    if (questionKey) {
      headingRef.current?.focus();
    }
  }, [questionKey]);
  const hasFeedback = !!feedback;
  useEffect(() => {
    if (hasFeedback) {
      nextRef.current?.focus();
    }
  }, [hasFeedback, questionKey]);

  const strategyLabel = useMemo(() => {
    const raw = String(sessionQuery.data?.selection_strategy || "standard").toLowerCase();
    if (raw === "adaptive") {
      return t("common.strategies.adaptive");
    }
    if (raw === "review") {
      return t("common.labels.review");
    }
    return t("common.strategies.standard");
  }, [sessionQuery.data?.selection_strategy, t]);

  async function requestSubmitExam() {
    const screen = runner.reviewScreenQuery.data;
    const answered = screen?.answered_count ?? runner.examSession?.answered_count ?? 0;
    const total = screen?.total_questions ?? totalQuestions;
    const confirmed = await confirm({
      title: t("runner.submitConfirm.title"),
      message: t("runner.submitConfirm.message", {
        answered,
        total,
        unanswered: screen?.unanswered_count ?? Math.max(total - answered, 0),
        marked: screen?.marked_for_review_count ?? runner.examSession?.marked_for_review_count ?? 0
      }),
      confirmLabel: t("runner.submitConfirm.confirm"),
      cancelLabel: t("runner.submitConfirm.cancel"),
      tone: "danger"
    });
    if (confirmed) {
      await runner.submitExam();
    }
  }

  // Global shortcuts. Never while typing, never with Alt/Ctrl/Meta, never over native controls.
  const shortcutState = useRef({ runner, focus, panelOpen });
  useEffect(() => {
    shortcutState.current = { runner, focus, panelOpen };
  });
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target) || document.querySelector("dialog[open]")) {
        return;
      }
      const { runner: current, focus: focusMode } = shortcutState.current;
      // Ctrl/⌘+Enter confirms from anywhere (needed for multi-select, where Enter toggles the option).
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey) {
        if (current.canSubmit) {
          event.preventDefault();
          void current.submitAnswer();
        }
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const key = event.key;
      if (key === "f" || key === "F") {
        event.preventDefault();
        focusMode.toggle();
        return;
      }
      if (key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if ((key === "m" || key === "M") && current.isExamMode && current.currentQuestion && !current.isPaused) {
        event.preventDefault();
        void current.toggleMarkForReview();
        return;
      }
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (key === "Enter" && current.canSubmit) {
        event.preventDefault();
        void current.submitAnswer();
        return;
      }
      if ((key === "Enter" || key === " ") && current.feedback && !current.isPaused && current.pending === null) {
        event.preventDefault();
        if (current.feedback.finished) {
          current.goToResult();
        } else {
          void current.goNext();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  if (sessionQuery.isPending || (runner.isQuestionLoading && !runner.currentQuestion && !runner.questionQuery.isError)) {
    return (
      <main className="min-h-dvh" aria-busy="true">
        <div className="h-14 border-b border-line" />
        <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-12 sm:px-6" role="status">
          <span className="sr-only">{t("system.loading")}</span>
          <Skeleton height={16} className="max-w-40" />
          <Skeleton height={96} />
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} height={56} />
            ))}
          </div>
        </div>
      </main>
    );
  }

  if (sessionQuery.isError) {
    return (
      <main className="mx-auto flex min-h-[70dvh] max-w-xl flex-col justify-center gap-4 px-4 py-16 sm:px-6">
        <QueryErrorBanner
          title={t("runner.errors.openSessionTitle")}
          error={sessionQuery.error}
          onRetry={() => void sessionQuery.refetch()}
          retrying={sessionQuery.isFetching}
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className={buttonClassName("secondary")}>
            {t("common.actions.backToDashboard")}
          </Link>
          <Link href={resolveResultHref(mode, sessionId)} className={buttonClassName("ghost")}>
            {t("common.actions.openResult")}
          </Link>
        </div>
      </main>
    );
  }

  const panelTitle = runnerPanelTitle(runner, t);
  const questionId = runner.currentQuestion?.id ?? null;

  return (
    <div className="flex min-h-dvh flex-col" data-focus-mode={focus.enabled || undefined}>
      <RunnerHeader
        runner={runner}
        strategyLabel={strategyLabel}
        focusMode={focus.enabled}
        onToggleFocus={focus.toggle}
        panelDocked={panelDocked}
        panelOpen={panelOpen}
        panelTitle={panelTitle}
        panelToggleRef={panelToggleRef}
        onTogglePanel={() => setPanelOpen((open) => !open)}
        onRequestSubmitExam={() => void requestSubmitExam()}
        shortcutsOpen={shortcutsOpen}
        onShortcutsOpenChange={setShortcutsOpen}
        t={t}
      />

      {/* Screen-reader announcements: question changes and answer outcomes. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {runner.currentQuestion
          ? `${t("runner.announce.question", { current: currentPosition + 1, total: totalQuestions || "-" })}. ${runner.announcement}`
          : ""}
      </div>

      <div className="flex flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <div className={cn("mx-auto w-full max-w-reading flex-1 px-4 pt-8 pb-16 sm:px-6", focus.enabled ? "lg:pt-16" : "lg:pt-12")}>
            <QuestionStage
              ref={headingRef}
              runner={runner}
              focusMode={focus.enabled}
              t={t}
              hints={
                !isExamMode && questionId ? (
                  <HintsPanel key={`hints-${questionKey}`} sessionId={sessionId} questionId={questionId} locked={!!feedback} t={t} />
                ) : null
              }
            />
          </div>
          <RunnerActionBar ref={nextRef} runner={runner} isNotesSaving={notes.saving} t={t} />
        </main>

        <RunnerPanel
          sessionId={sessionId}
          runner={runner}
          notes={notes}
          docked={panelDocked}
          open={panelOpen}
          onClose={closePanel}
          returnFocusRef={panelToggleRef}
          t={t}
        />
      </div>
      {dialog}
    </div>
  );
}
