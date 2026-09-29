/** Accounts and authentication (/api/auth/*). */

export type UserRole = "admin" | "reviewer" | "editor" | "student" | (string & {});

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  is_active: boolean;
  email_verified: boolean;
  created_at: string;
}

/**
 * Login/register response. Since contract §2 the session lives in the HttpOnly cookie and
 * `token` is omitted/null unless AUTH_RETURN_TOKEN_IN_BODY is enabled server-side.
 */
export interface AuthTokenResponse {
  token?: string | null;
  token_type?: string | null;
  expires_at?: string | null;
  user: AuthUser;
}

export interface EmailChallengeRequest {
  email?: string | null;
}

export interface EmailChallengeConsumeRequest {
  token: string;
}

export interface PasswordResetRequest {
  token: string;
  new_password: string;
}
