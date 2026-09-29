"use client";

import type { RefObject } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { ArrowLeftIcon, FocusIcon, KeyboardIcon, PanelIcon, PauseIcon, PlayIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { ExamTimer } from "@/features/session-runner/components/exam-timer";
import type { RunnerController } from "@/features/session-runner/hooks/use-runner-session";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";

const iconButton =
  "focus-ring inline-grid size-9 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg aria-pressed:bg-surface-muted aria-pressed:text-fg";

interface RunnerHeaderProps {
  runner: RunnerController;
  strategyLabel: string;
  focusMode: boolean;
  onToggleFocus: () => void;
  panelDocked: boolean;
  panelOpen: boolean;
  panelTitle: string;
  panelToggleRef: RefObject<HTMLButtonElement | null>;
  onTogglePanel: () => void;
  onRequestSubmitExam: () => void;
  shortcutsOpen: boolean;
  onShortcutsOpenChange: (open: boolean) => void;
  t: Translate;
}

export function RunnerHeader({
  runner,
  strategyLabel,
  focusMode,
  onToggleFocus,
  panelDocked,
  panelOpen,
  panelTitle,
  panelToggleRef,
  onTogglePanel,
  onRequestSubmitExam,
  shortcutsOpen,
  onShortcutsOpenChange,
  t
}: RunnerHeaderProps) {
  const { isExamMode, isExamDayMode, isPaused, examSession, studySession, totalQuestions } = runner;
  const answered = examSession?.answered_count ?? studySession?.answered_count ?? 0;
  const percent = totalQuestions ? Math.round((answered / totalQuestions) * 100) : 0;

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur-sm">
      <div className="flex h-14 items-center gap-2 px-2 sm:gap-3 sm:px-4">
        {!isExamDayMode ? (
          <Link href="/dashboard" className="focus-ring inline-flex h-9 items-center gap-2 rounded-md px-2.5 text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg" aria-label={t("runner.layout.exit")}>
            <ArrowLeftIcon />
            <span aria-hidden="true" className={cn("max-md:hidden", focusMode && "hidden")}>
              {t("common.labels.dashboard")}
            </span>
          </Link>
        ) : null}

        <div className={cn("min-w-0 max-sm:hidden", focusMode && "hidden")}>
          <p className="truncate text-sm font-semibold text-fg">{isExamMode ? t("runner.header.examTitle") : t("runner.header.studyTitle")}</p>
          <p className="truncate text-xs text-fg-muted">{isExamDayMode ? t("runner.examDay.tag") : strategyLabel}</p>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <p className="nums font-mono text-sm text-fg-muted">
            <span className="sr-only">{t("runner.layout.progress", { answered, total: totalQuestions || "-" })}</span>
            <span aria-hidden="true">
              <span className="font-medium text-fg">{runner.currentPosition + 1}</span>
              <span className="px-1 text-fg-subtle">/</span>
              {totalQuestions || "-"}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-1">
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
          {isExamMode ? (
            <button
              type="button"
              className={iconButton}
              onClick={() => void runner.togglePause()}
              disabled={runner.pending === "pause"}
              aria-label={isPaused ? t("common.actions.resume") : t("common.actions.pause")}
              title={isPaused ? t("common.actions.resume") : t("common.actions.pause")}
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </button>
          ) : null}

          <span aria-hidden="true" className="mx-1 h-5 w-px bg-line max-sm:hidden" />

          <button
            type="button"
            className={cn(iconButton, "max-md:hidden")}
            onClick={() => onShortcutsOpenChange(true)}
            aria-label={t("runner.layout.shortcuts")}
            title={t("runner.layout.shortcuts")}
          >
            <KeyboardIcon />
          </button>
          <button
            type="button"
            className={cn(iconButton, "max-sm:hidden")}
            aria-pressed={focusMode}
            onClick={onToggleFocus}
            aria-label={focusMode ? t("runner.layout.focusOff") : t("runner.layout.focusOn")}
            title={focusMode ? t("runner.layout.focusOff") : t("runner.layout.focusOn")}
          >
            <FocusIcon />
          </button>
          {!panelDocked ? (
            <button
              ref={panelToggleRef}
              type="button"
              className={iconButton}
              aria-expanded={panelOpen}
              aria-controls="runner-panel"
              onClick={onTogglePanel}
              aria-label={`${panelOpen ? t("runner.layout.panelClose") : t("runner.layout.panelOpen")}: ${panelTitle}`}
              title={panelTitle}
            >
              <PanelIcon />
            </button>
          ) : null}

          {isExamMode ? (
            <Button variant="secondary" size="sm" className="ml-1 max-sm:px-2.5" busy={runner.pending === "finalize"} disabled={isPaused} onClick={onRequestSubmitExam}>
              {t("runner.actions.submitExam")}
            </Button>
          ) : null}
        </div>
      </div>
      <div aria-hidden="true" className="h-0.5 w-full bg-transparent">
        <div className="h-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${percent}%` }} />
      </div>

      <Dialog open={shortcutsOpen} onClose={() => onShortcutsOpenChange(false)} title={t("runner.layout.shortcuts")} showCloseButton>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-3 text-sm">
          {(
            [
              [["A", "B", "C", "1", "2"], "runner.shortcuts.select"],
              [["↑", "↓"], "runner.shortcuts.move"],
              [["X"], "runner.shortcuts.eliminate"],
              [["Enter", "Ctrl+Enter"], "runner.shortcuts.confirm"],
              [["Enter", "Space"], "runner.shortcuts.next"],
              ...(isExamMode ? ([[["M"], "runner.shortcuts.mark"]] as const) : []),
              [["F"], "runner.shortcuts.focus"],
              [["Esc"], "runner.shortcuts.close"]
            ] as const
          ).map(([keys, label]) => (
            <div key={label} className="contents">
              <dt className="flex gap-1 text-fg-muted">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
                <span className="sr-only">{keys.join(", ")}</span>
              </dt>
              <dd className="text-fg">{t(label)}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </header>
  );
}
