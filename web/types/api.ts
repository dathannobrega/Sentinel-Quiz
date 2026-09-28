export interface ApiFieldError {
  /** Dotted field path without the "body"/"query" prefix, e.g. "options.0.text". */
  field: string;
  message: string;
  type?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: string;
  status?: number;
  fieldErrors?: ApiFieldError[];
  retryAfterSeconds?: number | null;
  requestId?: string | null;
}

/** Error envelope returned by the backend (contract §1). */
export interface ApiErrorEnvelope {
  detail: string;
  code: string;
  message?: string;
  errors?: Array<{ loc: Array<string | number>; msg: string; type: string }>;
  details?: Record<string, unknown>;
  request_id?: string;
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

export interface WeakDomainInsight {
  label: string;
  total: number;
  wrong: number;
  score_percent: number;
}

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
  title: string;
  description: string;
  cta_label: string;
  cta_href: string;
  preset_key: string;
  domain?: string | null;
}

export interface StudyPlanResponse {
  placement_required: boolean;
  primary_task?: StudyPlanTask | null;
  secondary_tasks: StudyPlanTask[];
  suggested_presets: string[];
  risk_domains: string[];
  review_backlog_due: number;
  generated_at: string;
}

export interface TimingBreakdown {
  duration_seconds?: number | null;
  avg_seconds_per_question?: number | null;
  fastest_seconds?: number | null;
  slowest_seconds?: number | null;
}

export interface ReadinessDomainScore {
  domain: string;
  score_percent: number;
  accuracy_percent: number;
  attempts: number;
  avg_elapsed_seconds?: number | null;
  low_confidence_count: number;
}

export interface ReadinessScore {
  score_percent: number;
  projected_score_percent: number;
  band: "strong" | "stable" | "developing" | "at_risk" | string;
  recommended_minutes: number;
  tracked_questions: number;
  factors: string[];
  domain_scores: ReadinessDomainScore[];
  weakest_domains: ReadinessDomainScore[];
}

/** LiveInsightOut: every field is always serialized by the backend. */
export interface LiveInsight {
  accuracy_percent: number;
  remaining_questions: number;
  current_correct_streak: number;
  weakest_area: Record<string, unknown> | null;
  message: string;
}

/** ResultInsightOut: list/dict fields default to empty collections server-side. */
export interface ResultInsight {
  summary: Record<string, unknown>;
  by_type: Record<string, unknown>;
  by_domain: Array<Record<string, unknown>>;
  by_difficulty: Array<Record<string, unknown>>;
  by_certification: Array<Record<string, unknown>>;
  by_exam: Array<Record<string, unknown>>;
  weakest_domains: WeakDomainInsight[];
  strongest_domains: Array<Record<string, unknown>>;
  patterns: string[];
  focus: string[];
  study_plan: StudyPlanItem[];
  readiness: ReadinessScore | null;
  timing: TimingBreakdown | null;
  recommendation: string | null;
  missed_sample: Array<Record<string, unknown>>;
  live: LiveInsight | null;
}

/** ExamRuntimeQuestionOut */
export interface ExamRuntimeQuestion extends QuestionItem {
  selected_keys: string[];
  is_answered: boolean;
  marked_for_review: boolean;
  elapsed_seconds: number | null;
}

export interface ReviewScreenQuestionStatus {
  position: number;
  question_id: string;
  answered: boolean;
  selected_keys: string[];
  marked_for_review: boolean;
  is_current: boolean;
}

export interface ExamReviewScreen {
  session_id: string;
  total_questions: number;
  answered_count: number;
  unanswered_count: number;
  marked_for_review_count: number;
  current_position: number;
  items: ReviewScreenQuestionStatus[];
}

export type TutorMode = "help" | "why_wrong" | "review";

export interface TutorRequestPayload {
  user_message?: string | null;
  mode?: TutorMode;
}

export interface TutorReply {
  message: string;
  blocked: boolean;
  model: string | null;
}

/** Error codes the tutor endpoint can return (contract §3). */
export type TutorErrorCode =
  | "auth_required"
  | "tutor_unavailable_during_exam"
  | "tutor_quota_exceeded"
  | "tutor_upstream_error";

/** Issue reports are tied to the session type that surfaced the question. */
export type QuestionIssueMode = "exam" | "study";

export interface QuestionIssueRequest {
  session_id?: string | null;
  mode: QuestionIssueMode;
  category: "gabarito" | "explicacao" | "referencia" | "clareza";
  message: string;
  question_version_id?: number | null;
}

