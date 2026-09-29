"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { buttonClassName } from "@/components/ui/button";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { useSessionRole } from "@/lib/query/hooks";

import { AdminWorkspace } from "@/features/admin/components/admin-workspace";
import type { AdminPermissions } from "@/features/admin/hooks/use-admin-question-editor";

interface AdminShellProps {
  initialQuestionId?: string | null;
  editorOnly?: boolean;
}

/**
 * Admin entry point. proxy.ts already redirects cookie-less visitors; this client guard
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
      <Page width="narrow">
        <QueryErrorBanner
          error={query.error}
          title={t("admin.guard.loadUserFailedTitle")}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </Page>
    );
  }

  if (query.isPending || isAnonymous || !user) {
    return (
      <Page width="wide" aria-busy="true">
        <div role="status" className="flex flex-col gap-6">
          <span className="sr-only">{t("admin.guard.checking")}</span>
          <Skeleton height={56} className="max-w-md" />
          <Skeleton height={40} />
          <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
            <Skeleton height={520} />
            <Skeleton height={520} />
          </div>
        </div>
      </Page>
    );
  }

  if (!isStaff) {
    return (
      <Page width="narrow">
        <Alert
          tone="danger"
          role="alert"
          title={t("admin.guard.forbiddenTitle")}
          message={t("admin.guard.forbiddenMessage")}
          action={
            <Link href="/dashboard" className={buttonClassName("secondary", "sm")}>
              {t("admin.guard.backToDashboard")}
            </Link>
          }
        />
      </Page>
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
