"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { useLqReducedMotion } from "@/components/quiz-kit/motion";
import { LqButton } from "@/features/quiz-live/components/lq-ui";
import { vibrate } from "@/features/quiz-live/components/live-chrome";
import type { LiveAnswerDraft } from "@/features/quiz-live/lib/live-store";
import { moveItem } from "@/features/quiz-live/lib/ordering";
import type { PublicQuestion } from "@/features/quiz-live/lib/protocol";
import { useFlip } from "@/features/quiz-live/lib/use-flip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

type Direction = "up" | "down";

/**
 * Ordering answer (T05). The list starts in the order received (the server's shuffle). Every item
 * has "move up/down" buttons (44 px; WCAG 2.5.7 — dragging is never required) and a polite live
 * region announces the new position. Dragging by the grip is an optional shortcut (pointer/touch).
 * Submits every id in the chosen order as `choice`.
 */
export function OrderingPad({
  question,
  disabled = false,
  onSubmit
}: {
  question: PublicQuestion;
  disabled?: boolean;
  onSubmit: (answer: LiveAnswerDraft) => void;
}) {
  const { t } = useI18n();
  const reduced = useLqReducedMotion();
  const hintId = useId();
  const [order, setOrder] = useState<string[]>(() => [...question.options].sort((a, b) => a.index - b.index).map((option) => option.id));
  const [announcement, setAnnouncement] = useState("");
  const [sent, setSent] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const register = useFlip(order, { disabled: reduced, durationMs: 320 });
  const rows = useRef(new Map<string, HTMLLIElement>());
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const byId = new Map(question.options.map((option) => [option.id, option]));
  const locked = disabled || sent;
  const total = order.length;

  // A move to the first/last slot disables the button just pressed: keep focus on the item.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) {
      return;
    }
    pendingFocus.current = null;
    const button = buttons.current.get(key);
    if (button && !button.disabled) {
      button.focus();
      return;
    }
    const [id, direction] = key.split(":");
    buttons.current.get(`${id}:${direction === "up" ? "down" : "up"}`)?.focus();
  }, [order]);

  function announce(id: string, next: string[]) {
    const option = byId.get(id);
    if (option) {
      setAnnouncement(t("quizPlay.ordering.moved", { text: option.text, position: next.indexOf(id) + 1, total }));
    }
  }

  function move(id: string, direction: Direction) {
    if (locked) {
      return;
    }
    const from = order.indexOf(id);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= total) {
      return;
    }
    const next = moveItem(order, from, to);
    vibrate(8);
    pendingFocus.current = `${id}:${direction}`;
    setOrder(next);
    announce(id, next);
  }

  function onGripDown(event: ReactPointerEvent<HTMLSpanElement>, id: string) {
    if (locked) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(id);
    vibrate(8);
  }

  function onGripMove(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!dragging || locked) {
      return;
    }
    // Target slot = how many other rows have their middle above the pointer.
    let target = 0;
    for (const id of order) {
      const row = rows.current.get(id);
      if (id === dragging || !row) {
        continue;
      }
      const rect = row.getBoundingClientRect();
      if (event.clientY > rect.top + rect.height / 2) {
        target += 1;
      }
    }
    const from = order.indexOf(dragging);
    if (target !== from) {
      setOrder(moveItem(order, from, target));
    }
  }

  function onGripUp() {
    if (dragging) {
      announce(dragging, order);
    }
    setDragging(null);
  }

  function submit() {
    if (locked) {
      return;
    }
    vibrate(15);
    setSent(true);
    onSubmit({ choice: order });
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p id={hintId} className="text-center text-sm font-semibold text-lq-fg-muted">
        {t("quizPlay.ordering.hint")}
      </p>
      <ol aria-describedby={hintId} className="flex flex-col gap-2">
        {order.map((id, position) => {
          const option = byId.get(id);
          if (!option) {
            return null;
          }
          return (
            <li
              key={id}
              ref={(node) => {
                register(id)(node);
                if (node) {
                  rows.current.set(id, node);
                } else {
                  rows.current.delete(id);
                }
              }}
              className={cn(
                // The item keeps its answer colour (left edge) wherever it moves; the number is the slot.
                "relative flex items-center gap-2 rounded-[calc(var(--lq-radius)*0.7)] border-[length:max(1.5px,var(--lq-border-w))] border-l-[6px] border-lq-line border-l-[var(--lq-tile)] bg-lq-surface p-1.5 pl-1",
                `lq-slot-${option.index % 6}`,
                dragging === id && "z-10 border-lq-accent shadow-[0_18px_40px_-18px_rgb(0_0_0/0.8)]"
              )}
            >
              <span
                aria-hidden="true"
                onPointerDown={(event) => onGripDown(event, id)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
                className={cn("grid h-11 w-6 shrink-0 touch-none place-items-center text-lq-fg-muted", locked ? "cursor-default" : "cursor-grab active:cursor-grabbing")}
              >
                <svg viewBox="0 0 8 16" className="h-4 w-2" fill="currentColor">
                  {[2, 6, 10, 14].flatMap((y) => [<circle key={`a${y}`} cx="2" cy={y} r="1.2" />, <circle key={`b${y}`} cx="6" cy={y} r="1.2" />])}
                </svg>
              </span>
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lq-surface-2 font-lq-mono text-sm font-bold text-lq-fg tabular-nums">{position + 1}</span>
              <span className="min-w-0 flex-1 font-lq leading-snug font-bold break-words text-lq-fg">{option.text}</span>
              <span className="flex shrink-0 gap-1">
                {(["up", "down"] as const).map((direction) => {
                  const edge = direction === "up" ? position === 0 : position === total - 1;
                  return (
                    <button
                      key={direction}
                      type="button"
                      ref={(node) => {
                        if (node) {
                          buttons.current.set(`${id}:${direction}`, node);
                        } else {
                          buttons.current.delete(`${id}:${direction}`);
                        }
                      }}
                      onClick={() => move(id, direction)}
                      disabled={locked || edge}
                      aria-label={t(direction === "up" ? "quizPlay.ordering.moveUp" : "quizPlay.ordering.moveDown", { text: option.text, position: position + 1 })}
                      className="focus-ring grid size-11 place-items-center rounded-[calc(var(--lq-radius)*0.5)] bg-lq-surface-2 text-lq-fg transition-transform active:scale-95 disabled:opacity-35"
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4", direction === "down" && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 10l4.5-4.5 4.5 4.5" />
                      </svg>
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <LqButton size="lg" onClick={submit} disabled={locked}>
        {t("quizPlay.ordering.submit")}
      </LqButton>
    </div>
  );
}
