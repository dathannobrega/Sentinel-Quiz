/**
 * Sentinel Arena (live quizzes) REST types. Source of truth:
 * docs/live-quiz/CONTRATO-INCREMENTO-1.md §3–§5 and §7. Keep in sync with
 * backend/app/schemas_live.py.
 */

export type LiveItemType =
  | "single_choice"
  | "multi_choice"
  | "true_false"
  | "type_answer"
  | "poll"
  | "content"
  | "leaderboard";

export type LiveThemeKey = "sentinel" | "terminal" | "neon_soc" | "aurora" | "high_contrast";
export type LiveScoring = "speed" | "fixed" | "none";
export type LiveLicenseScope = "own" | "platform" | "pending_audit" | "personal_use";
export type LiveSourceKind = "custom" | "bank" | "ai";
export type LiveReviewState = "ok" | "needs_review";
export type LivePreset = "turma" | "evento";
export type LiveAudience = "adulto" | "misto" | "infantojuvenil";
export type LiveSessionStatus = "lobby" | "live" | "finished";
export type LivePhase =
  | "lobby"
  | "question"
  | "locked"
  | "reveal"
  | "leaderboard"
  | "content"
  | "podium"
  | "finished";

export type LiveCannotHostReason = "live_disabled" | "not_allowlisted" | "email_not_verified" | "auth_required";

export interface LiveLimits {
  max_participants: number;
  max_items: number;
  prompt_max: number;
  option_max: number;
  options_min: number;
  options_max: number;
  time_limit_min: number;
  time_limit_max: number;
}

export interface LiveCapabilities {
  enabled: boolean;
  can_host: boolean;
  reason: LiveCannotHostReason | null;
  item_types: LiveItemType[];
  themes: LiveThemeKey[];
  limits: LiveLimits;
}

export interface LiveQuizSettings {
  scoring: LiveScoring;
  reading_phase_s: number;
  grace_ms: number;
  streak_bonus: boolean;
  show_live_distribution: boolean;
  show_correct_on_device: boolean;
  show_explanation: boolean;
  /** 0 = only at the end. */
  leaderboard_every: number;
  music: boolean;
}

export interface LiveItemOption {
  key: string;
  text: string;
  correct: boolean;
}

export interface LiveItem {
  id: string;
  position: number;
  item_type: LiveItemType;
  prompt: string;
  options: LiveItemOption[];
  accepted_answers: string[];
  allow_multiple: boolean;
  all_or_nothing: boolean;
  body: string | null;
  time_limit_s: number | null;
  points_multiplier: 0 | 1 | 2;
  explanation: string | null;
  presenter_notes: string | null;
  source_kind: LiveSourceKind;
  source_question_id: string | null;
  source_version_id: number | null;
  license_scope: LiveLicenseScope;
  review_state: LiveReviewState;
  domain: string | null;
  certification: string | null;
  difficulty: string | null;
  updated_at: string;
  /** Present on AI-generated or AI-improved items (Incremento 2). */
  ai?: import("./ai").LiveItemAiMeta | null;
}

export interface LiveItemWrite {
  item_type?: LiveItemType;
  prompt?: string;
  options?: Array<{ key?: string; text: string; correct?: boolean }>;
  accepted_answers?: string[];
  allow_multiple?: boolean;
  all_or_nothing?: boolean;
  body?: string | null;
  time_limit_s?: number | null;
  points_multiplier?: 0 | 1 | 2;
  explanation?: string | null;
  presenter_notes?: string | null;
}

export interface LiveSessionRef {
  id: string;
  status: LiveSessionStatus;
  created_at: string;
}

export interface LiveQuizSummary {
  id: string;
  title: string;
  description: string | null;
  theme_key: LiveThemeKey;
  item_count: number;
  version: number;
  published_version_no: number | null;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
  last_session: LiveSessionRef | null;
}

export interface LiveQuizDetail extends LiveQuizSummary {
  language: string;
  settings: LiveQuizSettings;
  items: LiveItem[];
  can_edit: boolean;
}

export interface LiveQuizCreate {
  title: string;
  description?: string | null;
  language?: string;
  theme_key?: LiveThemeKey;
  settings?: Partial<LiveQuizSettings>;
}

export interface LiveQuizUpdate {
  expected_version: number;
  title?: string;
  description?: string | null;
  language?: string;
  theme_key?: LiveThemeKey;
  settings?: Partial<LiveQuizSettings>;
}

export interface LiveIssue {
  item_id: string | null;
  position: number | null;
  field: string;
  code: string;
  message: string;
}

export interface LivePublishResult {
  quiz: LiveQuizDetail;
  version_no: number;
  published_at: string;
  warnings: LiveIssue[];
}

