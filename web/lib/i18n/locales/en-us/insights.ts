export const insights = {
  empty: {
    exams: "No simulations completed yet. Create a first block to populate this panel.",
    study: "No study blocks completed yet.",
    weakAreas: "Not enough history to detect gaps yet."
  },
  titles: {
    weakAreas: "Gaps and dependence by area",
    weakAreasSubtitle: "This block translates current history into study priority for certification.",
    queueAndActivity: "Review and activity queue",
    queueAndActivitySubtitle: "Quick visibility of what is pending and what has already been studied.",
    latestExams: "Latest simulations",
    latestStudy: "Last study blocks"
  },
  labels: {
    recentErrors: "{ratio}% recent errors",
    focus: "Focus",
    dueReviews: "Expired reviews",
    recentExams: "Recent simulations",
    studyBlocks: "Study blocks",
    mixedExam: "Mixed simulation",
    mixedStudy: "Mixed block",
    correctAnswers: "correct",
    strategy: "strategy",
    reviewedOn: "reviewed in {date}"
  }
} as const;
