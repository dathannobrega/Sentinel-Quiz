/**
 * Publish-time content moderation (RF-1112, CONTRATO-INCREMENTO-4.md §2): how the editor names
 * the field of a filter finding. The backend reports `prompt`, `explanation`, `body`,
 * `option_{i}` and `accepted_{i}` (0-based `i`).
 */
import type { LiveModerationFinding } from "@/types/api/live";

export type FindingFieldKind = "prompt" | "explanation" | "body" | "option" | "accepted" | "other";

export interface FindingField {
  kind: FindingFieldKind;
  /** 1-based number for options and accepted answers. */
  n: number | null;
}

export function describeFindingField(field: string): FindingField {
  if (field === "prompt" || field === "explanation" || field === "body") {
    return { kind: field, n: null };
  }
  const match = /^(option|accepted)_(\d+)$/.exec(field);
  if (match) {
    return { kind: match[1] as "option" | "accepted", n: Number(match[2]) + 1 };
  }
  return { kind: "other", n: null };
}

/** Findings ordered by item position (quiz-level first), capped for display. */
export function visibleFindings(findings: LiveModerationFinding[], limit = 8): { shown: LiveModerationFinding[]; hidden: number } {
  const sorted = [...findings].sort((a, b) => (a.position ?? -1) - (b.position ?? -1));
  return { shown: sorted.slice(0, limit), hidden: Math.max(0, sorted.length - limit) };
}

/** Whether a publish result needs the "awaiting moderation" warning. */
export function isFlagged(moderation: { state: string } | null | undefined): boolean {
  return moderation?.state === "flagged";
}
