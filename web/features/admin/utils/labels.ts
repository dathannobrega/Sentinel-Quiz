import type { Translate } from "@/features/admin/types";

/** Translates a dynamic key, falling back to the raw value for unknown backend enums. */
function translateOr(t: Translate, key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

export function issueStatusLabel(t: Translate, status: string): string {
  return translateOr(t, `admin.issues.statuses.${status}`, status);
}

export function userRoleLabel(t: Translate, role: string): string {
  return translateOr(t, `admin.users.roles.${role}`, role);
}
