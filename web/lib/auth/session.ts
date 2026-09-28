import { ApiError, apiClient } from "@/lib/api/client";
import { clearStoredAuthToken, setStoredAuthToken } from "@/lib/auth/storage";
import type {
  AuthTokenResponse,
  AuthUser,
  EmailChallengeConsumeRequest,
  EmailChallengeRequest,
  PasswordResetRequest
} from "@/types/api";

/** Name of the HttpOnly session cookie issued by the backend (contract §2). */
export const SESSION_COOKIE_NAME = "sentinel_session";

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Returns the authenticated user, or null for anonymous visitors (401). */
export async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    return await apiClient.get<AuthUser>("/auth/me", {
      retryOnUnauthorized: false,
      notifyUnauthorized: false,
      signal
    });
  } catch (error) {
    if (isUnauthorized(error)) {
      clearStoredAuthToken();
      return null;
    }
    throw error;
  }
}

function rememberOptionalToken(response: AuthTokenResponse): void {
  // The session lives in the HttpOnly cookie. Older backends also return the token in the
  // body; keep it only in memory as a Bearer fallback when present.
  if (response.token) {
    setStoredAuthToken(response.token);
  } else {
    clearStoredAuthToken();
  }
}

export async function loginUser(payload: { email: string; password: string }): Promise<AuthUser> {
  const response = await apiClient.post<AuthTokenResponse>("/auth/login", payload, {
    retryOnUnauthorized: false,
    notifyUnauthorized: false
  });
  rememberOptionalToken(response);
  return response.user;
}

export async function registerUser(payload: {
  email: string;
  password: string;
  display_name?: string | null;
}): Promise<AuthUser> {
  const response = await apiClient.post<AuthTokenResponse>("/auth/register", payload, {
    retryOnUnauthorized: false,
    notifyUnauthorized: false
  });
  rememberOptionalToken(response);
  return response.user;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiClient.post<{ ok: boolean }>("/auth/logout", undefined, { notifyUnauthorized: false });
  } catch {
    // The local cleanup below is still authoritative.
  } finally {
    clearStoredAuthToken();
  }
}

export async function requestEmailVerification(payload: EmailChallengeRequest): Promise<void> {
  await apiClient.post<{ ok: boolean }>("/auth/request-email-verification", payload, {
    retryOnUnauthorized: false
  });
}

export async function verifyEmailToken(payload: EmailChallengeConsumeRequest): Promise<AuthUser> {
  return apiClient.post<AuthUser>("/auth/verify-email", payload, {
    retryOnUnauthorized: false,
    notifyUnauthorized: false
  });
}

export async function requestPasswordReset(payload: EmailChallengeRequest): Promise<void> {
  await apiClient.post<{ ok: boolean }>("/auth/request-password-reset", payload, {
    retryOnUnauthorized: false,
    notifyUnauthorized: false
  });
}

export async function resetPassword(payload: PasswordResetRequest): Promise<void> {
  await apiClient.post<{ ok: boolean }>("/auth/reset-password", payload, {
    retryOnUnauthorized: false,
    notifyUnauthorized: false
  });
}

/** Only allow same-app relative redirects after login (prevents open redirects). */
export function sanitizeNextPath(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  if (raw.startsWith("/login") || raw.startsWith("/register")) {
    return null;
  }
  return raw;
}