export interface QuestionIssue {
  id: number;
  question_id: string;
  question_version_id?: number | null;
  session_id?: string | null;
  mode: string;
  category: string;
  status: string;
  message: string;
  created_at?: string | null;
  updated_at?: string | null;
  internal_note?: string | null;
  triaged_by_user_id?: string | null;
  triaged_at?: string | null;
  resolved_version_id?: number | null;
  resolved_by_user_id?: string | null;
  resolved_at?: string | null;
  certification?: string | null;
  domain?: string | null;
  prompt_excerpt?: string | null;
}

export interface AdminQuestionIssueUpdateInput {
  status?: string | null;
  internal_note?: string | null;
  resolved_version_id?: number | null;
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

/** QuestionOut */
export interface QuestionItem {
  id: string;
  exam_id: string;
  prompt: string;
  multi_select: boolean;
  domain: string | null;
  difficulty: string | null;
  certification: string | null;
  tags: string[] | null;
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

/** Bucket built by services/quiz.py (_bucket_template + label). */
export interface WeakAreaDomain {
  label: string;
  total: number;
  correct: number;
  wrong: number;
  pedagogical_signal: number;
  score_percent: number;
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

export type UserRole = "admin" | "reviewer" | "editor" | "student" | (string & {});

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
}

/**
 * Login/register response. Since contract §2 the session lives in the HttpOnly cookie and
 * `token` is omitted/null unless AUTH_RETURN_TOKEN_IN_BODY is enabled server-side.
 */
export interface AuthTokenResponse {
  token?: string | null;
  token_type?: string | null;
  expires_at?: string | null;
  user: AuthUser;
}

export interface EmailChallengeRequest {
  email?: string | null;
}

export interface EmailChallengeConsumeRequest {
  token: string;
}

export interface PasswordResetRequest {
  token: string;
  new_password: string;
}

export type SessionMode = "exam" | "study";
export type ExperienceMode = "standard" | "exam_day";
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
  experience_mode?: ExperienceMode;
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

/** SessionOut / SessionStateOut (exam sessions). All fields are always serialized. */
export interface SessionResponse {
  id: string;
  exam_id: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  active_filters: Record<string, unknown>;
  total_questions: number;
  current_index: number;
  current_position: number;
  correct_count: number;
  wrong_count: number;
  answered_count: number;
  marked_for_review_count: number;
  experience_mode: ExperienceMode | (string & {});
  time_limit_seconds: number | null;
  remaining_seconds: number | null;
  expires_at: string | null;
  paused: boolean;
  pause_count: number;
  auto_submitted: boolean;
  finished: boolean;
}

/** StudySessionOut / StudySessionStateOut. */
export interface StudySessionResponse {
  id: string;
  exam_id: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  total_questions: number;
  current_index: number;
  answered_count: number;
  correct_count: number;
  wrong_count: number;
  finished: boolean;
}

/** Mark-for-review toggle response (exam_runtime.toggle_mark_for_review). */
export interface MarkForReviewResponse {
  question_id: string;
  marked_for_review: boolean;
  marked_for_review_count: number;
  current_position: number;
}

/** SessionHistoryOut */
export interface SessionHistoryItem {
  id: string;
  exam_id: string | null;
  exam_title: string | null;
  created_at: string | null;
  completed_at: string | null;
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

/** ExamQuestionStateOut: optional fields are always present (null when unknown). */
export interface ExamQuestionState {
  finished: boolean;
  question: ExamRuntimeQuestion | null;
  progress_index: number | null;
  current_position: number | null;
  total_questions: number | null;
  answered_count: number | null;
  marked_for_review_count: number | null;
  experience_mode: ExperienceMode | (string & {}) | null;
}

/** @deprecated use ExamQuestionState. Kept as an alias for older call sites. */
export type SessionQuestionResponse = ExamQuestionState;

/** GET /study/sessions/{id}/next (plain dict; keys are omitted when finished). */
export interface StudyNextQuestionResponse {
  finished: boolean;
  question?: QuestionItem;
  progress_index?: number;
  total_questions?: number;
  answered_count?: number;
}

interface AnswerFeedbackBase {
  is_correct: boolean;
  justification: string | null;
  feedback_summary: string | null;
  progress_index: number;
  total_questions: number;
  answered_count: number;
  correct_count: number;
  wrong_count: number;
  finished: boolean;
  official_references: PedagogicalReferenceItem[];
  insight: LiveInsight | null;
  /**
   * Correct option keys. Not yet part of AnswerFeedbackOut; when the backend starts sending it
   * the runner highlights the correct option(s) after answering.
   */
  correct_keys?: string[] | null;
}

/** AnswerFeedbackOut */
export interface ExamAnswerFeedback extends AnswerFeedbackBase {
  current_position: number | null;
  marked_for_review_count: number;
}

/** StudyAnswerFeedbackOut */
export interface StudyAnswerFeedback extends AnswerFeedbackBase {
  confidence_level: string;
  confidence_signal: string;
  uncertain_correct: boolean;
  next_review_at: string | null;
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
  time_limit_seconds: number | null;
  time_spent_seconds: number | null;
  timed_out: boolean;
  insight: ResultInsight;
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
  placement_completed: boolean;
  insight: ResultInsight;
}

/** ReviewQuestionOut */
export interface ReviewQuestion {
  id: string;
  prompt: string;
  multi_select: boolean;
  domain: string | null;
  difficulty: string | null;
  certification: string | null;
  options: OptionItem[];
  correct_keys: string[];
  selected_keys: string[];
  is_correct: boolean | null;
  justification: string | null;
  tags: string[] | null;
  citations: CitationItem[] | null;
}

export interface SessionReview {
  session: SessionHistoryItem;
  result: ExamResult;
  questions: ReviewQuestion[];
}

/** StudyReviewQuestionOut */
export interface StudyReviewQuestion extends ReviewQuestion {
  question_number: number;
  confidence_level: string | null;
  elapsed_seconds: number | null;
  answered_at: string | null;
}

export interface StudySessionReview {
  session: StudyHistoryItem;
  result: StudyResult;
  questions: StudyReviewQuestion[];
}

export interface AdminDomainCatalogItem {
  id: number;
  certification: string;
  domain: string;
  subdomain?: string | null;
  subject?: string | null;
  objective_code?: string | null;
  blueprint_code?: string | null;
  title?: string | null;
  description?: string | null;
  blueprint_title?: string | null;
  blueprint_description?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AdminDomainCatalogPage {
  items: AdminDomainCatalogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name?: string | null;
  role: string;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  exam_session_count: number;
  study_session_count: number;
}

export interface AdminUserUpdateInput {
  role?: string | null;
  is_active?: boolean | null;
}

export interface AdminOverview {
  exam_count: number;
  /** Active questions only (what students can get in new sessions). */
  question_count: number;
  completed_session_count: number;
  /** Active questions per certification. */
  question_breakdown: Record<string, number>;
  /** Soft-deleted or removed-from-source questions. */
  inactive_question_count: number;
  /** Active questions flagged by the JSON ingest. */
  needs_review_count: number;
  explanation_missing_count: number;
}

/** GET /admin/questions?status= (Question.is_active). */
export type AdminQuestionStatusFilter = "active" | "inactive" | "all";

/** Why a question is inactive (backend models.QUESTION_DEACTIVATED_*). */
export type AdminQuestionDeactivatedReason = "deleted" | "removed_from_source";

/** quality.field_status values (backend services/question_quality.py). */
export type AdminQualityFieldStatus = "ok" | "provided" | "missing" | "unverified" | "placeholder";

export interface AdminQuestionQuality {
  blocking_issues: string[];
  warnings: string[];
  field_status: Record<string, AdminQualityFieldStatus>;
  completeness_score: number;
  is_publish_ready: boolean;
  blueprint?: Record<string, string | null>;
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
  quality?: AdminQuestionQuality | null;
}

/** POST /admin/ingest (backend services/ingest.py ingest_questions_from_dir). */
export interface AdminIngestResponse {
  /** Source files imported / skipped (unchanged hash). */
  imported: number;
  skipped: number;
  errors: string[];
  questions_imported: number;
  /** Deleted by an editor: never resurrected by the import. */
  skipped_deleted: number;
  /** Editorially published version kept; imported content not applied. */
  skipped_editorial: number;
  reactivated: number;
  /** Removed from the source file (soft deactivated). */
  deactivated: number;
  domain_weights_updated: number;
  study_modules: number;
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
  is_active: boolean;
  deactivated_reason: AdminQuestionDeactivatedReason | null;
  needs_review: boolean;
  explanation_missing: boolean;
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
  quality?: AdminQuestionQuality | null;
  is_active: boolean;
  deactivated_reason: AdminQuestionDeactivatedReason | null;
  deactivated_at: string | null;
  needs_review: boolean;
  explanation_missing: boolean;
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
