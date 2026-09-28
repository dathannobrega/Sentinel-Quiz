export const review = {
  errors: {
    loadQueue: "Unable to load review queue."
  },
  header: {
    title: "Review",
    subtitle: "Prioritize what’s due now and keep the queue under control."
  },
  todayCard: {
    title: "Today's queue",
    subtitle: "A single main action: review what is already due.",
    due: "Overdue",
    total: "Total in queue",
    suggestedBatch: "Suggested lot"
  },
  filters: {
    title: "Refine queue",
    subtitle: "Adjust the cropping without turning the review into a cumbersome panel.",
    certification: "Certification",
    state: "Crop",
    refine: "Refining",
    bookmarksOnly: "Only marked",
    notesOnly: "Only with note"
  },
  priorityCard: {
    title: "Prioritized items",
    subtitle: "The most sensitive items are at the top."
  },
  empty: "No pending review items at this time.",
  queueState: {
    overdue: "late {days} day(s) ago",
    dueToday: "due today",
    atRisk: "expires within 48 hours",
    mastered: "already consolidated",
    scheduledFor: "scheduled for {date}",
    scheduled: "scheduled"
  }
} as const;
