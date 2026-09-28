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
    advancedFilters: "Advanced filters",
    domain: "Domain",
    strategy: "Strategy",
    difficulty: "Difficulty",
    tags: "Tags"
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
  filters: {
    bookmarked: "Marked",
    notes: "With note",
    incorrect: "Wrong",
    unseen: "News",
    lowConfidence: "Low confidence"
  },
  actions: {
    createStudyBlock: "Create study block",
    createExam: "Create simulation"
  }
} as const;
