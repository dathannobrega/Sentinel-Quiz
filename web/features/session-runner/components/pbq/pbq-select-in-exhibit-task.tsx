"use client";

import { useId } from "react";

import { PbqItemExplanation, PbqMark, type PbqTaskProps } from "@/features/session-runner/components/pbq/pbq-shared";
import { selectableExhibitLines, type NormalizedExhibit } from "@/features/session-runner/lib/pbq-utils";
import { cn } from "@/lib/utils/cn";
import type { PbqSelectInExhibitResponse, PbqSelectInExhibitTask } from "@/types/api";

interface Props extends PbqTaskProps<PbqSelectInExhibitTask, PbqSelectInExhibitResponse> {
  exhibit: NormalizedExhibit | null;
}

/**
 * Select-in-exhibit: the exhibit lines (log lines or table rows) as native checkboxes (multiple)
 * or radios (single) inside a fieldset — native inputs give the keyboard model for free
 * (Space toggles, arrows move between radios).
 */
export function PbqSelectInExhibitTask({ task, value, onChange, disabled, solution, perItem, labelledBy, exhibit, t }: Props) {
  const baseId = useId();
  const single = task.select_mode === "single";
  const lines = selectableExhibitLines(exhibit);
  const expected = solution?.type === "select_in_exhibit" ? new Set(solution.selected) : null;
  const title = exhibit?.title || task.exhibit_id;

  if (!exhibit || !lines.length) {
    return <p className="sq-list-meta">{t("pbq.selectInExhibit.exhibitMissing")}</p>;
  }

  function toggle(lineId: string, checked: boolean) {
    if (disabled) {
      return;
    }
    if (single) {
      onChange(checked ? [lineId] : []);
      return;
    }
    const next = checked ? Array.from(new Set([...value, lineId])) : value.filter((item) => item !== lineId);
    onChange(next);
  }

  return (
    <fieldset className="sq-pbq-task-body sq-pbq-fieldset" aria-describedby={labelledBy}>
      <legend className="sq-list-title">
        {single ? t("pbq.selectInExhibit.legendSingle", { title }) : t("pbq.selectInExhibit.legendMultiple", { title })}
      </legend>
      <ul className={cn("sq-pbq-lines", exhibit.type === "log" && "sq-pbq-lines--mono")}>
        {lines.map((line) => {
          const inputId = `${baseId}-${line.id}`;
          const checked = value.includes(line.id);
          const shouldSelect = expected?.has(line.id) ?? false;
          let mark: { ok: boolean; text: string } | null = null;
          if (expected) {
            if (checked && shouldSelect) {
              mark = {
                ok: true,
                text: t("pbq.selectInExhibit.correctlySelected")
              };
            } else if (!checked && shouldSelect) {
              mark = { ok: false, text: t("pbq.selectInExhibit.shouldSelect") };
            } else if (checked && !shouldSelect) {
              mark = {
                ok: false,
                text: t("pbq.selectInExhibit.shouldNotSelect")
              };
            }
          }
          return (
            <li key={line.id} className={cn("sq-pbq-line", checked && "sq-pbq-line--selected")}>
              <input
                id={inputId}
                type={single ? "radio" : "checkbox"}
                name={single ? `${baseId}-choice` : undefined}
                checked={checked}
                disabled={disabled}
                onChange={(event) => toggle(line.id, event.target.checked)}
              />
              <label htmlFor={inputId} className="sq-pbq-line__text">
                {line.text}
              </label>
              {mark ? <PbqMark ok={mark.ok}>{mark.text}</PbqMark> : null}
              {expected ? <PbqItemExplanation text={perItem[line.id]} /> : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
