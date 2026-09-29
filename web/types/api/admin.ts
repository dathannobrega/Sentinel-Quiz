/** Admin console (/api/admin/*). */
import type { CitationItem } from "./common";

export interface AdminQuestionIssueUpdateInput {
  status?: string | null;
  internal_note?: string | null;
  resolved_version_id?: number | null;
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
