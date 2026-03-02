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
  question_ids?: string[] | null;
  strategy: ExamStrategy;
}

export interface StudySessionRequest {
  exam_id: string | null;
  total_questions: number;
  domains?: string[] | null;
  question_ids?: string[] | null;
  strategy: StudyStrategy;
  queue_only?: boolean;
}

export interface SessionResponse {
  id: string;
  exam_id: string | null;
  selection_strategy: string;
  selection_mix: Record<string, number>;
  total_questions: number;
  current_index: number;
  correct_count: number;
  wrong_count: number;
  answered_count?: number;
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

export interface SessionQuestionResponse {
  finished: boolean;
  question?: QuestionItem;
  progress_index?: number;
  total_questions?: number;
  answered_count?: number;
}

export interface ExamAnswerFeedback {
  is_correct: boolean;
  correct_keys: string[];
  justification?: string | null;
  progress_index: number;
  total_questions: number;
  correct_count: number;
  wrong_count: number;
  finished: boolean;
  insight?: Record<string, unknown> | null;
}

export interface StudyAnswerFeedback extends ExamAnswerFeedback {
  answered_count: number;
  confidence_level: string;
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
