/**
 * Sentinel Arena AI authoring types. Source of truth:
 * docs/live-quiz/CONTRATO-INCREMENTO-2.md §3. Keep in sync with backend/app/schemas_ai.py.
 */
import type { LiveItemType } from "./live";

export type AiItemType = Extract<LiveItemType, "single_choice" | "multi_choice" | "true_false" | "type_answer">;
export type AiLevel = "Easy" | "Medium" | "Hard" | "mixed";
export type AiLanguage = "pt-BR" | "en";
export type AiJobKind = "generate" | "from_source" | "improve";
export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "degraded";
export type AiJobStage = "queued" | "generating" | "validating" | "critic" | "done";
export type AiImproveAction = "rewrite" | "distractors" | "explain";
export type AiCriticFlag = "key_mismatch" | "ambiguous" | "factual_issue";

export interface AiCapabilities {
  enabled: boolean;
  reason: null | "ai_disabled" | "not_allowed";
  provider: "gemini" | "fake";
  model: string;
  critic_enabled: boolean;
  credits: { daily_limit: number | null; used_today: number; remaining: number | null };
  limits: { max_items: number; source_max_chars: number; topic_max_chars: number };
  item_types: AiItemType[];
  certifications: Array<{ id: string; label: string; domains: string[] }>;
}

export interface AiGenerateIn {
  quiz_id: string;
  topic?: string;
  certification?: string;
  domains?: string[];
  level: AiLevel;
  n: number;
  types: AiItemType[];
  language: AiLanguage;
  audience_note?: string;
}

export interface AiFromSourceIn {
  quiz_id: string;
  source_text: string;
  n: number;
  types: AiItemType[];
  level: AiLevel;
  language: AiLanguage;
  title_hint?: string;
}

export interface AiImproveIn {
  quiz_id: string;
  action: AiImproveAction;
  instructions?: string;
}

export interface AiApplyIn {
  quiz_id: string;
  expected_version: number;
  indexes: number[];
  force?: boolean;
}

export interface AiIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  field: string | null;
}

export interface AiCritic {
  solved_keys: string[];
  confidence: number;
  flags: AiCriticFlag[];
  notes: string[];
}

export interface AiDraftItem {
  index: number;
  item_type: AiItemType;
  prompt: string;
  options: Array<{ key: string; text: string; correct: boolean; why_wrong: string | null }>;
  accepted_answers: string[];
  explanation: string;
  time_limit_s: number;
  difficulty: string | null;
  domain: string | null;
  certification: string | null;
  issues: AiIssue[];
  critic: AiCritic | null;
  applied: boolean;
  blocked: boolean;
}

export interface AiProposal {
  prompt?: string;
  options?: Array<{ key: string; text: string; correct: boolean }>;
  explanation?: string;
  changed: string[];
}

export type AiJobResult =
  | { type: "drafts"; items: AiDraftItem[]; summary: { requested: number; produced: number; blocked: number; warnings: number } }
  | { type: "improvement"; item_id: string; proposal: AiProposal }
  | { type: "degraded"; reason: "ai_unavailable"; bank_question_ids: string[] };

export interface AiJob {
  id: string;
  kind: AiJobKind;
  status: AiJobStatus;
  quiz_id: string;
  item_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  progress: { stage: AiJobStage; pct: number };
  credits: number;
  model: string | null;
  error_code: string | null;
  error_message: string | null;
  injection_suspected: boolean;
  result: AiJobResult | null;
}

export interface AiSuggestFormatIn {
  item_type: LiveItemType;
  prompt: string;
  options?: string[];
}

export interface AiSuggestFormatOut {
  time_limit_s: number;
  rationale: string;
}

export interface LiveBankSampleIn {
  certification?: string;
  domains?: string[];
  difficulty?: "Easy" | "Medium" | "Hard";
  n: number;
  strategy: "coverage" | "random";
  only_guest_eligible?: boolean;
  exclude_quiz_id?: string;
}

export interface LiveBankSampleOut {
  question_ids: string[];
  coverage: Array<{ domain: string; count: number }>;
  available: number;
}

/** Per-item AI provenance shown in the editor (LiveItem.ai). */
export interface LiveItemAiMeta {
  job_id: string;
  model: string | null;
  issues: AiIssue[];
  critic: AiCritic | null;
  requires_key_confirmation: boolean;
}
