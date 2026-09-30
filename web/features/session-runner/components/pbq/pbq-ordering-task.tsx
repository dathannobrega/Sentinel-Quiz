"use client";

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import {
  PbqItemExplanation,
  PbqMark,
  cardTone,
  pbqStyles as pbq,
  useFlip,
  type PbqTaskProps
} from "@/features/session-runner/components/pbq/pbq-shared";
import { ChevronDownIcon, ChevronUpIcon, GripIcon } from "@/components/ui/icons";
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
  const [dragging, setDragging] = useState<string | null>(null);
  const flip = useFlip<HTMLLIElement>(order);

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
    flip.capture();
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
    requestAnimationFrame(() => {
      if (dragId.current === id) {
        setDragging(id);
      }
    });
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
    setDragging(null);
    if (id && !disabled) {
      commitMove(id, index);
    }
  }

  function handleDragEnd() {
    dragId.current = null;
    setDropIndex(null);
    setDragging(null);
  }

  const draggingIndex = dragging ? order.indexOf(dragging) : -1;

  return (
    <div className={pbq.taskBody}>
      {!disabled ? <p className={pbq.hint}>{t("pbq.ordering.dragHint")}</p> : null}
      <ol className={pbq.order} aria-labelledby={labelledBy}>
        {order.map((id, index) => {
          const text = textById.get(id) ?? id;
          const expectedPosition = expectedOrder ? expectedOrder.indexOf(id) + 1 : 0;
          const isRightPlace = expectedOrder ? expectedOrder[index] === id : false;
          const isDropTarget = dropIndex === index && draggingIndex !== -1 && draggingIndex !== index;
          return (
            <li
              key={id}
              ref={flip.register(id)}
              className={cn(
                pbq.orderItem,
                !disabled && pbq.draggable,
                cardTone({
                  disabled,
                  verdict: expectedOrder ? isRightPlace : null,
                  dragging: dragging === id,
                  target: isDropTarget
                })
              )}
              draggable={!disabled}
              onDragStart={(event) => handleDragStart(event, id)}
              onDragOver={(event) => handleDragOver(event, index)}
              onDrop={(event) => handleDrop(event, index)}
              onDragEnd={handleDragEnd}
              data-testid={`pbq-order-item-${id}`}
            >
              {!disabled ? <GripIcon className={pbq.grip} /> : null}
              <span
                className={cn(
                  pbq.orderPosition,
                  pbq.orderPositionTone[expectedOrder ? (isRightPlace ? "correct" : "wrong") : "pending"]
                )}
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className={pbq.orderText}>
                <span data-pbq-item-text>{text}</span>
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
                <div className={pbq.orderControls}>
                  <button
                    type="button"
                    ref={(node) => {
                      buttonRefs.current.set(`${id}:up`, node);
                    }}
                    className={pbq.orderButton}
                    aria-label={t("pbq.ordering.moveUp", { item: text })}
                    title={t("pbq.ordering.moveUpShort")}
                    disabled={index === 0}
                    onClick={() => move(id, "up")}
                    onKeyDown={(event) => handleKeyDown(event, id)}
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    type="button"
                    ref={(node) => {
                      buttonRefs.current.set(`${id}:down`, node);
                    }}
                    className={pbq.orderButton}
                    aria-label={t("pbq.ordering.moveDown", { item: text })}
                    title={t("pbq.ordering.moveDownShort")}
                    disabled={index === total - 1}
                    onClick={() => move(id, "down")}
                    onKeyDown={(event) => handleKeyDown(event, id)}
                  >
                    <ChevronDownIcon />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {expectedOrder ? (
        <div className={pbq.solution}>
          <div className="text-sm font-semibold text-success">{t("pbq.ordering.correctOrder")}</div>
          <ol className={pbq.solutionList}>
            {expectedOrder.map((id) => (
              <li key={id}>{textById.get(id) ?? id}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
