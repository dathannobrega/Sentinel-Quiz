export const dashboard = {
  defaults: {
    recommendedNextAction: "Start a short session to get back into the swing of things."
  },
  loadError: "Not everything loaded: {items}.",
  failedAreas: {
    weakAreas: "gaps",
    pace: "rhythm",
    review: "review",
    history: "history",
    examSessions: "simulation sessions",
    studySessions: "study sessions",
    readiness: "readiness",
    studyPlan: "study plan"
  },
  modes: {
    examMixed: "Mixed simulation",
    studyMixed: "Mixed study"
  },
  header: {
    title: "Today",
    subtitle: "Your focus today: review what won and maintain consistency."
  },
  todayCard: {
    title: "Today",
    subtitle: "One main action: cleaning up what has expired.",
    dueReviews: "Expired reviews",
    dailyProgress: "Daily progress",
    latestScore: "Last score",
    nextStep: "Next step",
    readiness: "Readiness",
    projection: "projection {value}"
  },
  continueCard: {
    title: "Continue",
    subtitle: "Return only to what still makes sense.",
    empty: "No active sessions. Open a new block whenever you want."
  },
  weakAreasCard: {
    title: "Weaknesses",
    subtitle: "Only the most useful signals to decide the next block.",
    empty: "Not enough history to highlight gaps yet."
  },
  summaryCard: {
    title: "Quick Summary",
    subtitle: "Minimum context so as not to miss a beat.",
    currentStreak: "Current streak",
    bestStreak: "Best streak",
    week: "Week",
    reviewGoal: "Review goal",
    nextReview: "Next review",
    update: "Update"
  },
  planCard: {
    title: "My plan",
    subtitle: "The next best action is always visible.",
    placementPending: "Pending diagnosis"
  },
  weekCard: {
    title: "This week",
    subtitle: "Progress and revision pressure in a short summary.",
    reviewBacklog: "Backlog",
    weeklyProgress: "Weekly goal",
    reviewGoal: "Review goal"
  },
  masteryCard: {
    title: "Mastery by domain",
    subtitle: "Readiness now shows gaps per domain, with accuracy, confidence and pace.",
    accuracy: "accuracy {value}",
    attempts: "{count} attempt(s)",
    pace: "pace {value}",
    lowConfidence: "low confidence {count}"
  }
} as const;
