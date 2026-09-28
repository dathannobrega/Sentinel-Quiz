export const system = {
  busy: "Working...",
  loading: "Loading...",
  errorBoundary: {
    title: "Something went wrong",
    message: "This screen hit an unexpected error. You can try again or go back to the start.",
    retry: "Try again",
    home: "Back to home",
    reference: "Reference: {digest}"
  },
  notFound: {
    title: "Page not found",
    message: "The address you opened does not exist or has moved.",
    home: "Go to home",
    dashboard: "Open dashboard"
  },
  confirm: {
    confirm: "Confirm",
    cancel: "Cancel"
  },
  authRequired: {
    title: "Sign in to continue",
    message: "This feature requires an authenticated account.",
    signIn: "Sign in"
  },
  loadFailed: {
    title: "Could not load",
    retry: "Try again"
  },
  field: {
    hintLabel: "Help: {label}"
  },
  metadata: {
    dashboard: "Dashboard",
    start: "Start session",
    review: "Review",
    history: "History",
    settings: "Settings",
    admin: "Administration",
    adminEditor: "Question editor",
    login: "Sign in",
    register: "Create account",
    forgotPassword: "Recover password",
    resetPassword: "Reset password",
    verifyEmail: "Verify email",
    theory: "Theory review",
    exam: "Exam",
    study: "Study session",
    examResult: "Exam result",
    studyResult: "Study result"
  }
} as const;
