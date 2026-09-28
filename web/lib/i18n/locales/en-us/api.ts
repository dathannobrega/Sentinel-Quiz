export const api = {
  timeout: "The request took longer than expected. Please try again.",
  offline: "You appear to be offline. Check your connection and try again.",
  network: "We couldn't reach the server right now. Please try again shortly.",
  blocked:
    "We couldn't reach the server. The request may have been blocked (CORS, proxy or a browser extension) or the server is down.",
  badRequest: "The request could not be processed.",
  unauthorized: "Your session expired or you need to sign in to continue.",
  forbidden: "You don't have permission for this action.",
  notFound: "The requested resource was not found.",
  conflict: "This action conflicts with the current state. Refresh and try again.",
  tooLarge: "The submitted content is too large.",
  validation: "Some fields are invalid. Review them and try again.",
  rateLimited: "Too many requests in a short time. Wait a moment and try again.",
  rateLimitedRetry: "Too many requests in a short time. Try again in {seconds}s.",
  unavailable: "The server is temporarily unavailable. Please try again shortly.",
  server: "The server hit an unexpected error.",
  httpStatus: "Request failed (HTTP {status}).",
  unexpected: "An unexpected error occurred."
} as const;
