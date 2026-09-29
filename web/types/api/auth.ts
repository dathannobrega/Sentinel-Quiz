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

/**
 * POST /auth/register with REGISTRATION_EMAIL_VERIFICATION on (contract r4 §1): always
 * `202`, for new and existing e-mails alike, and no session cookie is set.
 */
export interface VerificationRequiredResponse {
  status: "verification_required";
  code?: "verification_required" | (string & {});
  detail?: string | null;
}

/** Body of POST /auth/register: a signed-in session (verification off) or a 202 challenge. */
export type RegisterResponse = AuthTokenResponse | VerificationRequiredResponse;

/** Normalized outcome of a registration request (see lib/auth/session.ts registerUser). */
export type RegisterResult =
  | { kind: "signed_in"; user: AuthUser }
  | { kind: "verification_required"; email: string };

/**
 * POST /auth/verify-email. Since r4 §1 it signs the user in and returns the login shape
 * (`{user, token}`); older backends return the bare AuthUser without a session.
 */
export type VerifyEmailResponse = AuthTokenResponse | AuthUser;

/** Normalized outcome of an e-mail verification (see lib/auth/session.ts verifyEmailToken). */
export interface VerifyEmailResult {
  user: AuthUser;
  /** true when the backend opened a session (r4 §1); false for the legacy bare-user response. */
  signedIn: boolean;
}
