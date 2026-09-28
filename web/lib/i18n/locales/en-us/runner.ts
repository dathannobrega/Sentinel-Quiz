export const runner = {
  errors: {
    loadSession: "This session could not be loaded.",
    openSessionTitle: "Unable to open session",
    examPausedTitle: "Simulation paused",
    examPausedMessage: "Responses are blocked while pause is active."
  },
  navigator: {
    title: "Navigation",
    examTitle: "Exam navigator",
    minimalSubtitle: "Lean flow, without pedagogical resources.",
    examSubtitle: "Go back and forth freely before submitting.",
    pending: "Pending: {count}",
    flagged: "Marked: {count}",
    loading: "Loading test status...",
    empty: "No browser data yet."
  },
  examDay: {
    tag: "Exam day",
    activeTitle: "Test mode active",
    activeMessage: "Instant correction, tutor, references and quick exits have been reduced to simulate test day.",
    answerRecordedTitle: "Answer recorded",
    answerRecordedMessage: "In exam mode, the answer key and detailed analysis appear only after final submission."
  },
  tags: {
    markedForReview: "Marked for review"
  },
  actions: {
    unmarkReview: "Unmark review",
    markReview: "Mark for review",
    previous: "Previous",
    confirmAnswer: "Confirm answer"
  },
  tutor: {
    title: "Question tutor",
    subtitle: "Available after answering, without leaving the test.",
    explain: "Explain to me",
    whyWrong: "Why was I wrong?",
    reviewTopic: "Review subject"
  },
  issueReport: {
    title: "Report issue",
    subtitle: "This feeds the editorial backlog.",
    category: "Category",
    detail: "Detail",
    clarity: "Clarity",
    answerKey: "Answer key",
    explanation: "Explanation",
    reference: "Reference",
    send: "Send report",
    success: "Report sent to the editorial backlog."
  },
  header: {
    studyTitle: "Study mode",
    examTitle: "Exam mode",
    subtitle: "Question at the center. Support tools on the side."
  },
  questionCard: {
    title: "Question {current} from {total}",
    singleSelect: "Select an alternative.",
    multiSelect: "Select all correct alternatives.",
    optionsAriaLabel: "Alternatives",
    answered: "{count} answered",
    examSummary: "{correct} correct · {wrong} errors",
    paused: "Paused",
    time: "Time"
  },
  feedback: {
    correct: "Correct answer",
    wrong: "Incorrect answer",
    missingJustification: "No justification given for this issue. Review the topic and move on to the next one."
  },
  labels: {
    confidence: "Confidence",
    noActiveQuestion: "No active questions found for this session.",
    tools: "Tools",
    hints: "Hints",
    hintsSubtitle: "Open only when you need a push.",
    notes: "Notes",
    notesSubtitle: "Mark and record context only when useful.",
    references: "References",
    referencesHintAria: "References suggested by the hint",
    referencesOfficialAria: "Official references",
    questionToolsAria: "Question tools",
    level: "Level {level}",
    openExcerpt: "Open snippet",
    reviewLater: "Mark for later review",
    note: "Note",
    save: "Save",
    reload: "Reload",
    examFocusOnly: "In the simulation, stay focused on the question. The detailed review appears in the final result."
  },
  notices: {
    loadingStudyState: "Loading study status...",
    savingStudyState: "Saving study status...",
    syncedAt: "Synced at {date} ({scope}).",
    noSavedNotes: "No saved notes yet ({scope}).",
    savedAt: "Saved at {date} ({scope}).",
    syncedStatus: "Status synced ({scope}).",
    saveFailed: "Unable to save: {error}",
    examPaused: "Simulation paused. The timer was frozen within the configured limit.",
    examResumed: "Simulation resumed. The timer started counting again."
  },
  studyState: {
    pendingChanges: "Pending changes..."
  },
  hints: {
    hintButton: "Hint {level}"
  },
  liveFeedback: {
    remaining: "Remaining: {count}",
    currentStreak: "Current streak: {count}",
    uncertainCorrect: "Correct but uncertain: keep it in the reinforcement signal.",
    nextReview: "Next review: {date}",
    dueQueue: "Due queue: {count}"
  }
} as const;
