"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";

import { PbqItemExplanation, PbqMark, pbqStyles as pbq, type PbqTaskProps } from "@/features/session-runner/components/pbq/pbq-shared";
import { selectClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { PbqCategorizationResponse, PbqCategorizationTask, PbqTextItem } from "@/types/api";

const POOL = "__pool__";

/**
 * Categorization task: drag items into buckets, or pick the bucket in each item's own select
 * (keyboard/screen-reader alternative). Focus follows the item when it moves; moves are announced.
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
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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

  function dropZoneProps(bucketId: string) {
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (disabled || !dragId.current) {
          return;
        }
        event.preventDefault();
        if (dropTarget !== bucketId) {
          setDropTarget(bucketId);
        }
      },
      onDragLeave: () => setDropTarget((current) => (current === bucketId ? null : current)),
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const id = dragId.current ?? event.dataTransfer?.getData("text/plain") ?? null;
        dragId.current = null;
        setDropTarget(null);
        const item = items.find((entry) => entry.id === id);
        if (item) {
          assign(item, bucketId, false);
        }
      }
    };
  }

  function renderItem(item: PbqTextItem) {
    const selectId = `${baseId}-${item.id}`;
    const assigned = value[item.id] ?? "";
    const expectedBucket = expected?.[item.id];
    return (
      <li
        key={item.id}
        className={cn(pbq.card, !disabled && pbq.draggable)}
        draggable={!disabled}
        onDragStart={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          dragId.current = item.id;
          event.dataTransfer?.setData("text/plain", item.id);
        }}
        onDragEnd={() => {
          dragId.current = null;
          setDropTarget(null);
        }}
        data-testid={`pbq-cat-item-${item.id}`}
      >
        <span className={pbq.cardText}>{item.text}</span>
        <label className="sr-only" htmlFor={selectId}>
          {t("pbq.categorization.selectLabel", { item: item.text })}
        </label>
        <select
          id={selectId}
          ref={(node) => {
            selectRefs.current.set(item.id, node);
          }}
          className={cn(selectClassName, pbq.cardSelect)}
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
        {expected ? (
          <PbqMark ok={!!expectedBucket && assigned === expectedBucket}>
            {assigned === expectedBucket
              ? t("pbq.marks.correct")
              : t("pbq.categorization.expected", {
                  bucket: bucketLabel.get(expectedBucket ?? "") ?? expectedBucket ?? "-"
                })}
          </PbqMark>
        ) : null}
        {expected ? <PbqItemExplanation text={perItem[item.id]} /> : null}
      </li>
    );
  }

  const unassigned = items.filter((item) => !value[item.id] || !bucketLabel.has(value[item.id] as string));

  return (
    <div className={pbq.taskBody} role="group" aria-labelledby={labelledBy}>
      {!disabled ? <p className={pbq.hint}>{t("pbq.categorization.dragHint")}</p> : null}
      <div
        className={cn(pbq.bucket, pbq.bucketPool, dropTarget === POOL && pbq.dropTarget)}
        {...dropZoneProps(POOL)}
      >
        <div className={pbq.bucketHead} id={`${baseId}-pool`}>
          <span className={pbq.bucketTitle}>{t("pbq.categorization.pool")}</span>
          <span className={pbq.counter}>{t("pbq.categorization.bucketCount", { count: unassigned.length })}</span>
        </div>
        {unassigned.length ? (
          <ul className={pbq.itemList} aria-labelledby={`${baseId}-pool`}>
            {unassigned.map(renderItem)}
          </ul>
        ) : (
          <p className={pbq.hint}>{t("pbq.categorization.poolEmpty")}</p>
        )}
      </div>
      <div className={pbq.bucketGrid}>
        {buckets.map((bucket) => {
          const assignedItems = items.filter((item) => value[item.id] === bucket.id);
          const headingId = `${baseId}-bucket-${bucket.id}`;
          return (
            <div
              key={bucket.id}
              className={cn(pbq.bucket, dropTarget === bucket.id && pbq.dropTarget)}
              data-testid={`pbq-bucket-${bucket.id}`}
              {...dropZoneProps(bucket.id)}
            >
              <div className={pbq.bucketHead} id={headingId}>
                <span className={pbq.bucketTitle}>{bucket.label}</span>
                <span className={pbq.counter}>
                  {t("pbq.categorization.bucketCount", {
                    count: assignedItems.length
                  })}
                </span>
              </div>
              {assignedItems.length ? (
                <ul className={pbq.itemList} aria-labelledby={headingId}>
                  {assignedItems.map(renderItem)}
                </ul>
              ) : (
                <p className={pbq.hint}>{t("pbq.categorization.bucketEmpty")}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
