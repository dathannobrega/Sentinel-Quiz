/** Shared visual treatment of assessed words (result, drill marks, word review). Never color alone. */

import type { ReadingPhonemeQuality, ReadingWordReason, ReadingWordStatus } from "@/types/api";

export const STATUS_LABEL_KEY: Record<ReadingWordStatus, string> = {
  ok: "reading.result.statusOk",
  weak: "reading.result.statusWeak",
  mispronounced: "reading.result.statusMispronounced",
  missed: "reading.result.statusMissed"
};

/** Underline style, strikethrough and color together (plus an icon where space allows). */
export const STATUS_CLASS: Record<ReadingWordStatus, string> = {
  ok: "",
  weak: "underline decoration-warning decoration-dotted decoration-2 underline-offset-4",
  mispronounced: "text-danger underline decoration-danger decoration-2 underline-offset-4",
  missed: "text-fg-muted line-through decoration-fg-muted"
};

export const REASON_LABEL_KEY: Record<ReadingWordReason, string> = {
  phoneme: "reading.result.reasons.phoneme",
  substitution: "reading.result.reasons.substitution",
  ending: "reading.result.reasons.ending",
  low_confidence: "reading.result.reasons.low_confidence"
};

export const PHONEME_QUALITY_KEY: Record<ReadingPhonemeQuality, string> = {
  good: "reading.result.phonemeQuality.good",
  fair: "reading.result.phonemeQuality.fair",
  bad: "reading.result.phonemeQuality.bad"
};

export const PHONEME_QUALITY_CLASS: Record<ReadingPhonemeQuality, string> = {
  good: "border-success/40 bg-success-soft text-success",
  fair: "border-warning/40 bg-warning-soft text-warning",
  bad: "border-danger/40 bg-danger-soft text-danger"
};

export function reasonLabelKey(reason: string | null | undefined): string | null {
  return reason && reason in REASON_LABEL_KEY ? REASON_LABEL_KEY[reason as ReadingWordReason] : null;
}
