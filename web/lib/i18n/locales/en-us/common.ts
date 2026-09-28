export const common = {
  appName: "Sentinel Quiz",
  labels: {
    dashboard: "Dashboard",
    start: "Start",
    review: "Review",
    history: "History",
    settings: "Settings",
    admin: "Admin",
    exam: "Exam",
    study: "Study"
  },
  actions: {
    signIn: "Sign in",
    signOut: "Sign out",
    createAccount: "Create account",
    refresh: "Refresh",
    continue: "Continue",
    retry: "Try again",
    openHistory: "Open history",
    reviewNow: "Review now",
    newSession: "New session",
    seeDetails: "View details",
    resume: "Resume",
    pause: "Pause",
    goToDashboard: "Go to dashboard",
    backToDashboard: "Back to dashboard",
    openResult: "Open result",
    resendVerification: "Resend verification",
    startFree: "Start free",
    seeDemo: "View demo",
    alreadyHaveAccount: "I already have an account",
    goToStart: "Start new session",
    nextQuestion: "Next question",
    viewResult: "See result"
  },
  status: {
    marked: "marked",
    withNote: "with note",
    loading: "Loading...",
    syncingSession: "Syncing session...",
    updating: "Updating",
    upToDate: "Up to date",
    closed: "Closed"
  },
  filters: {
    all: "All",
    everything: "Everything",
    allDomains: "All domains",
    mixedRandom: "Mix them all (random)",
    selectExam: "Select an exam"
  },
  reviewStates: {
    dueToday: "Due today",
    overdue: "Late",
    atRisk: "At risk",
    scheduled: "Scheduled",
    mastered: "Mastered"
  },
  strategies: {
    standard: "Standard",
    adaptive: "Adaptive"
  },
  confidence: {
    guess: "I guessed",
    notSure: "I'm not sure",
    confident: "I'm sure"
  },
  errors: {
    unexpected: "An unexpected error has occurred.",
    attention: "Attention",
    partialLoad: "Partial load",
    sessionUnavailable: "Session unavailable",
    authFailure: "Authentication failure",
    requiredFields: "Required fields",
    invalidPassword: "Invalid password",
    missingToken: "Missing Token"
  }
} as const;
