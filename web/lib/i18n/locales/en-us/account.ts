export const account = {
  scope: {
    user: "Synced account",
    device: "This device only"
  },
  card: {
    title: "Account and sync",
    subtitle: "Sync progress across devices without losing local fallback."
  },
  summary: {
    ariaLabel: "Account Summary",
    bookmarks: "Bookmarks",
    notes: "Notes",
    dueReviews: "Expired reviews"
  },
  lists: {
    updatedAt: "Updated in {date}",
    recentBookmarks: "Recent Bookmarks",
    recentNotes: "Recent notes",
    reviewQueue: "Review queue",
    noBookmarks: "No bookmarks saved yet.",
    noNotes: "No notes saved yet.",
    noDueReviews: "No reviews due at this time."
  },
  guest: {
    localModeTitle: "Active local mode",
    localModeMessage:
      "You can still use your current device, but your progress is not synced across browsers.",
    signInTitle: "Authenticate to consolidate history",
    signInMessage:
      "When you sign in, the backend associates sessions, bookmarks, notes, and reviews from this device with your account."
  },
  user: {
    roleLabel: "paper",
    sinceLabel: "since"
  }
} as const;
