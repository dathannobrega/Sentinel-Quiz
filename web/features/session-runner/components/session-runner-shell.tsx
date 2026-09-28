"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { QuestionCard } from "@/features/session-runner/components/question-card";
import { RunnerSidebar } from "@/features/session-runner/components/runner-sidebar";
import { useRunnerSession } from "@/features/session-runner/hooks/use-runner-session";
import { useStudyNotes, type StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import { resolveResultHref, type RunnerMode } from "@/features/session-runner/lib/runner-utils";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

interface SessionRunnerShellProps {
  sessionId: string;
  mode: RunnerMode;
}

export function SessionRunnerShell({ sessionId, mode }: SessionRunnerShellProps) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirm();
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  const { isExamMode, isExamDayMode, sessionQuery, questionKey, currentPosition, totalQuestions } = runner;

  // Focus management: move focus to the question heading whenever the question changes.
  useEffect(() => {
    if (questionKey) {
      headingRef.current?.focus();
    }
  }, [questionKey]);

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

  if (sessionQuery.isPending || (runner.isQuestionLoading && !runner.currentQuestion && !runner.questionQuery.isError)) {
    return (
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack" role="status">
          <span className="sq-visually-hidden">{t("system.loading")}</span>
          <Skeleton height={140} />
          <Skeleton height={420} />
        </div>
      </main>
    );
  }

  if (sessionQuery.isError) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <QueryErrorBanner
            title={t("runner.errors.openSessionTitle")}
            error={sessionQuery.error}
            onRetry={() => void sessionQuery.refetch()}
            retrying={sessionQuery.isFetching}
          />
          <div className="sq-actions">
            <Link href="/dashboard" className="sq-button sq-button--md sq-button--ghost">
              {t("common.actions.backToDashboard")}
            </Link>
            <Link href={resolveResultHref(mode, sessionId)} className="sq-button sq-button--md sq-button--ghost">
              {t("common.actions.openResult")}
            </Link>
          </div>
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
              <div className="sq-page-title">{isExamMode ? t("runner.header.examTitle") : t("runner.header.studyTitle")}</div>
              <p className="sq-page-subtitle">{t("runner.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            {isExamMode ? (
              <Button variant="ghost" size="sm" busy={runner.pending === "pause"} onClick={() => void runner.togglePause()}>
                {runner.isPaused ? t("common.actions.resume") : t("common.actions.pause")}
              </Button>
            ) : null}
            {!isExamDayMode ? <Link href="/dashboard">{t("common.labels.dashboard")}</Link> : null}
            {!isExamDayMode ? <Link href="/history">{t("common.labels.history")}</Link> : null}
          </div>
        </header>

        {/* Screen-reader announcements: question changes and answer outcomes. */}
        <div className="sq-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {runner.currentQuestion
            ? `${t("runner.announce.question", { current: currentPosition + 1, total: totalQuestions || "-" })}. ${runner.announcement}`
            : ""}
        </div>

        <div className={cn("sq-runner-layout", isExamDayMode && "sq-runner-layout--single")}>
          <div className="sq-page-stack">
            <QuestionCard
              ref={headingRef}
              runner={runner}
              strategyLabel={strategyLabel}
              isNotesSaving={notes.saving}
              onRequestSubmitExam={() => void requestSubmitExam()}
              t={t}
            />
          </div>

          {!isExamDayMode ? <RunnerSidebar sessionId={sessionId} runner={runner} notes={notes} t={t} /> : null}
        </div>
      </div>
      {dialog}
    </main>
  );
}
