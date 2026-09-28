"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import { useSessionRole } from "@/lib/query/hooks";

import { AdminWorkspace } from "@/features/admin/components/admin-workspace";
import type { AdminPermissions } from "@/features/admin/hooks/use-admin-question-editor";

interface AdminShellProps {
  initialQuestionId?: string | null;
  editorOnly?: boolean;
}

/**
 * Admin entry point. middleware.ts already redirects cookie-less visitors; this client guard
 * covers expired sessions and role checks via the shared ["current-user"] query.
 */
export function AdminShell({ initialQuestionId = null, editorOnly = false }: AdminShellProps) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const { query, user, role, isStaff } = useSessionRole();
  const isAnonymous = query.isSuccess && !query.data;

  const permissions = useMemo<AdminPermissions>(
    () => ({
      canEdit: isStaff,
      canReview: role === "reviewer" || role === "admin",
      canAdmin: role === "admin"
    }),
    [isStaff, role]
  );

  useEffect(() => {
    if (isAnonymous) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/admin")}`);
    }
  }, [isAnonymous, pathname, router]);

  if (query.isError && !user) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <QueryErrorBanner
            error={query.error}
            title={t("admin.guard.loadUserFailedTitle")}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </div>
      </main>
    );
  }

  if (query.isPending || isAnonymous || !user) {
    return (
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack" role="status">
          <span className="sq-visually-hidden">{t("admin.guard.checking")}</span>
          <Skeleton height={180} />
          <Skeleton height={320} />
          <Skeleton height={620} />
        </div>
      </main>
    );
  }

  if (!isStaff) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <StatusBanner
            tone="danger"
            role="alert"
            title={t("admin.guard.forbiddenTitle")}
            message={t("admin.guard.forbiddenMessage")}
            action={
              <Link href="/dashboard" className="sq-button sq-button--sm sq-button--ghost">
                {t("admin.guard.backToDashboard")}
              </Link>
            }
          />
        </div>
      </main>
    );
  }

  return (
    <AdminWorkspace
      key={initialQuestionId ?? (editorOnly ? "new" : "overview")}
      editorOnly={editorOnly}
      initialQuestionId={initialQuestionId}
      role={role}
      permissions={permissions}
    />
  );
}
