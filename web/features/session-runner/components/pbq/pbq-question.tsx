"use client";

import { useId, useMemo, useState } from "react";

import { PbqCategorizationTask } from "@/features/session-runner/components/pbq/pbq-categorization-task";
import { PbqExhibits } from "@/features/session-runner/components/pbq/pbq-exhibits";
import { PbqMatchingTask } from "@/features/session-runner/components/pbq/pbq-matching-task";
import { PbqOrderingTask } from "@/features/session-runner/components/pbq/pbq-ordering-task";
import { PbqSelectInExhibitTask } from "@/features/session-runner/components/pbq/pbq-select-in-exhibit-task";
import { PbqTableFormTask } from "@/features/session-runner/components/pbq/pbq-table-form-task";
import {
  countCompleteTasks,
  findTaskResult,
  normalizeExhibit,
  normalizeExplanation,
  normalizeSolution,
  scoreToPercent,
  type PbqResultData,
  taskResponse
} from "@/features/session-runner/lib/pbq-utils";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import type {
  PbqCategorizationResponse,
  PbqMatchingResponse,
  PbqOrderingResponse,
  PbqPayload,
  PbqResponse,
  PbqSelectInExhibitResponse,
  PbqTableFormResponse,
  PbqTask,
  PbqTaskResponse,
  PbqTaskResult
} from "@/types/api";

type HeadingLevel = 2 | 3 | 4;
type HeadingTag = "h2" | "h3" | "h4" | "h5";

export type { PbqResultData };

interface PbqQuestionProps {
  payload: PbqPayload;
  response: PbqResponse | null | undefined;
  onChange?: (response: PbqResponse) => void;
  disabled: boolean;
  /**
   * Grading data. Per-task results are shown when present; the answer-key overlay and the
   * explanations only when `pbq_solution` / `pbq_explanations` are present (never in exam_day
   * before the session is finished — the backend withholds them).
   */
  result?: PbqResultData | null;
  /** Level of the PBQ title heading (tasks and exhibits use the next level). */
  headingLevel?: HeadingLevel;
  t: Translate;
}

function headingTag(level: number): HeadingTag {
  return `h${Math.min(Math.max(level, 2), 5)}` as HeadingTag;
}

export function taskResultLabel(result: PbqTaskResult, t: Translate): string {
  if (result.is_correct) {
    return t("pbq.feedback.taskCorrect");
  }
  return (result.score ?? 0) > 0 ? t("pbq.feedback.taskPartial") : t("pbq.feedback.taskWrong");
}

/**
 * A PBQ: title, scenario panel, exhibits and one renderer per task. Used by the session runner
 * (interactive) and by the result review (read-only, answer vs. answer key).
 */
