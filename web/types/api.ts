export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: string;
  status?: number;
}

export interface HealthResponse {
  ok: boolean;
  ai_enabled: boolean;
  ai_model: string | null;
}

export interface Exam {
  id: string;
  title: string;
  source?: string | null;
  question_count?: number | null;
}

export interface OptionItem {
  key: string;
  text: string;
}

export interface CitationItem {
  source?: string;
  reference?: string;
  material_path?: string;
  locator?: string;
  page_start?: number | string | null;
  page_end?: number | string | null;
  [key: string]: unknown;
}

export interface PedagogicalReferenceItem {
  source_kind: string;
  label: string;
  reference?: string | null;
  material_path?: string | null;
  locator?: string | null;
  page_start?: number | null;
  page_end?: number | null;
  is_official: boolean;
}

export interface QuestionHint {
  question_id: string;
  level: number;
  available_levels: number[];
  title: string;
  hint_kind: string;
  message: string;
  caution: string;
  references: PedagogicalReferenceItem[];
}

export interface QuestionItem {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain?: string | null;
  difficulty?: string | null;
  certification?: string | null;
  tags?: string[] | null;
  options: OptionItem[];
}

export interface DomainCatalogEntry {
  value: string;
  label: string;
  question_count: number;
  certifications: string[];
}

export interface DomainCatalogResponse {
  exam_id: string | null;
  domains: DomainCatalogEntry[];
}

export interface WeakAreaDomain {
  label: string;
  total: number;
  wrong: number;
  accuracy?: number;
  wrong_rate?: number;
}

export interface WeakAreaTrack {
  certification: string;
  attempted: number;
  wrong: number;
  focus_domain: WeakAreaDomain | null;
  domains: WeakAreaDomain[];
  message: string;
}

export interface WeakAreasResponse {
  certifications: WeakAreaTrack[];
}

export interface EngagementGoal {
  target: number;
  completed: number;
  remaining: number;
  progress_percent: number;
  reached: boolean;
}

export interface EngagementStreak {
  current_days: number;
  best_days: number;
  total_active_days: number;
  last_activity_at?: string | null;
  goal_completed_today: boolean;
}

export interface EngagementAdaptiveProfile {
  recovery_mode: boolean;
  low_confidence_bias: number;
  variety_floor_percent: number;
  focus_domains: Array<Record<string, unknown>>;
  last_recomputed_at?: string | null;
}

