export const quizReports = {
  metadata: {
    title: "Session results"
  },
  header: {
    context: "Results · PIN {code}",
    contextChallenge: "Results · link {code}",
    back: "Quiz sessions",
    meta: "Version {version} · {date}",
    generated: "Report generated {date}",
    exportCsv: "Export CSV",
    exporting: "Exporting…",
    exportError: "Could not export the CSV.",
    print: "Print",
    sections: "Report sections",
    live: "The session is still running; numbers may change.",
    refresh: "Refresh",
    rehearsalHint: "Rehearsal session. Bots are left out of this report and the CSV."
  },
  kpis: {
    title: "Summary",
    participants: "Participants",
    completion: "Completion",
    completionMeta: "answered 80% or more",
    engagement: "Engagement {value}",
    avgScore: "Average score",
    median: "Median {value}",
    avgTime: "Average response time",
    kr20: "Reliability (KR-20)",
    kr20Help: "About KR-20",
    kr20Explanation:
      "KR-20 measures how consistently the questions separate people who know more from people who know less. It ranges from 0 to 1: 0.70 or above is acceptable for a formative quiz. It needs at least 5 scored questions and 15 participants.",
    kr20Acceptable: "acceptable",
    kr20Low: "low",
    insufficient: "insufficient sample"
  },
  highlights: {
    title: "Highlights",
    flagged: "{count} questions need attention",
    none: "No question was flagged.",
    hardest: "Hardest: question {position} ({value} correct)"
  },
  domains: {
    title: "Score by domain",
    description: "The group's bands in this session. Not each learner's individual readiness.",
    meta: "{items} questions · {answers} answers",
    none: "No question in this session has a domain.",
    noCertification: "No certification",
    bands: {
      ready: "Ready",
      approaching: "Approaching",
      not_ready: "Needs work",
      insufficient_data: "Insufficient sample"
    }
  },
  items: {
    title: "Questions",
    description: "p = proportion correct; D = discrimination (top 27% minus bottom 27%). Open a row to see the options.",
    columns: {
      position: "No.",
      prompt: "Question",
      p: "p",
      d: "D",
      time: "Median time",
      flags: "Signals"
    },
    pLabel: "Difficulty p",
    dLabel: "Discrimination D",
    notScored: "No points",
    answered: "{count} answered",
    expand: "Show details for question {position}",
    collapse: "Hide details for question {position}",
    distractors: "Distribution by option",
    distractorsHint: "Bar = all participants. ▼ above the bar = top 27%; ▲ below = bottom 27%.",
    correct: "Correct",
    upper: "Top 27%",
    lower: "Bottom 27%",
    optionSummary: "{letter}: {pct} ({count})",
    dominant: "Option {letter} drew more than the correct one: review the prompt or the answer key.",
    topAnswers: "Most typed answers",
    accepted: "Accepted",
    notAccepted: "Not accepted",
    noOptions: "No options to show.",
    difficulty: {
      hard: "hard",
      ideal: "ideal",
      easy: "easy",
      too_easy: "too easy"
    },
    discrimination: {
      excellent: "excellent",
      good: "good",
      review: "review",
      negative: "suspicious"
    },
    flags: {
      too_easy: {
        label: "Too easy",
        explanation: "Over 90% got it right: the question barely separates who knows from who does not."
      },
      too_hard: {
        label: "Too hard",
        explanation: "Under 20% got it right: content not covered yet, a confusing prompt or a wrong answer key."
      },
      negative_discrimination: {
        label: "Negative discrimination",
        explanation: "Lower scorers got this right more often than top scorers. Check the answer key."
      },
      low_discrimination: {
        label: "Low discrimination",
        explanation: "The question barely separates the groups (D below 0.20). Consider rewriting the options."
      },
      distractor_dominant: {
        label: "Dominant distractor",
        explanation: "A wrong option was picked more than the correct one: a trap or a common misconception."
      }
    }
  },
  ga: {
    orderingTitle: "Accuracy by position",
    methods: {
      kendall: "Partial scoring (Kendall)",
      exact: "Only the exact order scores"
    },
    slotSummary: "Position {position}, {text}: {percent} right",
    orderingStats: "Exact order: {exact} · Average credit: {avg}",
    numericTitle: "Answer distribution",
    numericAnswer: "Answer: {value}",
    numericAnswerTolerance: "Answer: {value} (± {tolerance})",
    numericStats: "{n} answers · Mean: {mean} · Median: {median}",
    binSummary: "from {from} to {to}: {count}",
    wordsTitle: "Words sent",
    wordsDistinct: "{count} different",
    hidden: "hidden by the presenter",
    noWords: "No words were sent."
  },
  participants: {
    title: "Participants",
    description: "Final ranking. Select a column header to sort.",
    columns: {
      rank: "Rank",
      display_name: "Name",
      score: "Points",
      correct: "Correct",
      score_pct: "Score",
      avg_ms: "Average time"
    },
    guest: "Guest",
    sortBy: "Sort by {column}",
    correctOf: "{correct} of {answered}",
    none: "Nobody took part in this session."
  },
  empty: {
    title: "This session received no answers",
    message: "Once the room answers at least one question, the numbers show up here."
  },
  errors: {
    load: "Could not load the report.",
    notFound: "Session not found or has no report."
  },
  retention: {
    title: "Aggregate snapshot",
    text: "Raw data purged by the retention policy; this is the aggregate snapshot.",
    purgedAt: "Purged on {date}."
  }
} as const;
