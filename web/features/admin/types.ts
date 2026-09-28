import type { AdminIngestResponse, AdminQuestion, AdminQuestionStatusFilter, CitationItem } from "@/types/api";

/** Roles accepted by PATCH /admin/users/{id} (backend admin.py allowed_roles). */
export const ADMIN_USER_ROLES = ["student", "editor", "reviewer", "admin"] as const;
export type AdminUserRole = (typeof ADMIN_USER_ROLES)[number];

/** Editorial roles that can open the admin area (require_editor in backend admin.py). */
export const STAFF_ROLES = ["editor", "reviewer", "admin"] as const;

export const ISSUE_STATUSES = ["open", "triaged", "fix_in_progress", "verified", "released", "dismissed"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export interface ExamDraft {
  id: string;
  title: string;
  source: string;
  questionCount: string;
}

export interface OptionDraft {
  rowId: string;
  key: string;
  text: string;
  isCorrect: boolean;
}

export interface CitationDraft {
  rowId: string;
  source: string;
  reference: string;
  original: CitationItem;
}

export interface QuestionDraft {
  lookupId: string;
  id: string;
  examId: string;
  prompt: string;
  multiSelect: boolean;
  domain: string;
  difficulty: string;
  certification: string;
  subject: string;
  subtopic: string;
  subdomain: string;
  objectiveCode: string;
  blueprintCode: string;
  keywords: string[];
  trapPatterns: string[];
  questionFormat: string;
  tagsText: string;
  justification: string;
  correctRationale: string;
  incorrectRationales: string[];
  avgTimeSeconds: string;
  globalAccuracyPercent: string;
  changeSummary: string;
  options: OptionDraft[];
  citations: CitationDraft[];
}

export type QuestionQuality = NonNullable<AdminQuestion["quality"]>;

export type QuestionWorkflowAction = "submit-review" | "approve" | "publish";

/** Response of POST /admin/ingest (services/ingest.py ingest_questions_from_dir). */
export type AdminIngestResult = AdminIngestResponse;

/** "any" = no filter on the ingest flag; "yes"/"no" map to true/false. */
export type AdminFlagFilter = "any" | "yes" | "no";

/** Filters of the question browser (GET /admin/questions). */
export interface AdminQuestionFilters {
  examId: string;
  search: string;
  status: AdminQuestionStatusFilter;
  needsReview: AdminFlagFilter;
  explanationMissing: AdminFlagFilter;
}

/** Lifecycle + ingest flags of the question loaded in the editor. */
export interface AdminQuestionState {
  isActive: boolean;
  deactivatedReason: string | null;
  needsReview: boolean;
  explanationMissing: boolean;
}

export type AdminTask =
  | "refresh"
  | "ingest"
  | "export"
  | "captureSnapshot"
  | "saveExam"
  | "saveQuestion"
  | "submitReview"
  | "approveQuestion"
  | "publishQuestion"
  | "rollbackQuestion"
  | "deleteQuestion"
  | "reactivateQuestion";

export type Translate = (key: string, values?: Record<string, string | number>) => string;