export interface LiveFromBankResult {
  quiz: LiveQuizDetail;
  rejected: Array<{ question_id: string; reason: string }>;
}

export interface LiveBankFacets {
  certifications: Array<{ id: string; label: string; count: number }>;
  domains: Array<{ certification: string | null; domain: string; count: number }>;
}

export interface LiveBankItem {
  question_id: string;
  prompt: string;
  options: Array<{ key: string; text: string }>;
  multi_select: boolean;
  certification: string | null;
  domain: string | null;
  difficulty: string | null;
  license_scope: LiveLicenseScope;
  guest_eligible: boolean;
  convertible_to: "single_choice" | "multi_choice" | "true_false" | null;
  reject_reason: string | null;
}

export interface LiveBankSearchResult {
  items: LiveBankItem[];
  total: number;
}

export interface LiveSession {
  id: string;
  quiz_id: string;
  quiz_title: string;
  version_no: number;
  status: LiveSessionStatus;
  phase: LivePhase;
  join_code: string;
  join_url: string;
  allow_guests: boolean;
  max_participants: number;
  preset: LivePreset;
  /** Rehearsal (RF-513): bots may take part; they never enter reports or the CSV. */
  rehearsal: boolean;
  audience: LiveAudience;
  theme_key: LiveThemeKey;
  item_count: number;
  participant_count: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface LiveSessionCreate {
  quiz_id: string;
  allow_guests?: boolean;
  max_participants?: number;
  preset?: LivePreset;
  audience?: LiveAudience;
  /** Rehearsal session (RF-513). */
  rehearsal?: boolean;
  /** 0..200 server-driven bots; only with `rehearsal` (422 `bots_require_rehearsal`). */
  bots?: number;
}

export interface LiveDisplayToken {
  token: string;
  expires_at: string;
}

export interface LiveRoomInfo {
  session_id: string;
  code: string;
  title: string;
  status: LiveSessionStatus;
  phase: LivePhase;
  allow_guests: boolean;
  requires_login: boolean;
  accepting_joins: boolean;
  theme_key: LiveThemeKey;
  participant_count: number;
  consent_version: string;
}

export interface LiveJoinRequest {
  display_name: string;
  consent: boolean;
  avatar_seed?: string;
  dev_h?: string;
}

export interface LiveJoinResult {
  session_id: string;
  participant_id: string;
  token: string;
  expires_at: string;
  return_code?: string | null;
  display_name: string;
  avatar_seed: string;
}

export interface LiveMyResultItem {
  position: number;
  prompt: string;
  item_type: LiveItemType;
  correct: boolean | null;
  fraction: number | null;
  points: number;
  your_answer: string[] | string | null;
  correct_answer: string[] | null;
  explanation: string | null;
}

export interface LiveMyResults {
  session_id: string;
  title: string;
  display_name: string;
  rank: number | null;
  participant_count: number;
  score: number;
  correct: number;
  answered: number;
  total_scored: number;
  items: LiveMyResultItem[];
}

export type LiveItemFlag =
  | "too_easy"
  | "too_hard"
  | "negative_discrimination"
  | "low_discrimination"
  | "distractor_dominant";

export interface LiveReportItem {
  position: number;
  item_type: LiveItemType;
  prompt: string;
  scored: boolean;
  answered: number;
  n_correct: number;
  p: number | null;
  discrimination: number | null;
  avg_ms: number | null;
  median_ms: number | null;
  flags: LiveItemFlag[];
  options: Array<{
    key: string;
    text: string;
    correct: boolean;
    count: number;
    pct: number;
    upper_pct: number | null;
    lower_pct: number | null;
  }>;
  top_answers?: Array<{ text: string; n: number; accepted: boolean }>;
  domain: string | null;
}

export interface LiveReportParticipant {
  participant_id: string;
  display_name: string;
  is_guest: boolean;
  rank: number;
  score: number;
  correct: number;
  answered: number;
  score_pct: number;
  avg_ms: number | null;
}

export type LiveDomainBand = "not_ready" | "approaching" | "ready" | "insufficient_data";

export interface LiveReportDomain {
  certification: string | null;
  domain: string;
  items: number;
  answers: number;
  pct_correct: number;
  band: LiveDomainBand;
}

export interface LiveReport {
  session: LiveSession;
  generated_at: string;
  kpis: {
    participants: number;
    /** Scored items the session reached (denominator of each participant's `correct`). */
    scored_items: number;
    answered_rate: number;
    completion_rate: number;
    avg_score_pct: number;
    median_score_pct: number;
    avg_response_ms: number | null;
    kr20: number | null;
  };
  items: LiveReportItem[];
  participants: LiveReportParticipant[];
  domains: LiveReportDomain[];
}
