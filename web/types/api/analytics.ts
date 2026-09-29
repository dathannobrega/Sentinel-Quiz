/** Readiness, weak areas, engagement, insights and weekly analytics. */
import type { MessageCode } from "./common";
import type { ReviewQueueStateBreakdown, StudyPlanItem } from "./study";

export interface WeakDomainInsight {
  label: string;
  total: number;
  wrong: number;
  score_percent: number;
}

export interface TimingBreakdown {
  duration_seconds?: number | null;
  avg_seconds_per_question?: number | null;
  fastest_seconds?: number | null;
  slowest_seconds?: number | null;
}

export interface ReadinessDomainScore {
  domain: string;
  certification?: string | null;
  score_percent: number;
  accuracy_percent: number;
  attempts: number;
  avg_elapsed_seconds?: number | null;
  low_confidence_count: number;
  weight?: number | null;
}

export type ReadinessBand = "strong" | "stable" | "developing" | "at_risk" | "insufficient_data";

export interface ReadinessCertification {
  certification: string | null;
  score_percent: number | null;
  projected_score_percent: number | null;
  band: ReadinessBand | string;
  pass_threshold_percent: number;
  coverage_percent: number;
  attempts: number;
  tracked_questions: number;
  overdue_reviews: number;
  trend_points: number;
  overdue_penalty_points: number;
}

export interface ReadinessScore {
  /** null (band "insufficient_data") while there is too little recent data. */
  score_percent: number | null;
  projected_score_percent: number | null;
  band: ReadinessBand | string;
  status?: "ok" | "insufficient_data" | string;
  certification?: string | null;
  pass_threshold_percent?: number | null;
  coverage_percent?: number;
  overdue_reviews?: number;
  recommended_minutes: number;
  tracked_questions: number;
  /** pt-BR fallback texts; prefer translating `factor_codes`. */
  factors: string[];
  factor_codes?: MessageCode[];
  domain_scores: ReadinessDomainScore[];
  weakest_domains: ReadinessDomainScore[];
  certifications?: ReadinessCertification[];
}

/** LiveInsightOut: every field is always serialized by the backend. */
export interface LiveInsight {
  accuracy_percent: number;
  remaining_questions: number;
  current_correct_streak: number;
  weakest_area: Record<string, unknown> | null;
  /** pt-BR fallback; prefer translating `message_code` + `message_params` when present. */
  message: string;
  /** e.g. "study_feedback.correct_low_confidence" (additive, optional). */
  message_code?: string | null;
  message_params?: Record<string, string | number | null> | null;
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

/** i18n message code ("weak_area.<snake_case>") + params sent next to a pt-BR `message`. */
export interface WeakAreaMessageCode {
  code?: string | null;
  params?: Record<string, string | number | null> | null;
}

export interface WeakAreaDomain extends WeakAreaMessageCode {
  label: string;
  total: number;
  correct: number;
  wrong: number;
  pedagogical_signal: number;
  /** null when the domain has no attempts yet. */
  score_percent: number | null;
  /** pt-BR fallback text for `code` (optional). */
  message?: string | null;
}

export interface WeakAreaTrack extends WeakAreaMessageCode {
  certification: string;
  attempted: number;
  wrong: number;
  focus_domain: WeakAreaDomain | null;
  domains: WeakAreaDomain[];
  /** pt-BR fallback; prefer translating `code` + `params`. */
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
