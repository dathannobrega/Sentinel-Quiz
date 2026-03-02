import type { ExamStrategy, SessionMode } from "@/types/api";

export type NoticeTone = "neutral" | "success" | "warning" | "danger";

export interface DashboardNotice {
  tone: NoticeTone;
  title: string;
  message: string;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

export interface RegisterFormValues {
  displayName: string;
  email: string;
  password: string;
}

export interface LaunchFormValues {
  examId: string;
  domain: string;
  mode: SessionMode;
  examStrategy: ExamStrategy;
  studyStrategy: "standard" | "adaptive";
  totalQuestions: number;
}
