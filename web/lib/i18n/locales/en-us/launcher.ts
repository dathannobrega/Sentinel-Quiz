export const launcher = {
  card: {
    title: "Start",
    subtitle: "Choose the essentials and get started in just a few seconds."
  },
  fields: {
    certification: "Certification",
    mode: "Mode",
    questions: "Questions",
    timeMinutes: "Time (min)",
    experienceMode: "Experience",
    experienceModeHint: "Exam day simulates the real test: no instant feedback, tutor or hints until you submit.",
    advancedFilters: "Advanced filters",
    domain: "Domain",
    strategy: "Strategy",
    difficulty: "Difficulty",
    tags: "Tags",
    pbqCount: "PBQs",
    pbqCountHint:
      "Performance-based questions (interactive simulations) at the start of the session, as in the real exam."
  },
  pbqCount: {
    none: "None",
    option: "{count} PBQ(s)"
  },
  advanced: {
    active: "assets",
    optional: "optional"
  },
  presets: {
    title: "Presets",
    summaryTitle: "Preset summary",
    items: {
      placement: {
        title: "Initial diagnosis",
        summary: "20 adaptive questions to create your baseline per domain."
      },
      daily_review: {
        title: "Recommended daily review",
        summary: "10 questions to reinforce memory and confidence."
      },
      quick_15: {
        title: "Quick simulation 15 min",
        summary: "15 questions in 15 minutes to measure retention."
      },
      comptia_exam: {
        title: "CompTIA test mode",
        summary: "45 questions focusing on blueprint and exam pressure."
      },
      sprint_25: {
        title: "Sprint 25 min",
        summary: "20 adaptive questions to keep pace without overload."
      },
      risk_focus: {
        title: "Evidence risk",
        summary: "Short, focused block to attack the most sensitive domain now."
      },
      custom: {
        title: "Custom",
        summary: "Manually adjust the filters and assemble a custom block."
      }
    }
  },
  experienceModes: {
    standard: "Standard (with feedback)",
    examDay: "Exam day"
  },
  filters: {
    bookmarked: "Marked",
    notes: "With note",
    incorrect: "Wrong",
    unseen: "News",
    lowConfidence: "Low confidence"
  },
  summary: {
    title: "Your session",
    settings: "Settings",
    minutes: "{count} min",
    noTimer: "No timer"
  },
  actions: {
    createStudyBlock: "Create study block",
    createExam: "Create simulation"
  }
} as const;
