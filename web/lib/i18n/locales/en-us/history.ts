export const history = {
  errors: {
    loadHistory: "Unable to load history now.",
    partialLoad: "Some blocks failed to load: {items}."
  },
  failedAreas: {
    exams: "evidence",
    examSessions: "simulated",
    study: "study",
    weekly: "weekly analysis",
    reviewQueue: "review queue"
  },
  header: {
    title: "History and analysis",
    subtitle: "Sessions, review and weekly rhythm separated by context."
  },
  filters: {
    title: "Filters",
    subtitle: "Refine reading without turning everything into a megapanel.",
    exam: "Exam",
    minimumScore: "Minimum grade",
    search: "Search"
  },
  tabs: {
    sessions: "Sessions",
    review: "Review",
    weeks: "Weeks"
  },
  sessions: {
    title: "Summary",
    subtitle: "Quick reading of recent volume.",
    filteredExams: "Filtered simulations",
    examAverage: "Average of simulations",
    studyAverage: "Study average",
    dueQueue: "Queue expired",
    totalQueue: "Total queue",
    nextReview: "Next review",
    examsTitle: "Simulations",
    examsSubtitle: "Each item opens the corresponding session review.",
    studiesTitle: "Study",
    studiesSubtitle: "Study blocks and more sensitive areas."
  },
  reviewPanel: {
    weeklyGoalTitle: "Weekly goal",
    weeklyGoalSubtitle: "A practical target for balancing new study and revision.",
    questionGoal: "Question target",
    reviewGoal: "Reviews target",
    newSuggested: "New suggested",
    completion: "Conclusion",
    forecastTitle: "Expected load",
    forecastSubtitle: "Anticipate peaks before becoming a backlog.",
    dueInSevenDays: "Expires in 7 days",
    enteringRisk: "They are at risk",
    peakDay: "Daily peak",
    pressure: "Pressure",
    queueTitle: "Review queue",
    queueSubtitle: "Items with the highest back pressure appear first."
  },
  weeksPanel: {
    title: "Weekly rhythm",
    subtitle: "Volume, reviews and quality per week."
  },
  labels: {
    mixedSession: "Mixed session",
    mixedBlock: "Mixed block",
    noExams: "No exams match the current filters.",
    noStudies: "No study blocks match the current filters.",
    examRowMeta: "{correct}/{total} correct · {date}",
    studyRowMeta: "strategy {strategy} · {date}",
    belowGoal: "You are below the goal",
    onTrack: "Weekly pace on track",
    nextStepDaily: "Next step: {newCount} new + {reviewCount} review(s) per day.",
    pressureDefault: "stable",
    forecastDay: "{due} due · {risk} becoming at risk",
    noUpcoming: "No relevant upcoming load right now.",
    weekMeta: "Study: {study} · Review: {review} · Sessions: {sessions}",
    weekAccuracy: "{value}% accuracy",
    noWeeks: "Not enough weekly data yet."
  }
} as const;
