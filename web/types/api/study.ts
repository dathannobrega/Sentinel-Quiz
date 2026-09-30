/** Study plan, study track modules, bookmarks/notes and the review queue. */

export interface StudyPlanItem {
  domain: string;
  wrong: number;
  total: number;
  score_percent: number;
  topics: string[];
  resources: string[];
  reason: string;
  action: string;
}

export interface StudyPlanTask {
  kind: string;
  /** pt-BR fallback texts; prefer translating `code` + `params`. */
  title: string;
  description: string;
  cta_label: string;
  cta_href: string;
  preset_key: string;
  domain?: string | null;
  certification?: string | null;
  code?: string | null;
  params?: Record<string, string | number | null>;
}

/**
 * Per-owner progress of a study-track module (contract r4 §2):
 * completed = mastery ≥ 80% with ≥ 10 attempts in the module's domain; in_progress = any
 * attempt; locked = some prerequisite not completed; otherwise available.
 */
export type StudyModuleStatus = "locked" | "available" | "in_progress" | "completed";

/** StudyModuleOut (GET /api/study/modules). */
export interface StudyModule {
  id: number;
  certification: string;
  code: string;
  position: number;
  title: string;
  description: string | null;
  domain: string | null;
  /** r4 §2 fields: optional so the UI degrades gracefully against older backends. */
  prerequisite_codes?: string[] | null;
  status?: StudyModuleStatus | (string & {}) | null;
  /** 0-100, null when the domain has no attempts yet. */
  mastery_percent?: number | null;
  attempted?: number | null;
}

export interface StudyModuleList {
  certification: string | null;
  modules: StudyModule[];
}

export interface StudyPlanRiskDomain {
  certification: string | null;
  domain: string;
  score_percent: number | null;
}

export interface StudyPlanResponse {
  placement_required: boolean;
  primary_task?: StudyPlanTask | null;
  secondary_tasks: StudyPlanTask[];
  suggested_presets: string[];
  risk_domains: string[];
  risk_domain_details?: StudyPlanRiskDomain[];
  review_backlog_due: number;
  certification?: string | null;
  recommended_module?: StudyModule | null;
  generated_at: string;
}

export interface StudyOverviewItem {
  question_id: string;
  prompt: string;
  updated_at?: string | null;
  excerpt?: string | null;
}

export interface StudyOverview {
  scope: string;
  bookmark_count: number;
  note_count: number;
  due_review_count: number;
  next_due_at?: string | null;
  recent_bookmarks: StudyOverviewItem[];
  recent_notes: StudyOverviewItem[];
  due_reviews: StudyOverviewItem[];
}

export interface StudyState {
  question_id: string;
  bookmarked: boolean;
  note_text?: string | null;
  updated_at?: string | null;
  scope: string;
}

export interface ReviewQueueEntry {
  question_id: string;
  prompt: string;
  due_at?: string | null;
  state: string;
  is_overdue: boolean;
  overdue_days: number;
  domain?: string | null;
  certification?: string | null;
  repetition_count: number;
  stability_score: number;
  ease_factor: number;
  bookmarked: boolean;
  has_note: boolean;
}

export interface ReviewQueueStateBreakdown {
  due_now: number;
  overdue: number;
  at_risk: number;
  scheduled: number;
  mastered: number;
}

export interface ReviewQueueForecastDay {
  date: string;
  label: string;
  due_count: number;
  at_risk_count: number;
}

export interface ReviewQueueGoals {
  daily_review_target: number;
  weekly_review_target: number;
  new_question_budget: number;
}

export interface ReviewQueueSnapshot {
  due_count: number;
  total_count: number;
  next_due_at?: string | null;
  recommended_batch_size: number;
  state_breakdown: ReviewQueueStateBreakdown;
  upcoming_load: ReviewQueueForecastDay[];
  goals: ReviewQueueGoals;
  applied_filters: Record<string, unknown>;
  items: ReviewQueueEntry[];
}

/** A book section to study after answering (backend study_links). */
export interface StudySection {
  section_id: string;
  book_title: string;
  chapter_title?: string | null;
  title: string;
  breadcrumb: string[];
  page_start?: number | null;
  page_end?: number | null;
  excerpt: string;
  excerpt_truncated: boolean;
  /** "your_choice": explains the wrong option the student picked (option_key, display key). */
  reason: "your_choice" | "explanation" | (string & {});
  option_key?: string | null;
}

export interface StudySectionBlock {
  text: string;
  label?: string | null;
}

export interface StudySectionPart {
  id: string;
  title: string;
  depth: number;
  blocks: StudySectionBlock[];
}

export interface StudySectionLink {
  id: string;
  title: string;
}

/** GET /api/materials/sections/{id} */
export interface StudySectionDetail {
  section_id: string;
  book_title: string;
  certification?: string | null;
  chapter_title?: string | null;
  title: string;
  breadcrumb: string[];
  page_start?: number | null;
  page_end?: number | null;
  objectives: string[];
  parts: StudySectionPart[];
  truncated: boolean;
  parent?: StudySectionLink | null;
  previous?: StudySectionLink | null;
  next?: StudySectionLink | null;
  practice_questions: number;
}

/** GET /api/study/weak-sections */
export interface WeakSection extends StudySection {
  mistakes: number;
  open_questions: number;
  missed_questions: number;
  practice_questions: number;
  last_mistake_at?: string | null;
}