export function PbqQuestion({ payload, response, onChange, disabled, result, headingLevel = 2, t }: PbqQuestionProps) {
  const baseId = useId();
  const [announcement, setAnnouncement] = useState("");
  const [showSolution, setShowSolution] = useState(true);
  const TitleTag = headingTag(headingLevel);
  const SectionTag = headingTag(headingLevel + 1);

  const exhibits = useMemo(() => (payload.exhibits ?? []).map(normalizeExhibit), [payload.exhibits]);
  const tasks = payload.tasks ?? [];
  const hasSolution = !!result?.pbq_solution && Object.keys(result.pbq_solution).length > 0;
  const overlay = hasSolution && showSolution;
  const completeCount = countCompleteTasks(payload, response);

  function update(task: PbqTask, value: PbqTaskResponse, text?: string) {
    if (!onChange || disabled) {
      return;
    }
    onChange({ ...(response ?? {}), [task.id]: value });
    if (text) {
      setAnnouncement(text);
    }
  }

  function renderTask(task: PbqTask, labelledBy: string) {
    const solution = overlay ? normalizeSolution(task, result?.pbq_solution?.[task.id]) : null;
    const perItem = overlay ? (normalizeExplanation(result?.pbq_explanations?.[task.id])?.perItem ?? {}) : {};
    const value = taskResponse(task, response);
    const common = { disabled, solution, perItem, labelledBy, t };
    switch (task.type) {
      case "ordering":
        return (
          <PbqOrderingTask
            {...common}
            task={task}
            value={value as PbqOrderingResponse}
            onChange={(next, text) => update(task, next, text)}
          />
        );
      case "categorization":
        return (
          <PbqCategorizationTask
            {...common}
            task={task}
            value={value as PbqCategorizationResponse}
            onChange={(next, text) => update(task, next, text)}
          />
        );
      case "matching":
        return (
          <PbqMatchingTask
            {...common}
            task={task}
            value={value as PbqMatchingResponse}
            onChange={(next, text) => update(task, next, text)}
          />
        );
      case "table_form":
        return (
          <PbqTableFormTask
            {...common}
            task={task}
            value={value as PbqTableFormResponse}
            onChange={(next, text) => update(task, next, text)}
          />
        );
      case "select_in_exhibit":
        return (
          <PbqSelectInExhibitTask
            {...common}
            task={task}
            exhibit={exhibits.find((exhibit) => exhibit.id === task.exhibit_id) ?? null}
            value={value as PbqSelectInExhibitResponse}
            onChange={(next, text) => update(task, next, text)}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="sq-pbq" data-testid="pbq-question">
      <div className="sq-pbq__head">
        <TitleTag className="sq-section-title sq-pbq__title" id={`${baseId}-title`}>
          <span className="sq-chip sq-pbq__badge">{t("pbq.badge")}</span> {payload.title}
        </TitleTag>
        {!disabled ? (
          <span className="sq-chip">
            {t("pbq.tasksComplete", {
              complete: completeCount,
              total: tasks.length
            })}
          </span>
        ) : null}
      </div>

      {payload.scenario ? (
        <section className="sq-pbq-scenario" aria-labelledby={`${baseId}-scenario`}>
          <SectionTag className="sq-list-title" id={`${baseId}-scenario`}>
            {t("pbq.scenario")}
          </SectionTag>
          <p className="sq-pbq-scenario__text">{payload.scenario}</p>
        </section>
      ) : null}

      {exhibits.length ? (
        <section className="sq-pbq-exhibits-panel" aria-labelledby={`${baseId}-exhibits`}>
          <SectionTag className="sq-list-title" id={`${baseId}-exhibits`}>
            {t("pbq.exhibits")}
          </SectionTag>
          <PbqExhibits exhibits={exhibits} headingTag={headingTag(headingLevel + 2)} t={t} />
        </section>
      ) : null}

      {!disabled ? <p className="sq-list-meta sq-pbq-hint">{t("pbq.keyboardHelp")}</p> : null}

      {hasSolution ? (
        <div className="sq-actions">
          <button
            type="button"
            className="sq-button sq-button--secondary sq-button--sm"
            aria-pressed={showSolution}
            onClick={() => setShowSolution((current) => !current)}
          >
            {showSolution ? t("pbq.feedback.hideSolution") : t("pbq.feedback.showSolution")}
          </button>
        </div>
      ) : null}

      {tasks.map((task, index) => {
        const headingId = `${baseId}-task-${task.id}`;
        const promptId = `${headingId}-prompt`;
        const taskResult = findTaskResult(result?.task_results, task.id);
        const percent = taskResult ? scoreToPercent(taskResult.score) : null;
        const explanation =
          overlay || (!hasSolution && result?.pbq_explanations)
            ? normalizeExplanation(result?.pbq_explanations?.[task.id])
            : null;
        return (
          <section
            key={task.id}
            className={cn("sq-pbq-task", taskResult && (taskResult.is_correct ? "sq-pbq-task--correct" : "sq-pbq-task--wrong"))}
            aria-labelledby={headingId}
            data-testid={`pbq-task-${task.id}`}
          >
            <div className="sq-pbq-task__head">
              <SectionTag className="sq-list-title" id={headingId}>
                {t("pbq.taskHeading", {
                  current: index + 1,
                  total: tasks.length
                })}
              </SectionTag>
              <div className="sq-chip-row">
                {typeof task.weight === "number" ? (
                  <span className="sq-chip">{t("pbq.taskWeight", { weight: task.weight })}</span>
                ) : null}
                {taskResult ? (
                  <span className={cn("sq-chip", taskResult.is_correct ? "sq-chip--success" : "sq-chip--danger")}>
                    <span aria-hidden="true">{taskResult.is_correct ? "✓ " : "✗ "}</span>
                    {taskResultLabel(taskResult, t)}
                    {percent !== null ? ` · ${percent}%` : ""}
                  </span>
                ) : null}
              </div>
            </div>
            <p className="sq-pbq-task__prompt" id={promptId}>
              {task.prompt}
            </p>
            {renderTask(task, `${headingId} ${promptId}`)}
            {explanation?.summary ? (
              <div className="sq-pbq-explanation">
                <div className="sq-list-title">{t("pbq.feedback.explanation")}</div>
                <p>{explanation.summary}</p>
              </div>
            ) : null}
          </section>
        );
      })}

      <div className="sq-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}
