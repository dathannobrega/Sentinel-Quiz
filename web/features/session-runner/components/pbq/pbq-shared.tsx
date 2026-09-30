"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";

import { CheckIcon, XIcon } from "@/components/ui/icons";
import type { NormalizedSolution } from "@/features/session-runner/lib/pbq-utils";
import type { Translate } from "@/features/session-runner/lib/runner-utils";
import { cn } from "@/lib/utils/cn";
import type { PbqTask } from "@/types/api";

/** Common props of every PBQ task renderer. */
export interface PbqTaskProps<TTask extends PbqTask, TValue> {
  task: TTask;
  value: TValue;
  /** New value plus an optional sentence for the aria-live region. */
  onChange: (value: TValue, announcement?: string) => void;
  disabled: boolean;
  /** Normalized solution: when set, the answer-key overlay is rendered. */
  solution: NormalizedSolution | null;
  /** Per-item explanations (shown with the overlay). */
  perItem: Record<string, string>;
  /** Ids labelling the task (heading + prompt). */
  labelledBy: string;
  t: Translate;
}

/**
 * Single source of PBQ presentation: every task renderer composes these.
 *
 * Item cards lay out against their OWN width (`@container`), never the viewport: a card inside a
 * half-width bucket stacks text over its control, a full-width card puts them side by side. A
 * viewport breakpoint here squeezed the text to one word per line inside narrow buckets.
 *
 * `cn` only joins strings (no class merging), so a base class never carries a property that a state
 * changes: colors live in `*Tone` maps and exactly one tone is applied (see `cardTone`).
 */
