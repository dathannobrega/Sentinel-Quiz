/** Reader preferences persisted per device (mode, voice, speed, auto-advance, follow, tap to translate). */

export const READING_PREFS_STORAGE_KEY = "sentinel_reading_prefs";

/** Listen (read along), sentence drill, paragraph shadowing. */
export type ReaderMode = "listen" | "drill" | "shadow";

export const READER_MODES: readonly ReaderMode[] = ["listen", "drill", "shadow"];

export interface ReadingPrefs {
  mode: ReaderMode;
  voice: string | null;
  speed: number;
  autoAdvance: boolean;
  follow: boolean;
  /** "Tap to translate": a word click opens the glossary instead of seeking. */
  glossaryTap: boolean;
}

export const DEFAULT_READING_PREFS: ReadingPrefs = {
  mode: "listen",
  voice: null,
  speed: 1,
  autoAdvance: true,
  follow: true,
  glossaryTap: false
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Parses a stored value, ignoring unknown or malformed fields. */
export function parseReadingPrefs(raw: unknown): ReadingPrefs {
  const prefs = { ...DEFAULT_READING_PREFS };
  if (!isRecord(raw)) {
    return prefs;
  }
  if (typeof raw.mode === "string" && (READER_MODES as readonly string[]).includes(raw.mode)) {
    prefs.mode = raw.mode as ReaderMode;
  }
  if (typeof raw.voice === "string" && raw.voice.trim()) {
    prefs.voice = raw.voice;
  }
  if (typeof raw.speed === "number" && Number.isFinite(raw.speed) && raw.speed >= 0.5 && raw.speed <= 1.5) {
    prefs.speed = raw.speed;
  }
  if (typeof raw.autoAdvance === "boolean") {
    prefs.autoAdvance = raw.autoAdvance;
  }
  if (typeof raw.follow === "boolean") {
    prefs.follow = raw.follow;
  }
  if (typeof raw.glossaryTap === "boolean") {
    prefs.glossaryTap = raw.glossaryTap;
  }
  return prefs;
}

export function readReadingPrefs(): ReadingPrefs {
  if (typeof window === "undefined") {
    return { ...DEFAULT_READING_PREFS };
  }
  try {
    const raw = window.localStorage.getItem(READING_PREFS_STORAGE_KEY);
    return raw ? parseReadingPrefs(JSON.parse(raw)) : { ...DEFAULT_READING_PREFS };
  } catch {
    return { ...DEFAULT_READING_PREFS };
  }
}

export function writeReadingPrefs(prefs: ReadingPrefs): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(READING_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best effort (private mode, quota): the session still uses the in-memory value.
  }
}
