export const password = {
  forgot: {
    title: "Recover password",
    subtitle: "Request a secure link to reset your password.",
    emailRequiredTitle: "Mandatory email",
    emailRequiredMessage: "Enter your account email to continue.",
    requestedTitle: "Request registered",
    requestedMessage: "If the account exists, an email with the reset link has been sent.",
    failedTitle: "Failed to request",
    failedMessage: "Unable to start recovery.",
    emailLabel: "Email",
    submit: "Send link",
    backToLogin: "Back to login"
  },
  reset: {
    title: "Set new password",
    subtitle: "Use the link received by email to complete the reset.",
    missingTokenMessage: "The reset link is incomplete.",
    invalidPasswordMessage: "Use at least 8 characters.",
    updatedTitle: "Updated password",
    updatedMessage: "Your password has been reset. Log in again with the new credential.",
    failedTitle: "Failed to reset",
    failedMessage: "Unable to reset password.",
    passwordLabel: "New password",
    passwordHint: "Minimum 8 characters.",
    submit: "Update password"
  },
  verify: {
    title: "Email verification",
    subtitle: "Identity confirmation to strengthen the account.",
    missingTokenMessage: "The verification link is incomplete.",
    successTitle: "Verified email",
    successMessage: "Email {email} was successfully validated.",
    failedTitle: "Verification failed",
    failedMessage: "Unable to validate email.",
    goToLogin: "Go to login"
  }
} as const;