export const pbqStyles = {
  root: "flex flex-col gap-7",
  head: "flex flex-col gap-3",
  headRow: "flex flex-wrap items-start justify-between gap-3",
  title: "flex flex-wrap items-center gap-2 text-lg font-semibold leading-snug text-fg",
  badge: "inline-flex h-6 items-center rounded-sm bg-primary-soft px-2 font-mono text-xs font-medium text-primary",
  counter: "nums shrink-0 text-[0.8125rem] text-fg-muted",
  label: "text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase",
  scenario: "flex flex-col gap-2",
  scenarioText: "font-serif text-[1.0625rem] leading-[1.7] whitespace-pre-line text-fg",
  exhibitsPanel: "flex flex-col gap-3",
  exhibits: "grid gap-3",
  exhibit: "flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-4",
  exhibitTitle: "text-sm font-semibold text-fg",
  exhibitText: "text-sm leading-relaxed whitespace-pre-line text-fg",
  log: "flex list-decimal flex-col gap-0.5 overflow-x-auto rounded-md bg-surface-muted py-3 pr-3 pl-10 font-mono text-[0.8125rem] leading-relaxed text-fg marker:text-fg-subtle",
  tableWrap: "overflow-x-auto rounded-md border border-line",
  table: "w-full border-collapse text-left text-sm [&_td]:border-t [&_td]:border-line [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-surface-muted [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-fg-muted",
  hint: "text-[0.8125rem] leading-snug text-fg-muted",

  // Task shell: a raised panel with a numbered step marker that turns into a check when complete.
  task: "flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 shadow-raised sm:p-5 animate-[rise-in_200ms_var(--ease-out)]",
  taskHead: "flex flex-wrap items-center justify-between gap-2",
  taskHeading: "flex items-center gap-2.5 text-[0.9375rem] font-semibold text-fg",
  taskStep: "nums grid size-7 shrink-0 place-items-center rounded-full border font-mono text-xs font-medium transition-colors duration-200",
  taskStepTone: {
    pending: "border-line-strong bg-surface-muted text-fg-muted",
    done: "border-success bg-success text-on-primary [&_svg]:animate-[pop-in_260ms_var(--ease-out)]"
  },
  taskPrompt: "font-serif text-[1.0625rem] leading-[1.65] text-fg",
  taskBody: "flex flex-col gap-3",

  // Progress: thin track + fill, and a segmented variant (one segment per task).
  progress: "flex flex-col gap-1.5",
  progressRow: "flex items-center justify-between gap-2",
  progressTrack: "h-1.5 overflow-hidden rounded-full bg-surface-muted",
  progressFill: "h-full rounded-full transition-[width,background-color] duration-300 ease-out",
  progressTone: { pending: "bg-primary", done: "bg-success" },
  segments: "flex gap-1.5",
  segment: "h-1.5 flex-1 rounded-full transition-colors duration-300 ease-out",
  segmentTone: { pending: "bg-surface-muted", done: "bg-success" },

  // Item cards (categorization, matching, ordering). Pick the tone with `cardTone`.
  itemList: "flex flex-col gap-2",
  card: "@container group/card relative rounded-lg border p-3 transition-[border-color,background-color,box-shadow] duration-200 ease-out",
  cardTone: {
    idle: "border-line bg-surface shadow-raised",
    interactive: "border-line bg-surface shadow-raised hover:border-line-strong",
    filled: "border-primary/40 bg-surface shadow-raised hover:border-primary/70",
    dragging: "border-dashed border-primary bg-primary-soft",
    target: "border-primary bg-primary-soft ring-4 ring-primary/15",
    correct: "border-success/50 bg-success-soft",
    wrong: "border-danger/50 bg-danger-soft"
  },
  cardBody: "flex flex-col gap-2.5",
  cardRow: "flex flex-col gap-2.5 @md:flex-row @md:items-center @md:gap-3",
  cardLead: "flex min-w-0 flex-1 items-start gap-2",
  cardText: "min-w-0 flex-1 text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere] text-fg",
  cardSelect: "@md:w-56 @md:shrink-0",
  grip: "shrink-0 text-fg-subtle transition-colors group-hover/card:text-fg-muted",
  draggable: "cursor-grab active:cursor-grabbing",
  arrow: "hidden shrink-0 text-fg-subtle @md:block",

  // Buckets (categorization drop zones).
  bucketGrid: "grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]",
  bucket: "flex flex-col gap-3 rounded-lg border-2 p-3 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out",
  bucketTone: {
    idle: "min-h-36 border-dashed border-line bg-surface-muted",
    armed: "min-h-36 border-dashed border-primary/45 bg-surface-muted",
    target: "min-h-36 scale-[1.01] border-dashed border-primary bg-primary-soft ring-4 ring-primary/15",
    done: "border-solid border-success/40 bg-success-soft"
  },
  bucketHead: "flex items-center justify-between gap-2 px-1",
  bucketTitle: "flex min-w-0 items-center gap-2 text-sm font-semibold text-fg",
  bucketDot: "size-2 shrink-0 rounded-full transition-colors duration-200",
  bucketDotTone: { empty: "bg-line-strong", filled: "bg-primary" },
  pill:
    "nums inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-surface px-2 text-xs font-semibold text-fg-muted ring-1 ring-line " +
    "animate-[pop-in_260ms_var(--ease-out)]",
  bucketEmpty: "grid flex-1 place-items-center rounded-md px-3 py-5 text-center text-[0.8125rem] transition-colors duration-200",
  bucketEmptyTone: { idle: "text-fg-subtle", target: "text-primary" },

  // Ordering.
  order: "flex flex-col gap-2",
  orderItem: "@container group/card relative flex items-center gap-3 rounded-lg border p-3 transition-[border-color,background-color,box-shadow] duration-200 ease-out",
  orderPosition: "nums grid size-8 shrink-0 place-items-center rounded-full font-mono text-[0.8125rem] font-semibold",
  orderPositionTone: {
    pending: "bg-primary-soft text-primary",
    correct: "bg-success-soft text-success",
    wrong: "bg-danger-soft text-danger"
  },
  orderText: "flex min-w-0 flex-1 flex-col gap-1.5 text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere] text-fg",
  orderControls: "flex shrink-0 flex-col gap-1",
  orderButton:
    "focus-ring inline-grid size-8 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg " +
    "disabled:cursor-not-allowed disabled:text-line-strong disabled:hover:bg-transparent",
  solution: "flex flex-col gap-2 rounded-md bg-success-soft p-4",
  solutionList: "list-decimal pl-5 text-sm leading-relaxed text-fg",

  // Select in exhibit.
  fieldset: "flex min-w-0 flex-col gap-3 border-0 p-0",
  lines: "flex flex-col gap-1 overflow-x-auto",
  linesMono: "font-mono text-[0.8125rem]",
  line: "flex flex-wrap items-start gap-3 rounded-md border px-3 py-2 transition-[background-color,border-color,box-shadow] duration-150 ease-out",
  lineTone: {
    idle: "border-transparent hover:bg-surface-muted",
    selected: "border-primary/50 bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]"
  },
  lineInput: "mt-1 size-4 shrink-0 accent-primary",
  lineText: "min-w-0 flex-1 cursor-pointer leading-relaxed [overflow-wrap:anywhere] text-fg",

  explanation: "flex flex-col gap-1.5 border-l-[3px] border-line-strong py-1 pl-4",
  explanationText: "font-serif text-[0.9375rem] leading-relaxed text-fg"
} as const;

