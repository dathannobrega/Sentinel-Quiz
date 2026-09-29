/** Session runner side panels: tutor, hints and question issue reports. */
import type { PedagogicalReferenceItem } from "./common";

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