export interface EngagementSnapshot {
  daily_goal: EngagementGoal;
  daily_review_goal: EngagementGoal;
  weekly_goal: EngagementGoal;
  weekly_review_goal: EngagementGoal;
  streak: EngagementStreak;
  adaptive_profile: EngagementAdaptiveProfile;
  review_backlog_due: number;
  recommended_next_action: string;
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

export interface AuthUser {
  id: string;
  email: string;
  display_name?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface AuthTokenResponse {
  token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
}

export type SessionMode = "exam" | "study";
export type ExamStrategy = "standard" | "adaptive";
export type StudyStrategy = "standard" | "adaptive" | "review";

export interface SessionRequest {
  exam_id: string | null;
  total_questions: number;
  domains?: string[] | null;
  difficulties?: string[] | null;
  tags?: string[] | null;
  bookmarked_only?: boolean;
  notes_only?: boolean;
  incorrect_only?: boolean;
  unseen_only?: boolean;
  low_confidence_only?: boolean;
  strategy: ExamStrategy;
  time_limit_minutes?: number | null;
}

export interface StudySessionRequest {
  exam_id: string | null;
  total_questions: number;
  domains?: string[] | null;
  difficulties?: string[] | null;
  tags?: string[] | null;
  bookmarked_only?: boolean;
  notes_only?: boolean;
  incorrect_only?: boolean;
  unseen_only?: boolean;
  low_confidence_only?: boolean;
  strategy: StudyStrategy;
  queue_only?: boolean;
  review_states?: string[] | null;
}

export interface SessionResponse {
  id: string;
  exam_id: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  active_filters?: Record<string, unknown>;
  total_questions: number;
  current_index: number;
  correct_count: number;
  wrong_count: number;
  answered_count?: number;
  time_limit_seconds?: number | null;
  remaining_seconds?: number | null;
  expires_at?: string | null;
  paused?: boolean;
  pause_count?: number;
  auto_submitted?: boolean;
  finished: boolean;
}

export interface SessionHistoryItem {
  id: string;
  exam_id?: string | null;
  exam_title?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  score_percent: number;
}

export interface ActiveSessionItem {
  id: string;
  mode: string;
  exam_id?: string | null;
  exam_title?: string | null;
  created_at?: string | null;
  current_index: number;
  answered_count: number;
  total_questions: number;
  progress_percent: number;
  selection_strategy: string;
}

export interface QuestionSearchItem {
  id: string;
  exam_id: string;
  exam_title?: string | null;
  prompt_excerpt: string;
  domain?: string | null;
  certification?: string | null;
  tags: string[];
  keywords: string[];
  is_bookmarked: boolean;
  has_note: boolean;
}

export interface QuestionSearchResponse {
  items: QuestionSearchItem[];
  total: number;
  limit: number;
  offset: number;
  applied_filters: Record<string, unknown>;
}

export interface StudyHistoryItem {
  id: string;
  exam_id?: string | null;
  exam_title?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  total_questions: number;
  answered_count: number;
  correct_count: number;
  wrong_count: number;
  score_percent: number;
  avg_seconds_per_question?: number | null;
  confidence_low: number;
  confidence_medium: number;
  confidence_high: number;
  weakest_domains: string[];
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

export interface StudyWeeklyMetric {
  week_start: string;
  week_end: string;
  label: string;
  study_questions: number;
  review_questions: number;
  scheduled_reviews: number;
  completed_sessions: number;
  review_sessions: number;
  accuracy_percent: number;
  low_confidence: number;
}

export interface StudyWeeklyGoalSummary {
  weekly_question_target: number;
  weekly_review_target: number;
  weekly_new_question_target: number;
  completion_ratio_percent: number;
  suggested_daily_question_target: number;
  suggested_daily_review_target: number;
  on_track: boolean;
}

export interface StudyReviewForecastSummary {
  projected_due_next_7_days: number;
  projected_at_risk_next_7_days: number;
  peak_load_day: number;
  peak_load_date?: string | null;
  pressure: string;
}

export interface StudyWeeklySummary {
  weeks_tracked?: number;
  active_weeks?: number;
  total_questions?: number;
  review_questions?: number;
  average_accuracy_percent?: number;
  current_week_questions?: number;
  current_week_accuracy_percent?: number;
  current_week_scheduled_reviews?: number;
  current_week_review_questions?: number;
  current_week_low_confidence?: number;
  accuracy_delta_vs_previous_week?: number;
  question_delta_vs_previous_week?: number;
  review_backlog_due?: number;
  review_backlog_total?: number;
  review_state_breakdown?: ReviewQueueStateBreakdown;
  weekly_goal?: StudyWeeklyGoalSummary;
  review_forecast?: StudyReviewForecastSummary;
  recommendation?: string;
}

export interface StudyWeeklyAnalytics {
  weeks: StudyWeeklyMetric[];
  summary: StudyWeeklySummary;
}

export interface SessionQuestionResponse {
  finished: boolean;
  question?: QuestionItem;
  progress_index?: number;
  total_questions?: number;
  answered_count?: number;
}

export interface ExamAnswerFeedback {
  is_correct: boolean;
  justification?: string | null;
  progress_index: number;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  finished: boolean;
  official_references?: PedagogicalReferenceItem[];
  insight?: Record<string, unknown> | null;
}

export interface StudyAnswerFeedback extends ExamAnswerFeedback {
  answered_count: number;
  confidence_level: string;
  confidence_signal: string;
  uncertain_correct?: boolean;
  next_review_at?: string | null;
  review_due_count: number;
}

export interface ExamResult {
  session_id: string;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  score_percent: number;
  passed: boolean;
  pass_threshold_percent: number;
  strategy: string;
  selection_mix: Record<string, number>;
  time_limit_seconds?: number | null;
  time_spent_seconds?: number | null;
  timed_out?: boolean;
  insight: Record<string, unknown>;
}

export interface StudyResult {
  session_id: string;
  total_questions: number;
  answered_count: number;
  correct_count: number;
  wrong_count: number;
  score_percent: number;
  mode: string;
  strategy: string;
  selection_mix: Record<string, number>;
  review_due_count: number;
  insight: Record<string, unknown>;
}

export interface ReviewQuestion {
  id: string;
  prompt: string;
  multi_select: boolean;
  domain?: string | null;
  difficulty?: string | null;
  certification?: string | null;
  options: OptionItem[];
  correct_keys: string[];
  selected_keys: string[];
  is_correct?: boolean | null;
  justification?: string | null;
  tags?: string[] | null;
  citations?: CitationItem[] | null;
}

export interface SessionReview {
  session: SessionHistoryItem;
  result: ExamResult;
  questions: ReviewQuestion[];
}

export interface StudyReviewQuestion extends ReviewQuestion {
  question_number: number;
  confidence_level?: string | null;
  elapsed_seconds?: number | null;
  answered_at?: string | null;
}

export interface StudySessionReview {
  session: StudyHistoryItem;
  result: StudyResult;
  questions: StudyReviewQuestion[];
}

export interface AdminOverview {
  exam_count: number;
  question_count: number;
  completed_session_count: number;
  question_breakdown: Record<string, number>;
}

export interface AdminAnalyticsSummary {
  tracked_questions: number;
  questions_with_signals: number;
  total_attempts: number;
  exam_attempts: number;
  study_attempts: number;
  total_review_pressure: number;
  average_wrong_rate_percent: number;
  snapshot_batch_count: number;
  latest_snapshot_at?: string | null;
}

export interface AdminHardestQuestion {
  id: string;
  exam_id: string;
  exam_title?: string | null;
  prompt: string;
  domain?: string | null;
  certification?: string | null;
  difficulty?: string | null;
  attempts_total: number;
  exam_attempts: number;
  study_attempts: number;
  wrong_count: number;
  wrong_rate_percent: number;
  low_confidence_count: number;
  low_confidence_rate_percent: number;
  review_pressure_count: number;
  avg_study_elapsed_seconds?: number | null;
  difficulty_score: number;
}

export interface AdminWeakDomain {
  domain: string;
  tracked_questions: number;
  attempts_total: number;
  wrong_count: number;
  wrong_rate_percent: number;
  low_confidence_count: number;
  review_pressure_count: number;
}

export interface AdminWeakExam {
  exam_id: string;
  exam_title: string;
  tracked_questions: number;
  attempts_total: number;
  wrong_count: number;
  wrong_rate_percent: number;
  low_confidence_count: number;
  review_pressure_count: number;
}

export interface AdminQuestionAnalytics {
  summary: AdminAnalyticsSummary;
  hardest_questions: AdminHardestQuestion[];
  weakest_domains: AdminWeakDomain[];
  weakest_exams: AdminWeakExam[];
}

export interface AdminAnalyticsSnapshotCapture {
  ok: boolean;
  schema_ready: boolean;
  message?: string | null;
  capture_batch_id?: string | null;
  captured_at?: string | null;
  snapshot_count: number;
}

export interface AdminQuestionAnalyticsSnapshot {
  id: number;
  capture_batch_id: string;
  question_id: string;
  question_version_id?: number | null;
  version_number?: number | null;
  attempts_total: number;
  exam_attempts: number;
  study_attempts: number;
  wrong_count: number;
  wrong_rate_percent: number;
  low_confidence_count: number;
  low_confidence_rate_percent: number;
  review_pressure_count: number;
  avg_study_elapsed_seconds?: number | null;
  difficulty_score: number;
  captured_at?: string | null;
}

export interface AdminMutationResponse {
  ok: boolean;
  id?: string;
  status?: string;
  version_id?: number;
  version_number?: number;
  quality?: {
    blocking_issues: string[];
    warnings: string[];
    field_status: Record<string, string>;
    completeness_score: number;
    is_publish_ready: boolean;
    blueprint?: Record<string, string | null>;
  } | null;
}

export interface AdminIngestResponse {
  imported: number;
  skipped: number;
  errors?: string[];
}

export interface AdminCreateExamInput {
  id: string;
  title: string;
  source?: string | null;
  question_count?: number | null;
}

export interface AdminOptionInput {
  key: string;
  text: string;
  is_correct?: boolean | null;
}

export interface AdminOption extends AdminOptionInput {
  is_correct: boolean;
}

export interface AdminQuestionSummary {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain?: string | null;
  difficulty?: string | null;
  certification?: string | null;
  option_count: number;
  correct_count: number;
  editorial_status?: string | null;
  draft_version_number?: number | null;
  published_version_number?: number | null;
  loaded_from?: string | null;
}

export interface AdminQuestion {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain?: string | null;
  difficulty?: string | null;
  certification?: string | null;
  subject?: string | null;
  subtopic?: string | null;
  subdomain?: string | null;
  objective_code?: string | null;
  blueprint_code?: string | null;
  keywords?: string[] | null;
  trap_patterns?: string[] | null;
  question_format?: string | null;
  tags?: string[] | null;
  citations?: CitationItem[] | null;
  options: AdminOption[];
  correct_keys: string[];
  justification?: string | null;
  correct_rationale?: string | null;
  incorrect_rationales?: string[] | null;
  avg_time_seconds?: number | null;
  global_accuracy_percent?: number | null;
  change_summary?: string | null;
  editorial_status?: string | null;
  loaded_from?: string | null;
  version_id?: number | null;
  version_number?: number | null;
  published_version_number?: number | null;
  draft_version_number?: number | null;
  quality?: {
    blocking_issues: string[];
    warnings: string[];
    field_status: Record<string, string>;
    completeness_score: number;
    is_publish_ready: boolean;
    blueprint?: Record<string, string | null>;
  } | null;
}

export interface AdminQuestionInput {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain?: string | null;
  difficulty?: string | null;
  certification?: string | null;
  subject?: string | null;
  subtopic?: string | null;
  subdomain?: string | null;
  objective_code?: string | null;
  blueprint_code?: string | null;
  keywords?: string[] | null;
  trap_patterns?: string[] | null;
  question_format?: string | null;
  tags?: string[] | null;
  citations?: CitationItem[] | null;
  options: AdminOptionInput[];
  correct_keys: string[];
  justification?: string | null;
  correct_rationale?: string | null;
  incorrect_rationales?: string[] | null;
  avg_time_seconds?: number | null;
  global_accuracy_percent?: number | null;
  change_summary?: string | null;
}

export interface AdminQuestionVersion {
  id: number;
  question_id: string;
  version_number: number;
  status: string;
  change_summary?: string | null;
  review_notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
  option_count: number;
  correct_count: number;
  is_current_draft: boolean;
  is_current_published: boolean;
}

export interface AdminAuditLog {
  id: number;
  question_id?: string | null;
  question_version_id?: number | null;
  actor_user_id?: string | null;
  actor_role?: string | null;
  action: string;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface AdminReviewActionInput {
  reason?: string | null;
}

export interface AdminRollbackInput {
  version_id: number;
  reason?: string | null;
}
