export const theory = {
  title: "Theory review",
  subtitle: "Open the cited excerpt and re-read the concepts behind the question.",
  cardSubtitle: "Quick read of the excerpt referenced in the study material.",
  reviewQueue: "Review queue",
  dashboard: "Dashboard",
  pages: "pp. {start}-{end}",
  page: "p. {start}",
  noMaterial: "This excerpt has no valid material to open.",
  loading: "Loading the excerpt...",
  loginRequiredTitle: "Sign in to read the material",
  loginRequiredMessage: "The study material preview is only available to signed-in accounts.",
  notFound: "The cited material was not found on the server.",
  loadFailed: "We couldn't open the excerpt right now.",
  frameTitle: "Material excerpt: {label}",
  sections: {
    title: "Where to review",
    yourChoice: "Why option {key} isn't the answer",
    explanation: "The concept behind the question",
    readFull: "Read the full section",
    newTab: "(opens in a new tab)",
    practice: "Practice this section",
    practiceCount: "{count} question(s) linked to this section",
    practiceFailed: "Could not create the practice session.",
    source: "{book} · {pages}",
    sourceNoPages: "{book}"
  },
  reader: {
    back: "Back",
    up: "Parent section",
    navigation: "Section navigation",
    previous: "Previous section",
    next: "Next section",
    objectives: "Exam objectives: {codes}",
    truncated: "Excerpt shortened for reading. Continue with the subsections or the next section.",
    notFoundTitle: "Section not found",
    notFoundMessage: "This section does not exist in the material mounted on this server.",
    practiceHint: "After reading, practice with questions that depend on this section."
  },
  weak: {
    title: "Sections to reinforce",
    description: "The book sections that explain your mistakes, most urgent first.",
    empty: "When you miss questions, the book sections that explain each mistake show up here.",
    counts: "{open} open · {mistakes} mistake(s)",
    lastMistake: "Last mistake on {date}"
  }
} as const;
