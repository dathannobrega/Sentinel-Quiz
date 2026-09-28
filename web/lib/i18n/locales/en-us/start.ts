export const start = {
  errors: {
    searchUnavailable: "Question search unavailable: {message}",
    unexpected: "An unexpected error has occurred.",
    createSessionTitle: "Unable to create session",
    invalidQuantityTitle: "Invalid quantity",
    invalidQuantityMessage: "Enter at least 1 question.",
    quantityLimitTitle: "Quantity above limit",
    quantityLimitMessage: "The current limit for {mode} is {count} questions.",
    invalidTimeTitle: "Invalid time",
    invalidTimeMessage: "Use between 5 and 360 minutes."
  },
  notices: {
    loadingDomainsTitle: "Updating domains",
    loadingDomainsMessage: "Loading certification filters."
  },
  header: {
    title: "Start",
    subtitle: "Build a short block, start quickly and leave the rest on demand."
  },
  discovery: {
    summary: "Explore question bank",
    foundCount: "{count} found(s)",
    title: "Discover issues",
    subtitle: "Only look in the bank when you need to refine the cut.",
    query: "Text",
    domain: "Domain",
    tag: "Tag",
    queryPlaceholder: "Ex.: cryptography, asset, incident",
    tagPlaceholder: "Example: access control",
    bookmarkedOnly: "Just marked",
    notesOnly: "Only with note",
    resultsAriaLabel: "Question search results",
    loading: "Updating results...",
    empty: "No issues found with current filters."
  }
} as const;
