"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import { PbqItemExplanation, PbqMark, type PbqTaskProps } from "@/features/session-runner/components/pbq/pbq-shared";
import { moveItem } from "@/features/session-runner/lib/pbq-utils";
import { cn } from "@/lib/utils/cn";
import type { PbqOrderingResponse, PbqOrderingTask } from "@/types/api";

type Direction = "up" | "down";

/**
 * Ordering task: native HTML5 drag and drop plus the mandatory keyboard alternative — "Up"/"Down"
 * buttons on every item and Alt+ArrowUp/Alt+ArrowDown on them. Every move is announced.
 */
export function PbqOrderingTask({
  task,
  value,
  onChange,
  disabled,
  solution,
  perItem,
  labelledBy,
  t
}: PbqTaskProps<PbqOrderingTask, PbqOrderingResponse>) {
  const textById = new Map((task.items ?? []).map((item) => [item.id, item.text]));
  const order = value;
  const total = order.length;
  const expectedOrder = solution?.type === "ordering" ? solution.order : null;

  const buttonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  const pendingFocus = useRef<{ id: string; direction: Direction } | null>(null);
  const dragId = useRef<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Keep focus on the moved item's button; fall back to the other one when it becomes disabled.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    const index = order.indexOf(target.id);
    const blocked = target.direction === "up" ? index <= 0 : index >= order.length - 1;
    const direction: Direction = blocked ? (target.direction === "up" ? "down" : "up") : target.direction;
    buttonRefs.current.get(`${target.id}:${direction}`)?.focus();
  }, [order]);

  function commitMove(id: string, targetIndex: number) {
    const next = moveItem(order, id, targetIndex);
    if (next.join("|") === order.join("|")) {
      return;
    }
    onChange(
      next,
      t("pbq.ordering.moved", {
        item: textById.get(id) ?? id,
        position: next.indexOf(id) + 1,
        total: next.length
      })
    );
  }

  function move(id: string, direction: Direction) {
    if (disabled) {
      return;
    }
    const index = order.indexOf(id);
    pendingFocus.current = { id, direction };
    commitMove(id, direction === "up" ? index - 1 : index + 1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }
    event.preventDefault();
    move(id, event.key === "ArrowUp" ? "up" : "down");
  }

  function handleDragStart(event: DragEvent<HTMLLIElement>, id: string) {
    if (disabled) {
      event.preventDefault();
      return;
    }
    dragId.current = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  }

  function handleDragOver(event: DragEvent<HTMLLIElement>, index: number) {
    if (disabled || !dragId.current) {
      return;
    }
    event.preventDefault();
    if (dropIndex !== index) {
      setDropIndex(index);
    }
  }

  function handleDrop(event: DragEvent<HTMLLIElement>, index: number) {
    event.preventDefault();
    const id = dragId.current ?? event.dataTransfer?.getData("text/plain") ?? null;
    dragId.current = null;
    setDropIndex(null);
    if (id && !disabled) {
      commitMove(id, index);
    }
  }

  function handleDragEnd() {
    dragId.current = null;
    setDropIndex(null);
  }

  return (
    <div className="sq-pbq-task-body">
      {!disabled ? <p className="sq-list-meta sq-pbq-hint">{t("pbq.ordering.dragHint")}</p> : null}
      <ol className="sq-pbq-order" aria-labelledby={labelledBy}>
        {order.map((id, index) => {
          const text = textById.get(id) ?? id;
          const expectedPosition = expectedOrder ? expectedOrder.indexOf(id) + 1 : 0;
          const isRightPlace = expectedOrder ? expectedOrder[index] === id : false;
          return (
            <li
              key={id}
              className={cn(
                "sq-pbq-order__item",
                !disabled && "sq-pbq-draggable",
                dropIndex === index && "sq-pbq-order__item--drop-target"
              )}
              draggable={!disabled}
              onDragStart={(event) => handleDragStart(event, id)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              onDragEnd={handleDragEnd}
              data-testid={`pbq-order-item-${id}`}
            >
              <span className="sq-pbq-order__position" aria-hidden="true">
                {index + 1}
              </span>
              <div className="sq-pbq-order__text">
                <span>{text}</span>
                {expectedOrder ? (
                  <PbqMark ok={isRightPlace}>
                    {isRightPlace
                      ? t("pbq.ordering.correctPosition")
                      : t("pbq.ordering.expectedPosition", {
                          position: expectedPosition || "-"
                        })}
                  </PbqMark>
                ) : null}
                {expectedOrder ? <PbqItemExplanation text={perItem[id]} /> : null}
              </div>
              {!disabled ? (
                <div className="sq-pbq-order__controls">
                  <button
                    type="button"
                    ref={(node) => {
                      buttonRefs.current.set(`${id}:up`, node);
                    }}
                    className="sq-button sq-button--ghost sq-button--sm"
                    aria-label={t("pbq.ordering.moveUp", { item: text })}
                    disabled={index === 0}
                    onClick={() => move(id, "up")}
                    onKeyDown={(event) => handleKeyDown(event, id)}
                  >
                    <span aria-hidden="true">↑ </span>
                    {t("pbq.ordering.moveUpShort")}
                  </button>
                  <button
                    type="button"
                    ref={(node) => {
                      buttonRefs.current.set(`${id}:down`, node);
                    }}
                    className="sq-button sq-button--ghost sq-button--sm"
                    aria-label={t("pbq.ordering.moveDown", { item: text })}
                    disabled={index === total - 1}
                    onClick={() => move(id, "down")}
                    onKeyDown={(event) => handleKeyDown(event, id)}
                  >
                    <span aria-hidden="true">↓ </span>
                    {t("pbq.ordering.moveDownShort")}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {expectedOrder ? (
        <div className="sq-pbq-solution">
          <div className="sq-list-title">{t("pbq.ordering.correctOrder")}</div>
          <ol className="sq-pbq-solution__list">
            {expectedOrder.map((id) => (
              <li key={id}>{textById.get(id) ?? id}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
