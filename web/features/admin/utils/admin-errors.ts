import { ApiError, readErrorMessage } from "@/lib/api/client";

import type { Translate } from "@/features/admin/types";

/**
 * Admin-specific error text: 401/403 get role-aware guidance, everything else shows the backend
 * `detail` (already normalized by apiClient) or the provided fallback.
 */
export function readAdminError(error: unknown, t: Translate, fallbackKey = "admin.misc.actionFailed"): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return t("admin.misc.authRequired");
    }
    if (error.status === 403) {
      return error.message && error.code !== "http_403" ? error.message : t("admin.misc.adminOnly");
    }
  }
  return readErrorMessage(error, t(fallbackKey));
}

/** " (v3)" style suffix used by workflow notices. */
export function versionSuffix(t: Translate, version: number | null | undefined): string {
  return version ? t("admin.misc.versionSuffix", { version }) : "";
}
