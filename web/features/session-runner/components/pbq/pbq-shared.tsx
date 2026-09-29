"use client";

import type { ReactNode } from "react";

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

/** Single source of PBQ presentation: every task renderer composes these. */
export const pbqStyles = {
  root: "flex flex-col gap-7",
  head: "flex flex-wrap items-start justify-between gap-3",
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
  task: "flex flex-col gap-4 border-t border-line pt-6",
  taskCorrect: "",
  taskWrong: "",
  taskHead: "flex flex-wrap items-center justify-between gap-2",
  taskHeading: "text-[0.9375rem] font-semibold text-fg",
  taskPrompt: "font-serif text-[1.0625rem] leading-[1.65] text-fg",
  taskBody: "flex flex-col gap-3",
  itemList: "flex flex-col gap-2",
  card: "flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-center",
  cardText: "min-w-0 flex-1 text-[0.9375rem] leading-relaxed text-fg",
  cardSelect: "sm:w-56",
  draggable: "cursor-grab active:cursor-grabbing",
  dropTarget: "border-primary bg-primary-soft",
  bucketGrid: "grid gap-3 sm:grid-cols-2",
  bucket: "flex min-h-28 flex-col gap-3 rounded-lg border border-dashed border-line-strong p-3 transition-colors",
  bucketPool: "bg-surface-muted",
  bucketHead: "flex items-center justify-between gap-2",
  bucketTitle: "text-sm font-semibold text-fg",
  order: "flex flex-col gap-2",
  orderItem: "flex items-start gap-3 rounded-lg border border-line bg-surface p-3 transition-colors",
  orderPosition: "nums grid size-7 shrink-0 place-items-center rounded-full bg-surface-muted font-mono text-xs font-medium text-fg-muted",
  orderText: "flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5 text-[0.9375rem] leading-relaxed text-fg",
  orderControls: "flex shrink-0 gap-1",
  solution: "flex flex-col gap-2 rounded-md bg-success-soft p-4",
  solutionList: "list-decimal pl-5 text-sm leading-relaxed text-fg",
  fieldset: "flex min-w-0 flex-col gap-3 border-0 p-0",
  lines: "flex flex-col gap-1 overflow-x-auto",
  linesMono: "font-mono text-[0.8125rem]",
  line: "flex flex-wrap items-start gap-3 rounded-md border border-transparent px-3 py-2 transition-colors hover:bg-surface-muted",
  lineSelected: "border-primary bg-primary-soft hover:bg-primary-soft",
  lineInput: "mt-1 size-4 shrink-0 accent-primary",
  lineText: "min-w-0 flex-1 cursor-pointer leading-relaxed [overflow-wrap:anywhere] text-fg",
  explanation: "flex flex-col gap-1.5 border-l-[3px] border-line-strong py-1 pl-4",
  explanationText: "font-serif text-[0.9375rem] leading-relaxed text-fg"
} as const;

/** Correct / incorrect mark: glyph + text (never color only). */
export function PbqMark({ ok, children }: { ok: boolean; children?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[0.8125rem] font-semibold", ok ? "text-success" : "text-danger")}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span> {children}
    </span>
  );
}

export function PbqItemExplanation({ text }: { text?: string }) {
  return text ? <p className="w-full text-[0.8125rem] leading-snug text-fg-muted">{text}</p> : null;
}
