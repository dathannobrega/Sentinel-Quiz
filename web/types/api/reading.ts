/** Sentinel Reader (`/api/reading`): library, read-along TTS, shadowing assessment, progress. */

import type { StudySectionDetail } from "./study";

export type ReadingMode = "listen" | "read" | "shadow";

/** Why TTS or assessment is off: service down, models loading, or disabled on the service. */
export type ReadingUnavailableReason = "speech_unavailable" | "speech_warming" | "disabled" | (string & {});

export interface ReadingVoice {
  id: string;
  label: string;
  lang: string;
  gender: string;
}

export interface ReadingTtsCapability {
  available: boolean;
  reason: ReadingUnavailableReason | null;
  engine: string | null;
  model: string | null;
  default_voice: string | null;
  voices: ReadingVoice[];
  speeds: number[];
}

export interface ReadingAssessCapability {
  available: boolean;
  reason: ReadingUnavailableReason | null;
  engine: string | null;
  model: string | null;
  max_audio_bytes: number;
  max_seconds: number;
}

export interface ReadingQuota {
  daily_limit: number;
  used_today: number;
  remaining: number;
}

/** GET /api/reading/capabilities. With `enabled: false` the other fields may be absent. */
export interface ReadingCapabilities {
  enabled: boolean;
  books_available?: boolean;
  tts?: ReadingTtsCapability;
  assess?: ReadingAssessCapability;
  quota?: ReadingQuota;
}

export interface ReadingChapterSummary {
  file: string;
  index: number;
  title: string;
  sections: number;
  words: number;
  minutes: number;
}

/** One row of reading_progress (one per user and book). */
export interface ReadingProgress {
  book_slug?: string;
  section_id: string;
  section_title?: string | null;
  part_id: string;
  block_index: number;
  /** Position of the current section in the book's reading order, 0-100. */
  percent: number;
  mode: ReadingMode;
  words_read: number;
  seconds_listened: number;
  updated_at: string;
}

export interface ReadingBook {
  slug: string;
  title: string;
  certification: string | null;
  words: number;
  minutes: number;
  sections: number;
  chapters: ReadingChapterSummary[];
  progress: ReadingProgress | null;
}

/** GET /api/reading/library */
export interface ReadingLibrary {
  books: ReadingBook[];
}

export interface ReadingChapterSection {
  id: string;
  title: string;
  level: number;
  kind: string;
  words: number;
  minutes: number;
  parent_id: string | null;
  completed: boolean;
}

/** GET /api/reading/books/{slug}/chapters/{file} */
export interface ReadingChapterDetail {
  book: { slug: string; title: string; certification: string | null };
  chapter: { file: string; index: number; title: string; words: number; minutes: number };
  sections: ReadingChapterSection[];
}

export interface ReadingSectionPosition {
  index: number;
  total: number;
}

export interface ReadingSectionProgress {
  part_id: string;
  block_index: number;
  mode: ReadingMode;
  updated_at: string;
}

/** GET /api/reading/sections/{id}: a StudySectionDetail plus its place in the book. */
export interface ReadingSectionDetail extends StudySectionDetail {
  book_slug: string;
  chapter_file: string;
  chapter_index: number;
  position: ReadingSectionPosition;
  progress: ReadingSectionProgress | null;
}

/** POST /api/reading/sections/{id}/tts body. */
export interface ReadingTtsRequest {
  part_id: string;
  block_index: number;
  voice?: string;
  speed?: number;
}

export interface ReadingTtsWord {
  text: string;
  start: number;
  end: number;
  /** Offsets into `ReadingTtsResponse.text` (the block text). */
  char_start: number;
  char_end: number;
}

export interface ReadingTtsResponse {
  audio_id: string;
  audio_url: string;
  content_type: string;
  duration_seconds: number;
  voice: string;
  speed: number;
  engine: string;
  cached: boolean;
  text: string;
  words: ReadingTtsWord[];
}

export type ReadingWordStatus = "ok" | "weak" | "mispronounced" | "missed";

export interface ReadingAssessedWord {
  index: number;
  text: string;
  char_start: number;
  char_end: number;
  status: ReadingWordStatus;
  heard: string | null;
  confidence: number | null;
  start: number | null;
  end: number | null;
  expected_ipa: string | null;
  heard_ipa: string | null;
}

/** A spoken word that is not in the text, anchored after `after_index` (-1 = before the first). */
export interface ReadingExtraWord {
  text: string;
  after_index: number;
  start: number | null;
  end: number | null;
}

export interface ReadingScores {
  accuracy: number;
  completeness: number;
  fluency: number;
  overall: number;
}

export interface ReadingMetrics {
  reference_words: number;
  ok: number;
  weak: number;
  mispronounced: number;
  missed: number;
  extra: number;
  wpm: number | null;
  long_pauses: number;
  target_wpm: [number, number];
}

export interface ReadingTip {
  code: string;
  expected?: string | null;
  heard?: string | null;
  examples?: string[];
}

/** POST /api/reading/sections/{id}/assess */
export interface ReadingAssessment {
  attempt_id: string;
  created_at: string;
  engine: string;
  model: string;
  duration_seconds: number;
  speech_seconds: number;
  transcript: string;
  text: string;
  words: ReadingAssessedWord[];
  extras: ReadingExtraWord[];
  scores: ReadingScores;
  metrics: ReadingMetrics;
  tips: ReadingTip[];
  best_overall: number | null;
  attempts_for_block: number;
}

/** GET /api/reading/sections/{id}/attempts */
export interface ReadingAttemptSummary {
  id: string;
  part_id: string;
  block_index: number;
  overall: number;
  accuracy: number;
  completeness: number;
  fluency: number;
  wpm: number | null;
  created_at: string;
}

export interface ReadingAttemptList {
  attempts: ReadingAttemptSummary[];
}

export interface ReadingStatsDay {
  date: string;
  attempts: number;
  avg_overall: number | null;
}

/** GET /api/reading/stats */
export interface ReadingStats {
  attempts: number;
  avg_overall: number | null;
  best_overall: number | null;
  words_read: number;
  seconds_listened: number;
  active_days_30: number;
  recent: ReadingStatsDay[];
}

/** PUT /api/reading/progress body. `words_read` and `seconds_listened` are increments. */
export interface ReadingProgressUpdate {
  book_slug: string;
  section_id: string;
  part_id: string;
  block_index: number;
  mode: ReadingMode;
  words_read: number;
  seconds_listened: number;
}

/** GET /api/reading/progress */
export interface ReadingProgressList {
  items: ReadingProgress[];
}
