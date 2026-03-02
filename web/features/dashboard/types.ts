import type { ExamStrategy, SessionMode } from "@/types/api";

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
  studyStrategy: "standard" | "adaptive";
  totalQuestions: number;
  timeLimitMinutes: number;
}
