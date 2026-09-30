"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import {
  PbqItemExplanation,
  PbqMark,
  PbqProgress,
  cardTone,
  pbqStyles as pbq,
  useFlip,
  type PbqTaskProps
} from "@/features/session-runner/components/pbq/pbq-shared";
import { CircleCheckIcon, GripIcon } from "@/components/ui/icons";
import { selectClassName, selectSmClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { PbqCategorizationResponse, PbqCategorizationTask, PbqTextItem } from "@/types/api";

const POOL = "__pool__";

/**
 * Categorization task: drag items into buckets, or pick the bucket in each item's own select
 * (keyboard/screen-reader alternative). Focus follows the item when it moves; moves are announced
 * and animated (FLIP) so the eye can follow the card to its new bucket.
 */
export function PbqCategorizationTask({
  task,
  value,
  onChange,
  disabled,
  solution,
  perItem,
  labelledBy,
  t
}: PbqTaskProps<PbqCategorizationTask, PbqCategorizationResponse>) {
  const baseId = useId();
  const items = task.items ?? [];
  const buckets = task.buckets ?? [];
  const bucketLabel = new Map(buckets.map((bucket) => [bucket.id, bucket.label]));
  const expected = solution?.type === "categorization" ? solution.map : null;

  const selectRefs = useRef(new Map<string, HTMLSelectElement | null>());
  const pendingFocus = useRef<string | null>(null);
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const flip = useFlip<HTMLLIElement>(value);

  useEffect(() => {
    const id = pendingFocus.current;
    if (id) {
      pendingFocus.current = null;
      selectRefs.current.get(id)?.focus();
    }
  }, [value]);

  function assign(item: PbqTextItem, bucketId: string, keepFocus: boolean) {
    if (disabled) {
      return;
    }
    const current = value[item.id] ?? "";
    const target = bucketId === POOL ? "" : bucketId;
    if (current === target) {
      return;
    }
    const next = { ...value };
    if (target) {
      next[item.id] = target;
    } else {
      delete next[item.id];
    }
    if (keepFocus) {
      pendingFocus.current = item.id;
    }
    flip.capture();
    onChange(
      next,
      target
        ? t("pbq.categorization.assigned", {
            item: item.text,
            bucket: bucketLabel.get(target) ?? target
          })
        : t("pbq.categorization.unassignedAnnounce", { item: item.text })
    );
  }

  function endDrag() {
    dragId.current = null;
    setDragging(null);
    setDropTarget(null);
  }

  function dropZoneProps(bucketId: string) {
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (disabled || !dragId.current) {
          return;
        }
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        if (dropTarget !== bucketId) {
          setDropTarget(bucketId);
        }
      },
      onDragLeave: (event: DragEvent<HTMLDivElement>) => {
        // Moving over a child card fires dragleave on the zone: only clear when truly leaving it.
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
          return;
        }
        setDropTarget((current) => (current === bucketId ? null : current));
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const id = dragId.current ?? event.dataTransfer?.getData("text/plain") ?? null;
        dragId.current = null;
        setDragging(null);
        setDropTarget(null);
        const item = items.find((entry) => entry.id === id);
        if (item) {
          assign(item, bucketId, false);
        }
      }
    };
  }

  function renderItem(item: PbqTextItem, compact: boolean) {
    const selectId = `${baseId}-${item.id}`;
    const assigned = value[item.id] ?? "";
    const expectedBucket = expected?.[item.id];
    const ok = !!expectedBucket && assigned === expectedBucket;
    return (
      <li
        key={item.id}
        ref={flip.register(item.id)}
        className={cn(
          pbq.card,
          !disabled && pbq.draggable,
          cardTone({ disabled, verdict: expected ? ok : null, dragging: dragging === item.id })
        )}
        draggable={!disabled}
        onDragStart={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          dragId.current = item.id;
          event.dataTransfer?.setData("text/plain", item.id);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
          // Defer so the browser snapshots the card before it turns into the "placeholder" look.
          requestAnimationFrame(() => {
            if (dragId.current === item.id) {
              setDragging(item.id);
            }
          });
        }}
        onDragEnd={endDrag}
        data-testid={`pbq-cat-item-${item.id}`}
      >
        <div className={pbq.cardBody}>
          <div className={pbq.cardRow}>
            <div className={pbq.cardLead}>
              {!disabled ? <GripIcon className={cn(pbq.grip, "mt-1")} /> : null}
              <span className={pbq.cardText}>{item.text}</span>
            </div>
            <label className="sr-only" htmlFor={selectId}>
              {t("pbq.categorization.selectLabel", { item: item.text })}
            </label>
            <select
              id={selectId}
              ref={(node) => {
                selectRefs.current.set(item.id, node);
              }}
              className={cn(compact ? selectSmClassName : selectClassName, pbq.cardSelect)}
              value={assigned}
              disabled={disabled}
              onChange={(event) => assign(item, event.target.value || POOL, true)}
            >
              <option value="">{t("pbq.categorization.unassigned")}</option>
              {buckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.label}
                </option>
              ))}
            </select>
          </div>
          {expected ? (
            <PbqMark ok={ok}>
              {assigned === expectedBucket
                ? t("pbq.marks.correct")
                : t("pbq.categorization.expected", {
                    bucket: bucketLabel.get(expectedBucket ?? "") ?? expectedBucket ?? "-"
                  })}
            </PbqMark>
          ) : null}
          {expected ? <PbqItemExplanation text={perItem[item.id]} /> : null}
        </div>
      </li>
    );
  }

  const unassigned = items.filter((item) => !value[item.id] || !bucketLabel.has(value[item.id] as string));
  const placed = items.length - unassigned.length;
  const armed = !!dragging;

  function bucketState(bucketId: string, done: boolean): keyof typeof pbq.bucketTone {
    if (dropTarget === bucketId) {
      return "target";
    }
    if (armed) {
      return "armed";
    }
    return done ? "done" : "idle";
  }

  return (
    <div className={pbq.taskBody} role="group" aria-labelledby={labelledBy}>
      {!disabled ? (
        <>
          <p className={pbq.hint}>{t("pbq.categorization.dragHint")}</p>
          <PbqProgress done={placed} total={items.length} label={t("pbq.categorization.progress", { done: placed, total: items.length })} />
        </>
      ) : null}
      <div
        className={cn(pbq.bucket, pbq.bucketTone[bucketState(POOL, !unassigned.length)])}
        {...dropZoneProps(POOL)}
      >
        <div className={pbq.bucketHead} id={`${baseId}-pool`}>
          <span className={pbq.bucketTitle}>{t("pbq.categorization.pool")}</span>
          <CountPill count={unassigned.length} label={t("pbq.categorization.bucketCount", { count: unassigned.length })} />
        </div>
        {unassigned.length ? (
          <ul className={pbq.itemList} aria-labelledby={`${baseId}-pool`}>
            {unassigned.map((item) => renderItem(item, false))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-1 text-[0.8125rem] font-medium text-success">
            <CircleCheckIcon className="animate-[pop-in_260ms_var(--ease-out)]" />
            {t("pbq.categorization.poolEmpty")}
          </p>
        )}
      </div>
      <div className={pbq.bucketGrid}>
        {buckets.map((bucket) => {
          const assignedItems = items.filter((item) => value[item.id] === bucket.id);
          const headingId = `${baseId}-bucket-${bucket.id}`;
          const isTarget = dropTarget === bucket.id;
          return (
            <div
              key={bucket.id}
              className={cn(pbq.bucket, pbq.bucketTone[bucketState(bucket.id, false)])}
              data-testid={`pbq-bucket-${bucket.id}`}
              {...dropZoneProps(bucket.id)}
            >
              <div className={pbq.bucketHead} id={headingId}>
                <span className={pbq.bucketTitle}>
                  <span className={cn(pbq.bucketDot, pbq.bucketDotTone[assignedItems.length ? "filled" : "empty"])} aria-hidden="true" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{bucket.label}</span>
                </span>
                <CountPill
                  count={assignedItems.length}
                  label={t("pbq.categorization.bucketCount", { count: assignedItems.length })}
                />
              </div>
              {assignedItems.length ? (
                <ul className={pbq.itemList} aria-labelledby={headingId}>
                  {assignedItems.map((item) => renderItem(item, true))}
                </ul>
              ) : (
                <p className={cn(pbq.bucketEmpty, pbq.bucketEmptyTone[isTarget ? "target" : "idle"])}>{t("pbq.categorization.bucketEmpty")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Bucket counter: the number pops when it changes (remount via key); the sentence is for screen readers. */
function CountPill({ count, label }: { count: number; label: string }) {
  return (
    <span key={count} className={pbq.pill}>
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
