export const auth = {
  errors: {
    authUnavailable: "Unable to complete authentication."
  },
  notices: {
    sessionUnavailable: "Session unavailable",
    sessionStarted: "Logged in",
    accountCreated: "Account created",
    localMerged: "This device's local progress has been linked to your account where applicable.",
    loggedOut: "Session closed",
    localMode: "You are back in local mode for this device.",
    verificationResent: "Verification resent",
    verificationResentMessage: "If the email exists and is active, you will receive a new verification link.",
    resendFailed: "Failed to resend",
    logoutFailed: "Failed to exit"
  },
  hero: {
    loginEyebrow: "Secure session",
    registerEyebrow: "Account creation",
    loginTitle: "Sign in to sync your progress.",
    registerTitle: "Create your account and continue from any device.",
    lead:
      "Authentication uses HttpOnly cookie on the backend. When you sign in, the system associates local history, bookmarks, notes, and pending reviews with your account without exposing the session in localStorage.",
    benefitsAriaLabel: "Account benefits"
  },
  stats: [
    {
      label: "Synchronization",
      value: "Account",
      meta: "Unified history, review and progress."
    },
    {
      label: "Security",
      value: "HttpOnly",
      meta: "Session protected via cookie and typed backend."
    },
    {
      label: "Continuity",
      value: "Auto-merge",
      meta: "The current device is committed when applicable."
    },
    {
      label: "Access",
      value: "Web",
      meta: "Ready for study, simulations and guided review."
    }
  ],
  form: {
    loginTitle: "Sign in",
    registerTitle: "Create account",
    loginSubtitle: "Use the same account to resume studies and simulations in any browser.",
    registerSubtitle: "Create an account to save your progress and unlock protected flows.",
    requiredMessage: "Fill in your email and password before continuing.",
    invalidPasswordMessage: "Use at least 8 characters to create the account.",
    name: "Name",
    nameHint: "Optional. Makes it easier to identify the account.",
    email: "Email",
    password: "Password",
    loginPasswordHint: "Use your existing account password.",
    registerPasswordHint: "Minimum 8 characters.",
    goToRegister: "Go to registration",
    forgotPassword: "Forgot password"
  },
  account: {
    roleLabel: "paper",
    emailVerified: "Verified email",
    emailPending: "Pending Email"
  },
  flow: {
    title: "What happens when authenticating",
    subtitle: "Flow designed to preserve data and avoid rework.",
    steps: [
      {
        title: "1. Secured session on the backend",
        description:
          "Login establishes the main session via HttpOnly cookie and keeps the token in memory for transient support only."
      },
      {
        title: "2. Local progress merge",
        description:
          "Sessions, bookmarks, notes, and review queue items from your current device can be associated with your account automatically."
      },
      {
        title: "3. Continuity between devices",
        description:
          "After logging in, the dashboard, history and study modes now reflect the scope of the account."
      }
    ]
  }
} as const;
