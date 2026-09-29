"use client";

import { useId } from "react";

import { PbqItemExplanation, PbqMark, pbqStyles as pbq, type PbqTaskProps } from "@/features/session-runner/components/pbq/pbq-shared";
import { selectClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { PbqMatchingResponse, PbqMatchingTask, PbqTextItem } from "@/types/api";

/**
 * Matching task: one labelled select per left-hand item. Without `allow_reuse`, choosing an
 * option already paired elsewhere moves it (the other pair is cleared and the change announced).
 */
export function PbqMatchingTask({
  task,
  value,
  onChange,
  disabled,
  solution,
  perItem,
  labelledBy,
  t
}: PbqTaskProps<PbqMatchingTask, PbqMatchingResponse>) {
  const baseId = useId();
  const left = task.left ?? [];
  const right = task.right ?? [];
  const allowReuse = task.allow_reuse === true;
  const rightText = new Map(right.map((item) => [item.id, item.text]));
  const leftText = new Map(left.map((item) => [item.id, item.text]));
  const expected = solution?.type === "matching" ? solution.map : null;

  function choose(item: PbqTextItem, rightId: string) {
    if (disabled) {
      return;
    }
    const next = { ...value };
    const announcements: string[] = [];
    if (!rightId) {
      delete next[item.id];
      announcements.push(t("pbq.matching.cleared", { left: item.text }));
    } else {
      if (!allowReuse) {
        for (const [leftId, pairedRight] of Object.entries(next)) {
          if (leftId !== item.id && pairedRight === rightId) {
            delete next[leftId];
            announcements.push(
              t("pbq.matching.reused", {
                right: rightText.get(rightId) ?? rightId,
                left: leftText.get(leftId) ?? leftId
              })
            );
          }
        }
      }
      next[item.id] = rightId;
      announcements.unshift(
        t("pbq.matching.paired", {
          left: item.text,
          right: rightText.get(rightId) ?? rightId
        })
      );
    }
    onChange(next, announcements.join(" "));
  }

  return (
    <div className={pbq.taskBody} role="group" aria-labelledby={labelledBy}>
      <p className={pbq.hint}>{allowReuse ? t("pbq.matching.reuseHint") : t("pbq.matching.noReuseHint")}</p>
      <ul className={pbq.itemList}>
        {left.map((item) => {
          const selectId = `${baseId}-${item.id}`;
          const chosen = value[item.id] ?? "";
          const expectedRight = expected?.[item.id];
          const usedElsewhere = new Set(
            Object.entries(value)
              .filter(([leftId]) => leftId !== item.id)
              .map(([, rightId]) => rightId)
          );
          return (
            <li key={item.id} className={pbq.card} data-testid={`pbq-match-${item.id}`}>
              <span className={pbq.cardText}>{item.text}</span>
              <label className="sr-only" htmlFor={selectId}>
                {t("pbq.matching.selectLabel", { item: item.text })}
              </label>
              <select
                id={selectId}
                className={cn(selectClassName, pbq.cardSelect)}
                value={chosen}
                disabled={disabled}
                onChange={(event) => choose(item, event.target.value)}
              >
                <option value="">{t("pbq.matching.placeholder")}</option>
                {right.map((option) => (
                  <option key={option.id} value={option.id}>
                    {!allowReuse && usedElsewhere.has(option.id) ? t("pbq.matching.inUse", { choice: option.text }) : option.text}
                  </option>
                ))}
              </select>
              {expected ? (
                <PbqMark ok={!!expectedRight && chosen === expectedRight}>
                  {chosen === expectedRight
                    ? t("pbq.marks.correct")
                    : t("pbq.matching.expected", {
                        right: rightText.get(expectedRight ?? "") ?? expectedRight ?? "-"
                      })}
                </PbqMark>
              ) : null}
              {expected ? <PbqItemExplanation text={perItem[item.id]} /> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
