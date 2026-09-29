/** Exam and study sessions: requests, runtime state, answers, results and reviews. */
import type { LiveInsight, ResultInsight } from "./analytics";
import type { QuestionItem } from "./catalog";
import type { CitationItem, OptionItem, PedagogicalReferenceItem } from "./common";
import type { PbqFeedbackFields, PbqPayload, PbqResponse, QuestionFormat } from "./pbq";

/** ExamRuntimeQuestionOut */
export interface ExamRuntimeQuestion extends QuestionItem {
  selected_keys: string[];
  is_answered: boolean;
  marked_for_review: boolean;
  elapsed_seconds: number | null;
  /** Saved PBQ response (answers can be revised while the exam is open). */
  pbq_response?: PbqResponse | null;
}

export interface ReviewScreenQuestionStatus {
  position: number;
  question_id: string;
  answered: boolean;
  selected_keys: string[];
  marked_for_review: boolean;
  is_current: boolean;
  format?: QuestionFormat | (string & {});
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
  /** PBQs placed at the start of the session (0–5, default 0). */
  pbq_count?: number;
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
  /** PBQs placed at the start of the session (0–5, default 0). */
  pbq_count?: number;
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
  correct_count: number | null;
  wrong_count: number | null;
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

/** GET /study/sessions/{id}/next (plain dict; keys are omitted when finished). */
export interface StudyNextQuestionResponse {
  finished: boolean;
  question?: QuestionItem;
  progress_index?: number;
  total_questions?: number;
  answered_count?: number;
}

interface AnswerFeedbackBase extends PbqFeedbackFields {
  is_correct: boolean | null;
  justification: string | null;
  feedback_summary: string | null;
  progress_index: number;
  total_questions: number;
  answered_count: number;
  correct_count: number | null;
  wrong_count: number | null;
  finished: boolean;
  official_references: PedagogicalReferenceItem[];
  insight: LiveInsight | null;
  /**
   * Correct option keys in this session's display-key space (options are shuffled per session).
   * null in exam-day mode, where the answer key is withheld.
   */
  correct_keys?: string[] | null;
  /** The submitted selection, in display keys. */
  selected_keys?: string[];
  /**
   * Optional i18n code for the feedback message (study: "study_feedback.*"). The runner
   * checks `insight.message_code` first, then these, and falls back to `insight.message`.
   */
  message?: string | null;
  message_code?: string | null;
  message_params?: Record<string, string | number | null> | null;
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
  /** Passing score of the session's certification (e.g. CISSP 70, Security+ 83, CEH 70; default 70). */
  pass_threshold_percent: number;
  pass_threshold_certification?: string | null;
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

/** ReviewQuestionOut. PBQs carry `format: "pbq"`, the payload, the response and the solution. */
export interface ReviewQuestion extends Omit<PbqFeedbackFields, "format"> {
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
  format?: QuestionFormat | (string & {});
  pbq?: PbqPayload | null;
  pbq_response?: PbqResponse | null;
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
