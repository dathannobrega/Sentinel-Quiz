/**
 * Legibility limits (PLANO §5 "Regras transversais", contract §3). The warning threshold is about
 * reading on a projector; the hard maximum is also enforced by the backend.
 */
export interface CharLimit {
  /** Above this, show a warning (still saves). null = no warning. */
  warn: number | null;
  /** Above this, the field is blocked (not saved). */
  max: number;
}

export const CHAR_LIMITS = {
  title: { warn: null, max: 120 },
  description: { warn: null, max: 500 },
  prompt: { warn: 120, max: 400 },
  option: { warn: 60, max: 120 },
  acceptedAnswer: { warn: null, max: 60 },
  body: { warn: null, max: 1000 },
  explanation: { warn: null, max: 1000 },
  presenterNotes: { warn: null, max: 1000 }
} as const satisfies Record<string, CharLimit>;

export type CharLimitLevel = "ok" | "warn" | "block";

export interface CharLimitState {
  level: CharLimitLevel;
  length: number;
  max: number;
  warn: number | null;
  /** Characters left before the hard limit (negative when over). */
  remaining: number;
}

/** Length in user-perceived characters (code points), so emoji count once. */
export function charLength(value: string | null | undefined): number {
  return Array.from(value ?? "").length;
}

export function charLimitState(value: string | null | undefined, limit: CharLimit): CharLimitState {
  const length = charLength(value);
  let level: CharLimitLevel = "ok";
  if (length > limit.max) {
    level = "block";
  } else if (limit.warn !== null && length > limit.warn) {
    level = "warn";
  }
  return { level, length, max: limit.max, warn: limit.warn, remaining: limit.max - length };
}

export const TIME_LIMIT = { min: 5, max: 240, presets: [5, 10, 20, 30, 45, 60, 90, 120, 180, 240] } as const;

/** Clamps a typed time limit into [min, max]; null stays null (no timer). */
export function clampTimeLimit(value: number | null, min: number = TIME_LIMIT.min, max: number = TIME_LIMIT.max): number | null {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
