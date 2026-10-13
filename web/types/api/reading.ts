/** Sentinel Reader (`/api/reading`): library, read-along TTS, shadowing assessment, progress. */

import type { StudySectionBlock, StudySectionDetail, StudySectionPart } from "./study";

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
  /** Increment 3: `GET …/tts/stream` (one sentence at a time) is available. */
  streaming?: boolean;
}

/** Increment 3: server-side warm-up of the next blocks (`POST …/warm`). */
export interface ReadingWarmCapability {
  enabled: boolean;
  blocks_ahead: number;
}

/** Detected language of a book (stopword ratio); neural voice and assessment only for `en`. */
export type ReadingLanguage = "en" | "pt" | "es" | "unknown";

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

/** AI-backed features (glossary, comprehension): off without a configured provider. */
export interface ReadingAiCapability {
  available: boolean;
  reason: string | null;
  provider: string | null;
}

/** GET /api/reading/capabilities. With `enabled: false` the other fields may be absent. */
/** Why phoneme-level scoring is off (capabilities.phonemes.reason). */
export type ReadingPhonemesReason = "warming" | "failed" | "disabled" | "speech_unavailable";

export interface ReadingCapabilities {
  enabled: boolean;
  books_available?: boolean;
  tts?: ReadingTtsCapability;
  assess?: ReadingAssessCapability;
  quota?: ReadingQuota;
  /** Increment 2. */
  ai?: ReadingAiCapability;
  phonemes?: { available: boolean; reason?: ReadingPhonemesReason | null };
  words?: { due: number };
  offline?: { max_chapters: number };
  /** Increment 3. */
  warm?: ReadingWarmCapability;
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
  /** Increment 3 (absent on older APIs = English). */
  language?: ReadingLanguage;
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

/** One sentence of a block: offsets into the block `text` (same splitter as the corpus). */
export interface ReadingSentence {
  index: number;
  char_start: number;
  char_end: number;
}

export interface ReadingSectionBlock extends StudySectionBlock {
  /** Increment 2 (drill). Absent on older APIs. */
  sentences?: ReadingSentence[];
}

export interface ReadingSectionPart extends Omit<StudySectionPart, "blocks"> {
  blocks: ReadingSectionBlock[];
}

/** GET /api/reading/sections/{id}: a StudySectionDetail plus its place in the book. */
export interface ReadingSectionDetail extends Omit<StudySectionDetail, "parts"> {
  parts: ReadingSectionPart[];
  book_slug: string;
  chapter_file: string;
  chapter_index: number;
  position: ReadingSectionPosition;
  progress: ReadingSectionProgress | null;
  /** Increment 3 (absent on older APIs = English). */
  language?: ReadingLanguage;
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

/* ------------------------------------------------------------------ Increment 3: streamed TTS */

/** First NDJSON line of `GET …/tts/stream`: the block text and the synthesis settings. */
export interface ReadingStreamMeta {
  type: "meta";
  block_audio_id: string;
  sentences: number;
  engine: string;
  model: string;
  voice: string;
  speed: number;
  lang: string;
  content_type: string;
  /** Block text (word offsets of every segment point into it). */
  text: string;
}

/** One sentence of the block, ready to download. `words` carry block offsets and segment-relative times. */
export interface ReadingStreamSegment {
  type: "segment";
  index: number;
  audio_id: string;
  audio_url: string;
  char_start: number;
  char_end: number;
  duration_seconds: number;
  cached: boolean;
  words: ReadingTtsWord[];
}

export interface ReadingStreamDone {
  type: "done";
  duration_seconds: number;
}

/** Failure after the first line (the HTTP status was already 200). */
export interface ReadingStreamError {
  type: "error";
  code: string;
  message: string;
}

export type ReadingStreamLine = ReadingStreamMeta | ReadingStreamSegment | ReadingStreamDone | ReadingStreamError;

/** POST /api/reading/sections/{id}/warm body. */
export interface ReadingWarmRequest {
  part_id: string;
  block_index: number;
  voice?: string;
  speed?: number;
}

/** 202 from POST …/warm. */
export interface ReadingWarmResponse {
  queued: number;
  skipped: number;
  enabled?: boolean;
}

export type ReadingWordStatus = "ok" | "weak" | "mispronounced" | "missed";

/** Why a word is not `ok`: `substitution`/`phoneme` (mispronounced), `ending`/`low_confidence` (weak). */
export type ReadingWordReason = "substitution" | "phoneme" | "ending" | "low_confidence";

export type ReadingPhonemeQuality = "good" | "fair" | "bad";

/** One expected phoneme of a word scored by the phoneme engine (GOP). */
export interface ReadingPhoneme {
  ipa: string;
  /** (0, 1] */
  score: number;
  /** Most likely phoneme heard in that stretch (null when nothing was heard). */
  heard: string | null;
  quality: ReadingPhonemeQuality;
}

/** `unexpected`: a pause before this word mid-phrase; `missing`: no pause after this sentence end. */
export type ReadingWordBreak = "unexpected" | "missing";

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
  /** Increment 2 fields (absent on older attempts). */
  reason?: ReadingWordReason | null;
  phoneme_score?: number | null;
  phonemes?: ReadingPhoneme[] | null;
  break?: ReadingWordBreak | null;
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
  /** Null when the recording had fewer than 3 heard words; absent before Increment 2. */
  prosody?: number | null;
  overall: number;
}

export interface ReadingProsody {
  score: number | null;
  pitch_range_semitones: number | null;
  monotone: boolean;
  unexpected_breaks: number;
  missing_breaks: number;
}

/** Engines used by the assessment; `phoneme` is null while the phoneme model is off or warming. */
export interface ReadingAssessEngines {
  asr: string | null;
  phoneme: string | null;
}

/** Spaced-repetition side effects of one assessment. */
export interface ReadingDeckDelta {
  added: number;
  reviewed: number;
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
  /** Increment 2. */
  prosody?: ReadingProsody | null;
  engines?: ReadingAssessEngines | null;
  deck?: ReadingDeckDelta | null;
  /** Drill: the assessed sentence and its start in the block (word offsets are sentence-relative). */
  sentence_index?: number | null;
  char_offset?: number | null;
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
  sentence_index?: number | null;
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
  /** Increment 2. */
  words?: { total: number; due: number; learned: number };
  quiz?: { answered: number; correct: number };
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

/* ------------------------------------------------------------------ Increment 2 */

export type ReadingCardKind = "pronunciation" | "vocabulary";
export type ReadingCardSource = "assessment" | "glossary" | "manual";
export type ReadingGrade = "again" | "hard" | "good" | "easy";

/** A word in the spaced-repetition deck (scheduling happens on the server). */
export interface ReadingWordCard {
  id: string;
  word: string;
  kind: ReadingCardKind;
  ipa: string | null;
  meaning_pt: string | null;
  context: string | null;
  section_id: string | null;
  source: ReadingCardSource;
  reps: number;
  lapses: number;
  ease: number;
  interval_days: number;
  due_at: string;
  last_score: number | null;
  last_reviewed_at: string | null;
  created_at: string;
}

/** GET /api/reading/words */
export interface ReadingWordList {
  items: ReadingWordCard[];
  total: number;
  due: number;
}

/** GET /api/reading/words/summary */
export interface ReadingWordSummary {
  total: number;
  due: number;
  learned: number;
  by_kind: Partial<Record<ReadingCardKind, number>>;
}

/** A word inside a block, by character offsets (the server reads the text from the corpus). */
export interface ReadingWordRef {
  section_id: string;
  part_id: string;
  block_index: number;
  char_start: number;
  char_end: number;
}

/** POST /api/reading/words */
export interface ReadingAddWordRequest extends ReadingWordRef {
  kind: ReadingCardKind;
}

/** POST /api/reading/words/{id}/review */
export interface ReadingWordReview {
  assessment: ReadingAssessment;
  grade: ReadingGrade;
  card: ReadingWordCard;
}

export type ReadingGlossarySource = "ai" | "cache" | "none";

/** POST /api/reading/glossary */
export interface ReadingGlossaryEntry {
  word: string;
  word_norm: string;
  lemma: string | null;
  part_of_speech: string | null;
  ipa: string | null;
  translation_pt: string | null;
  definition_en: string | null;
  context_explanation_pt: string | null;
  examples: string[];
  source: ReadingGlossarySource;
  in_deck: boolean;
  card_id: string | null;
}

export interface ReadingQuizOption {
  key: string;
  text: string;
}

export interface ReadingQuizQuestion {
  index: number;
  prompt: string;
  options: ReadingQuizOption[];
}

export interface ReadingQuizAnswerState {
  question_index: number;
  choice: string;
  correct: boolean;
}

/** POST /api/reading/sections/{id}/quiz (no answer key). */
export interface ReadingQuiz {
  quiz_id: string;
  section_id: string;
  source: "ai" | "cache";
  questions: ReadingQuizQuestion[];
  answers: ReadingQuizAnswerState[];
}

/** POST /api/reading/sections/{id}/quiz/answer */
export interface ReadingQuizAnswerResult {
  correct: boolean;
  correct_key: string;
  explanation: string;
  evidence: string;
  answered: number;
  correct_count: number;
}

/** GET /api/reading/me/export */
export interface ReadingDataExport {
  exported_at: string;
  progress: unknown[];
  attempts: unknown[];
  words: unknown[];
  quiz_answers: unknown[];
}

/** DELETE /api/reading/me */
export interface ReadingDataDeleted {
  deleted: { progress: number; attempts: number; words: number; quiz_answers: number };
}

export interface ReadingOfflineBlock {
  part_id: string;
  block_index: number;
  words: number;
}

export interface ReadingOfflineSection {
  id: string;
  title: string;
  blocks: ReadingOfflineBlock[];
}

/** GET /api/reading/books/{slug}/chapters/{file}/offline-manifest */
export interface ReadingOfflineManifest {
  book: { slug: string; title: string; certification?: string | null; language?: ReadingLanguage };
  chapter: { file: string; index: number; title: string; words?: number; minutes?: number };
  sections: ReadingOfflineSection[];
  total_blocks: number;
  estimated_audio_mb: number;
}
