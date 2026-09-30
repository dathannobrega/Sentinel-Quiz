/** Central react-query keys. Keep the first segment stable: auth changes invalidate by prefix. */
export const queryKeys = {
  currentUser: ["current-user"] as const,
  exams: ["exams"] as const,
  domains: (examId: string) => ["domains", examId] as const,
  questionSearch: (params: string) => ["question-search", params] as const,
  studyPlan: ["study-plan"] as const,
  studyModules: (certification: string) => ["study-modules", certification] as const,
  studyOverview: ["study-overview"] as const,
  weakAreas: ["analytics", "weak-areas"] as const,
  engagement: ["analytics", "engagement"] as const,
  readiness: ["analytics", "readiness"] as const,
  examHistory: (limit: number) => ["exam-history", limit] as const,
  studyHistory: (limit: number) => ["study-history", limit] as const,
  studyWeekly: (weeks: number) => ["study-weekly", weeks] as const,
  activeExamSessions: (limit: number) => ["active-sessions", "exam", limit] as const,
  activeStudySessions: (limit: number) => ["active-sessions", "study", limit] as const,
  reviewQueue: (params: string) => ["review-queue", params] as const,
  sessionReview: (mode: "exam" | "study", sessionId: string) => ["session-review", mode, sessionId] as const,
  studySection: (sectionId: string) => ["study-section", sectionId] as const,
  weakSections: (limit: number) => ["weak-sections", limit] as const
};