export type PbqCardTone = keyof typeof pbqStyles.cardTone;

/**
 * The one tone an item card shows, by precedence: graded verdict > being dragged > drop target >
 * answered > idle. Read-only cards without a verdict stay idle (no hover affordance).
 */
export function cardTone({
  disabled,
  verdict,
  dragging = false,
  target = false,
  filled = false
}: {
  disabled: boolean;
  verdict?: boolean | null;
  dragging?: boolean;
  target?: boolean;
  filled?: boolean;
}): string {
  let tone: PbqCardTone;
  if (verdict === true || verdict === false) {
    tone = verdict ? "correct" : "wrong";
  } else if (dragging) {
    tone = "dragging";
  } else if (target) {
    tone = "target";
  } else if (filled) {
    tone = "filled";
  } else {
    tone = disabled ? "idle" : "interactive";
  }
  return pbqStyles.cardTone[tone];
}

/** Correct / incorrect mark: glyph + text (never color only). */
export function PbqMark({ ok, children }: { ok: boolean; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.8125rem] font-semibold animate-[rise-in_200ms_var(--ease-out)]",
        ok ? "text-success" : "text-danger"
      )}
    >
      {ok ? <CheckIcon size={14} /> : <XIcon size={14} />} {children}
    </span>
  );
}

export function PbqItemExplanation({ text }: { text?: string }) {
  return text ? <p className="w-full text-[0.8125rem] leading-snug text-fg-muted">{text}</p> : null;
}

/** Labelled progress bar ("3 of 5 items placed"). The text carries the value; the bar is decorative. */
export function PbqProgress({ done, total, label }: { done: number; total: number; label: string }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={pbqStyles.progress}>
      <div className={pbqStyles.progressRow}>
        <span className={pbqStyles.counter}>{label}</span>
        <span className={cn(pbqStyles.counter, "font-mono")} aria-hidden="true">
          {percent}%
        </span>
      </div>
      <div className={pbqStyles.progressTrack} aria-hidden="true">
        <div
          className={cn(pbqStyles.progressFill, pbqStyles.progressTone[done >= total && total > 0 ? "done" : "pending"])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

type Box = { x: number; y: number };

/**
 * FLIP animation for lists whose items move (reorder, or jump between buckets). Call `capture()`
 * right before committing a move; after the re-render every registered node that changed place
 * glides from its old position. Nodes are keyed by item id, so an item that remounts in another
 * list still animates. No-op without the Web Animations API (tests) or with reduced motion.
 */
export function useFlip<T extends HTMLElement = HTMLElement>(trigger: unknown) {
  const nodes = useRef(new Map<string, T>());
  const before = useRef<Map<string, Box> | null>(null);

  const register = useCallback(
    (id: string) => (node: T | null) => {
      if (node) {
        nodes.current.set(id, node);
      } else {
        nodes.current.delete(id);
      }
    },
    []
  );

  const capture = useCallback(() => {
    const snapshot = new Map<string, Box>();
    nodes.current.forEach((node, id) => {
      const box = node.getBoundingClientRect();
      snapshot.set(id, { x: box.left, y: box.top });
    });
    before.current = snapshot;
  }, []);

  useLayoutEffect(() => {
    const snapshot = before.current;
    before.current = null;
    if (!snapshot || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    nodes.current.forEach((node, id) => {
      const prev = snapshot.get(id);
      if (!prev || typeof node.animate !== "function") {
        return;
      }
      const box = node.getBoundingClientRect();
      const dx = prev.x - box.left;
      const dy = prev.y - box.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return;
      }
      node.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(1.02)`, zIndex: 10 },
          { transform: "translate(0, 0) scale(1)", zIndex: 10 }
        ],
        { duration: 340, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    });
  }, [trigger]);

  return { register, capture };
}
