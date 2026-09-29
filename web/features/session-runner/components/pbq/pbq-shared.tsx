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

/** Correct / incorrect mark: glyph + text (never color only). */
export function PbqMark({ ok, children }: { ok: boolean; children?: ReactNode }) {
  return (
    <span className={cn("sq-pbq-mark", ok ? "sq-pbq-mark--ok" : "sq-pbq-mark--bad")}>
      <span aria-hidden="true">{ok ? "✓" : "✗"}</span> {children}
    </span>
  );
}

export function PbqItemExplanation({ text }: { text?: string }) {
  return text ? <p className="sq-pbq-item-note">{text}</p> : null;
}
