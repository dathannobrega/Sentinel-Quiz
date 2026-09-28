export const results = {
  errors: {
    loadResult: "The result of this session could not be loaded.",
    bannerTitle: "Unable to load result",
    missingReview: "The session returned no review data."
  },
  insights: {
    answered: "Answered: {count}",
    accuracy: "Accuracy: {value}%",
    averagePerQuestion: "Average per question: {value}s",
    weakestDomain: "Most sensitive domain: {label}",
    weakestDomainWithErrors: "Most sensitive domain: {label} ({count} error(s))",
    reviewDueAfter: "Queue expired after block: {count}"
  },
  readiness: {
    excellent: "Excellent",
    good: "Good",
    ok: "Okay",
    tuning: "In adjustment"
  },
  citations: {
    openMaterial: "Open material"
  },
  reviewBlock: {
    question: "Question {number}",
    noMetadata: "No metadata",
    correct: "Correct",
    wrong: "Wrong",
    correctSuffix: " (correct)",
    selectedSuffix: " (your choice)"
  },
  header: {
    title: "Session result",
    mixedSession: "Mixed session",
    completedAt: "completed in {date}"
  },
  summary: {
    studyTitle: "{score} study performance",
    examTitle: "score {score} · readiness {readiness}",
    strategySubtitle: "Strategy {strategy}.",
    minutes: "{value} min",
    score: "Score",
    readiness: "Readiness",
    correct: "Hits",
    wrong: "Errors",
    answered: "Answered",
    questions: "Questions",
    timeUsed: "Time used",
    timeLimit: "Limit",
    timedOutTitle: "Simulation ended by time",
    timedOutMessage:
      "The backend applied auto-submit when the timer reset. Review the incorrect and unanswered items first."
  },
  reviewCard: {
    title: "Guided review",
    subtitle: "Open each question only when you need to review the detail.",
    questionCount: "{count} questions",
    empty: "No questions were found for this review."
  },
  readinessCard: {
    title: "Readiness Score",
    subtitle: "Current {current} · projected {projected}",
    band: "Range",
    suggestedSession: "Suggested session",
    trackedBase: "Base tracked",
    byDomain: "Domain by domain",
    accuracy: "hit {value}",
    pace: "rhythm {value}",
    lowConfidence: "low confidence {count}",
    attempts: "{count} attempt(s)"
  },
  timingCard: {
    title: "Session rhythm",
    subtitle: "Speed and dispersion now explicitly enter the readiness reading.",
    duration: "Duration",
    averagePerQuestion: "Average per question",
    fastest: "Faster",
    slowest: "Slower"
  },
  studyPlanCard: {
    title: "Recommended plan (15-45 min)",
    subtitle: "Prioritize the highest friction domains and jump straight into focused review.",
    openReview: "Start review",
    openReferences: "Open references",
    itemTitle: "{domain} · {wrong}/{total} wrong · {score}"
  },
  tutor: {
    title: "Question tutor",
    explain: "Explain to me",
    whyWrong: "Why was I wrong?",
    reviewTopic: "Review subject",
    loading: "Consulting tutor...",
    unavailable: "Tutor unavailable",
    blocked: "Tutor blocked this review",
    answered: "Tutor replied",
    authRequired: "Sign in to use the AI tutor.",
    lockedDuringExam: "The tutor becomes available after the exam is finished.",
    quotaExceeded: "You reached the tutor's daily quota. Try again tomorrow.",
    quotaExceededRetry: "You reached the tutor quota. Try again in {seconds}s.",
    upstream: "The AI tutor is temporarily unavailable. Please try again shortly.",
    signIn: "Sign in to use the tutor"
  },
  issueReport: {
    title: "Report issue",
    clarity: "Clarity",
    answerKey: "Answer key",
    explanation: "Explanation",
    reference: "Reference",
    send: "Send report",
    success: "Report sent to the editorial backlog.",
    failure: "Unable to report this issue now.",
    categoryLabel: "Report category",
    messageLabel: "Describe the problem (min. 8 characters)"
  }
} as const;
