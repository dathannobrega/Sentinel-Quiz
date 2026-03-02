export const EXAM_SESSION_STORAGE_KEY = "securityplus_session_id";
export const STUDY_SESSION_STORAGE_KEY = "securityplus_study_session_id";
export const CLIENT_KEY_STORAGE_KEY = "sentinel_client_key";
export const AUTH_TOKEN_STORAGE_KEY = "sentinel_auth_token";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function readLocalStorage(key: string): string {
  if (!hasWindow()) {
    return "";
  }

  try {
    return String(window.localStorage.getItem(key) ?? "");
  } catch (_error) {
    return "";
  }
}

function writeLocalStorage(key: string, value: string): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(key, value);
  } catch (_error) {
    // Best effort only. The client still works without local persistence.
  }
}

function removeLocalStorage(key: string): void {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.removeItem(key);
  } catch (_error) {
    // Ignore storage failures.
  }
}

function createClientKey(): string {
  if (hasWindow() && window.crypto && typeof window.crypto.randomUUID === "function") {
    return `web-${window.crypto.randomUUID()}`;
  }

  const fallback = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `web-${fallback}`;
}

export function getOrCreateClientKey(): string {
  const existing = readLocalStorage(CLIENT_KEY_STORAGE_KEY).trim();
  if (existing) {
    return existing;
  }

  const created = createClientKey();
  writeLocalStorage(CLIENT_KEY_STORAGE_KEY, created);
  return created;
}

export function getStoredAuthToken(): string {
  return readLocalStorage(AUTH_TOKEN_STORAGE_KEY).trim();
}

export function setStoredAuthToken(token: string): void {
  const normalized = String(token || "").trim();
  if (!normalized) {
    clearStoredAuthToken();
    return;
  }
  writeLocalStorage(AUTH_TOKEN_STORAGE_KEY, normalized);
}

export function clearStoredAuthToken(): void {
  removeLocalStorage(AUTH_TOKEN_STORAGE_KEY);
}

export function persistSessionId(mode: "exam" | "study", sessionId: string): void {
  const key = mode === "study" ? STUDY_SESSION_STORAGE_KEY : EXAM_SESSION_STORAGE_KEY;
  writeLocalStorage(key, sessionId);
}

export function clearSessionId(mode: "exam" | "study"): void {
  const key = mode === "study" ? STUDY_SESSION_STORAGE_KEY : EXAM_SESSION_STORAGE_KEY;
  removeLocalStorage(key);
}
