import type { ExamStrategy, ExperienceMode, SessionMode } from "@/types/api";

export type LaunchPresetKey = "placement" | "daily_review" | "quick_15" | "comptia_exam" | "sprint_25" | "risk_focus" | "custom";

export type NoticeTone = "neutral" | "success" | "warning" | "danger";

export interface DashboardNotice {
  tone: NoticeTone;
  title: string;
  message: string;
}

export interface LaunchFormValues {
  examId: string;
  domain: string;
  difficultyQuery: string;
  tagQuery: string;
  bookmarkedOnly: boolean;
  notesOnly: boolean;
  incorrectOnly: boolean;
  unseenOnly: boolean;
  lowConfidenceOnly: boolean;
  mode: SessionMode;
  examStrategy: ExamStrategy;
  experienceMode: ExperienceMode;
  studyStrategy: "standard" | "adaptive";
  totalQuestions: number;
  timeLimitMinutes: number;
  /** PBQs at the start of the session (0–5), sent as `pbq_count`. */
  pbqCount: number;
}
