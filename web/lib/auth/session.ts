import { ApiError, apiClient } from "@/lib/api/client";
import { clearStoredAuthToken, setStoredAuthToken } from "@/lib/auth/storage";
import type {
  AuthTokenResponse,
  AuthUser,
  EmailChallengeConsumeRequest,
  EmailChallengeRequest,
  PasswordResetRequest
} from "@/types/api";

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    return await apiClient.get<AuthUser>("/auth/me", { retryOnUnauthorized: false });
  } catch (error) {
    if (isUnauthorized(error)) {
      clearStoredAuthToken();
      return null;
    }
    throw error;
  }
}

export async function loginUser(payload: {
  email: string;
  password: string;
}): Promise<AuthUser> {
  const response = await apiClient.post<AuthTokenResponse>("/auth/login", payload, {
    retryOnUnauthorized: false
  });
  setStoredAuthToken(response.token);
  return response.user;
}

export async function registerUser(payload: {
  email: string;
  password: string;
  display_name?: string | null;
}): Promise<AuthUser> {
  const response = await apiClient.post<AuthTokenResponse>("/auth/register", payload, {
    retryOnUnauthorized: false
  });
  setStoredAuthToken(response.token);
  return response.user;
}

export async function logoutUser(): Promise<void> {
  try {
    await apiClient.post<{ ok: boolean }>("/auth/logout");
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
    retryOnUnauthorized: false
  });
}

export async function requestPasswordReset(payload: EmailChallengeRequest): Promise<void> {
  await apiClient.post<{ ok: boolean }>("/auth/request-password-reset", payload, {
    retryOnUnauthorized: false
  });
}

export async function resetPassword(payload: PasswordResetRequest): Promise<void> {
  await apiClient.post<{ ok: boolean }>("/auth/reset-password", payload, {
    retryOnUnauthorized: false
  });
}
