/**
 * Sentinel Arena administration (`/api/admin/live`, docs/live-quiz/CONTRATO-INCREMENTO-4.md §5).
 * Moderators are `reviewer` or `admin`; policy and destructive actions need `admin`.
 * Keep in sync with backend/app/api/live_admin.py and backend/app/services/live_admin.py.
 */
import type { LivePhase, LiveSessionStatus } from "./live";

export interface LiveAdminActiveSession {
  id: string;
  join_code: string;
  quiz_title: string;
  owner_email: string;
  status: LiveSessionStatus;
  phase: LivePhase;
  rehearsal: boolean;
  allow_guests: boolean;
  /** People in the room (bots and the host preview apart). */
  participants: number;
  /** Seen in the last minute. */
  online: number;
  max_participants: number;
  created_at: string | null;
  started_at: string | null;
}

export interface LiveAdminOverview {
  active_sessions: LiveAdminActiveSession[];
  totals: { active_sessions: number; participants: number; online: number; open_cases: number };
}

export type LiveCaseStatus = "open" | "dismissed" | "actioned";
export type LiveCaseStatusFilter = LiveCaseStatus | "all";
export type LiveCaseSource = "participant" | "filter" | "admin";
export type LiveCaseAction = "dismiss" | "approve" | "remove_item" | "end_session" | "block_quiz";

export interface LiveModerationCase {
  id: string;
  source: LiveCaseSource;
  status: LiveCaseStatus;
  /** A report reason (offensive, spam...) or "filter_match". */
  reason: string;
  note: string | null;
  excerpt: string | null;
  details: Record<string, unknown>;
  quiz_id: string | null;
  quiz_title: string | null;
  owner_email: string | null;
  quiz_version_id: string | null;
  session_id: string | null;
  join_code: string | null;
  /** 0-based item position. */
  position: number | null;
  created_at: string | null;
  resolved_at: string | null;
  resolution: LiveCaseAction | null;
  resolution_note: string | null;
}

export interface LiveCasesPage {
  items: LiveModerationCase[];
  total: number;
}

export interface LiveCaseResolveResult {
  resolved: true;
  sessions_affected: string[];
}

export type LiveTermMatch = "token" | "substring";
export type LiveTermKind = "block" | "allow";
export type LiveTermScope = "names" | "content" | "all";

export interface LiveModerationTerm {
  id: string;
  term: string;
  match: LiveTermMatch;
  kind: LiveTermKind;
  scope: LiveTermScope;
  note: string | null;
  created_at: string | null;
}

export interface LiveModerationTermInput {
  term: string;
  match: LiveTermMatch;
  kind: LiveTermKind;
  scope: LiveTermScope;
  note?: string | null;
}

export interface LiveAuditEvent {
  id: string | number;
  action: string;
  actor_email: string | null;
  actor_kind: string;
  session_id: string | null;
  quiz_id: string | null;
  target: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  created_at: string | null;
}
