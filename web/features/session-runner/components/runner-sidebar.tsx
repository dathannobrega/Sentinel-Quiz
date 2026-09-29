"use client";

import { ExamNavigator } from "@/features/session-runner/components/exam-navigator";
import { HintsPanel } from "@/features/session-runner/components/hints-panel";
import { IssueReportPanel } from "@/features/session-runner/components/issue-report-panel";
import { NotesPanel } from "@/features/session-runner/components/notes-panel";
import { ReferencesList } from "@/features/session-runner/components/references-list";
import { TutorPanel } from "@/features/session-runner/components/tutor-panel";
import type { RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import type { StudyNotesState } from "@/features/session-runner/hooks/use-study-notes";
import type { Translate } from "@/features/session-runner/lib/runner-utils";

interface RunnerSidebarProps {
  sessionId: string;
  runner: RunnerController;
  notes: StudyNotesState;
  t: Translate;
}

/** Support tools next to the question (hidden entirely in exam-day mode by the shell). */
export function RunnerSidebar({ sessionId, runner, notes, t }: RunnerSidebarProps) {
  const { isExamMode, currentQuestion, feedback, examSession } = runner;
  const questionId = currentQuestion?.id ?? null;

  return (
    <aside className="sq-runner-sidebar" aria-label={t("runner.labels.questionToolsAria")}>
      <details className="sq-card sq-disclosure" open>
        <summary className="sq-disclosure__summary">{t("runner.labels.tools")}</summary>

        <div className="sq-stack-md">
          {!isExamMode && questionId ? (
            <>
              <HintsPanel key={`hints-${runner.questionKey}`} sessionId={sessionId} questionId={questionId} locked={!!feedback} t={t} />
              <NotesPanel notes={notes} canReload={!!questionId} t={t} />
              <IssueReportPanel key={`issue-${runner.questionKey}`} sessionId={sessionId} questionId={questionId} mode="study" t={t} />
            </>
          ) : null}

          {isExamMode ? (
            <>
              <ExamNavigator
                reviewScreen={runner.reviewScreenQuery.data ?? null}
                answeredCount={examSession?.answered_count ?? 0}
                totalQuestions={runner.totalQuestions}
                currentPosition={runner.currentPosition}
                isLoading={runner.reviewScreenQuery.isPending}
                disabled={runner.isPaused}
                onJump={runner.jumpTo}
                t={t}
              />
              {/* The AI tutor only supports multiple-choice items (the API answers 409 for PBQs). */}
              {questionId && feedback && !runner.isPbq ? (
                <TutorPanel
                  key={`tutor-${runner.questionKey}`}
                  sessionId={sessionId}
                  questionId={questionId}
                  lockedDuringExam={!examSession?.finished}
                  answered={!!feedback}
                  t={t}
                />
              ) : null}
              {questionId ? (
                <IssueReportPanel key={`issue-${runner.questionKey}`} sessionId={sessionId} questionId={questionId} mode="exam" t={t} />
              ) : null}
            </>
          ) : null}

          {feedback?.official_references?.length ? (
            <div className="sq-runner-utility">
              <div className="sq-list-title">{t("runner.labels.references")}</div>
              <ReferencesList
                className="sq-gap-top-sm"
                references={feedback.official_references}
                ariaLabel={t("runner.labels.referencesOfficialAria")}
                t={t}
              />
            </div>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
