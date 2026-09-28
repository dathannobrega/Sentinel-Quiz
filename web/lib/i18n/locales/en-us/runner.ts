export const runner = {
  errors: {
    loadSession: "This session could not be loaded.",
    openSessionTitle: "Unable to open session",
    examPausedTitle: "Exam paused",
    examPausedMessage: "Answers are locked while the pause is active.",
    actionFailed: "This action could not be completed.",
    hintFailed: "The hint could not be loaded.",
    notesFailed: "Your notes could not be loaded."
  },
  navigator: {
    title: "Navigation",
    examTitle: "Exam navigator",
    minimalSubtitle: "Lean flow, without learning aids.",
    examSubtitle: "Move back and forth freely before submitting.",
    pending: "Pending: {count}",
    flagged: "Marked: {count}",
    loading: "Loading exam status...",
    empty: "No navigator data yet.",
    listLabel: "Exam questions",
    itemLabel: "Question {number}",
    itemAnswered: "answered",
    itemUnanswered: "unanswered",
    itemMarked: "marked for review",
    itemCurrent: "current"
  },
  examDay: {
    tag: "Exam day",
    activeTitle: "Exam-day mode active",
    activeMessage: "Instant grading, tutor, references and quick exits are reduced to simulate exam day.",
    answerRecordedTitle: "Answer recorded",
    answerRecordedMessage: "In exam-day mode, the answer key and detailed analysis appear only after final submission.",
    subtitle: "Exam-day mode: no instant grading and no learning aids.",
    answeredOfTotal: "{answered}/{total} answered"
  },
  tags: {
    markedForReview: "Marked for review"
  },
  actions: {
    unmarkReview: "Unmark review",
    markReview: "Mark for review",
    previous: "Previous",
    confirmAnswer: "Confirm answer",
    submitExam: "Submit exam"
  },
  submitConfirm: {
    title: "Submit the exam now?",
    message:
      "You answered {answered} of {total} questions ({unanswered} unanswered, {marked} marked for review). Answers cannot be changed after submitting.",
    confirm: "Submit exam",
    cancel: "Keep answering"
  },
  keyboard: {
    help: "Shortcuts: arrow keys move between options, Space or Enter selects, and keys A–E or 1–5 pick an option directly."
  },
  announce: {
    question: "Question {current} of {total}",
    answerCorrect: "Correct answer.",
    answerWrong: "Incorrect answer.",
    answerRecorded: "Answer recorded."
  },
  option: {
    correct: "Correct",
    wrong: "Incorrect",
    answerKey: "Answer key",
    optionLabel: "Option {key}"
  },
  timer: {
    label: "Time remaining: {time}",
    pausedLabel: "Time paused: {time}",
    fiveMinutes: "5 minutes remaining.",
    oneMinute: "1 minute remaining.",
    expired: "Time is up. Finishing the exam..."
  },
  tutor: {
    title: "Question tutor",
    subtitle: "AI explanations about the answered question.",
    explain: "Explain it",
    whyWrong: "Why was I wrong?",
    reviewTopic: "Review the topic",
    lockedDuringExam: "The tutor unlocks once you finish the exam, so it doesn't interfere with the attempt. Use it on the result screen.",
    authRequired: "Sign in to use the AI tutor.",
    signIn: "Sign in",
    quotaExceeded: "You reached the tutor's daily limit. Try again tomorrow.",
    quotaRetry: "You reached the tutor limit. Try again in {seconds}s.",
    unavailable: "The AI tutor is temporarily unavailable. Please try again shortly.",
    thinking: "The tutor is analyzing the question, this may take a few seconds...",
    replyLabel: "Tutor reply"
  },
  issueReport: {
    title: "Report issue",
    subtitle: "This feeds the editorial backlog.",
    category: "Category",
    detail: "Detail",
    detailHint: "Describe the problem with at least 8 characters.",
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
    title: "Question {current} of {total}",
    singleSelect: "Select one option.",
    multiSelect: "Select all correct options.",
    optionsAriaLabel: "Options",
    answered: "{count} answered",
    examSummary: "{correct} correct · {wrong} wrong",
    paused: "Paused",
    time: "Time"
  },
  feedback: {
    correct: "Correct answer",
    wrong: "Incorrect answer",
    missingJustification: "No explanation is registered for this question. Review the topic and move on to the next one."
  },
  labels: {
    confidence: "Confidence",
    noActiveQuestion: "No active question found for this session.",
    tools: "Tools",
    hints: "Hints",
    hintsSubtitle: "Open only when you need a nudge.",
    notes: "Notes",
    notesSubtitle: "Bookmark and record context only when useful.",
    references: "References",
    referencesHintAria: "References suggested by the hint",
    referencesOfficialAria: "Official references",
    questionToolsAria: "Question tools",
    level: "Level {level}",
    openExcerpt: "Open excerpt",
    reviewLater: "Mark for later review",
    note: "Note",
    save: "Save",
    reload: "Reload",
    examFocusOnly: "In the exam, stay focused on the question. The detailed review appears in the final result.",
    scopeDevice: "device",
    scopeUser: "account"
  },
  notices: {
    loadingStudyState: "Loading study status...",
    savingStudyState: "Saving study status...",
    syncedAt: "Synced at {date} ({scope}).",
    noSavedNotes: "No saved notes yet ({scope}).",
    savedAt: "Saved at {date} ({scope}).",
    syncedStatus: "Status synced ({scope}).",
    saveFailed: "Unable to save: {error}",
    examPaused: "Exam paused. The timer is frozen within the configured limit.",
    examResumed: "Exam resumed. The timer is counting again."
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
    uncertainCorrect: "Correct but uncertain: it stays as a reinforcement signal.",
    nextReview: "Next review: {date}",
    dueQueue: "Due queue: {count}"
  }
} as const;
