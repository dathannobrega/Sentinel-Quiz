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
  verification: {
    checkEmailTitle: "Check your e-mail",
    checkEmailMessage:
      "If an account can be created for {email}, we sent a confirmation link. Open it to activate the account and sign in.",
    checkEmailHint: "Didn't get it? Check your spam folder or resend the link in a few minutes.",
    resend: "Resend verification e-mail",
    useAnotherEmail: "Use another e-mail",
    notVerifiedTitle: "E-mail not verified yet",
    notVerifiedMessage: "Confirm your e-mail using the link we sent before signing in. You can request a new link below."
  },
  account: {
    roleLabel: "role",
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
