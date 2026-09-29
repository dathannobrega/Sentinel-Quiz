"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { useI18n } from "@/lib/i18n";
import { ADMIN_USERS_PAGE_SIZE, useAdminUpdateUserMutation, useAdminUsersQuery } from "@/lib/query/admin-hooks";
import type { AdminUser, AdminUserUpdateInput } from "@/types/api";

import { ADMIN_USER_ROLES } from "@/features/admin/types";
import { readAdminError } from "@/features/admin/utils/admin-errors";
import { userRoleLabel } from "@/features/admin/utils/labels";

type Notice = { tone: "success" | "danger"; message: string };

export function AdminUsersPanel({ canManageUsers }: { canManageUsers: boolean }) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const usersQuery = useAdminUsersQuery(page, { enabled: canManageUsers });
  const users = usersQuery.data?.users ?? [];
  const total = usersQuery.data?.total ?? null;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / ADMIN_USERS_PAGE_SIZE)) : null;
  // Without X-Total-Count, a full page means there may be more.
  const hasNextPage = pageCount !== null ? page + 1 < pageCount : users.length === ADMIN_USERS_PAGE_SIZE;
  const hasPreviousPage = page > 0;
  const rangeStart = users.length ? page * ADMIN_USERS_PAGE_SIZE + 1 : 0;
  const rangeEnd = page * ADMIN_USERS_PAGE_SIZE + users.length;

  useEffect(() => {
    // The total can shrink between pages; never stay on a page past the end.
    if (pageCount !== null && page >= pageCount) {
      setPage(pageCount - 1);
    }
  }, [page, pageCount]);
  const updateUserMutation = useAdminUpdateUserMutation();
  const { confirm, dialog } = useConfirm();
  const [notice, setNotice] = useState<Notice | null>(null);
  const pendingUserId = updateUserMutation.isPending ? updateUserMutation.variables?.userId : null;

  function applyUpdate(user: AdminUser, payload: AdminUserUpdateInput) {
    const name = user.display_name || user.email;
    setNotice(null);
    updateUserMutation.mutate(
      { userId: user.id, payload },
      {
        onSuccess: () => setNotice({ tone: "success", message: t("admin.users.updated", { user: name }) }),
        onError: (error) => setNotice({ tone: "danger", message: readAdminError(error, t, "admin.users.updateFailed") })
      }
    );
  }

  async function handleRoleChange(user: AdminUser, nextRole: string) {
    if (nextRole === user.role) {
      return;
    }
    const name = user.display_name || user.email;
    const accepted = await confirm({
      title: t("admin.users.confirmRoleTitle"),
      message: t("admin.users.confirmRoleMessage", {
        user: name,
        from: userRoleLabel(t, user.role),
        to: userRoleLabel(t, nextRole)
      }),
      confirmLabel: t("admin.users.confirmRoleAction"),
      tone: nextRole === "admin" || user.role === "admin" ? "danger" : "primary"
    });
    if (accepted) {
      applyUpdate(user, { role: nextRole });
    }
  }

  async function handleActiveChange(user: AdminUser, nextActive: boolean) {
    const name = user.display_name || user.email;
    const accepted = await confirm({
      title: nextActive ? t("admin.users.confirmActivateTitle") : t("admin.users.confirmDeactivateTitle"),
      message: nextActive
        ? t("admin.users.confirmActivateMessage", { user: name })
        : t("admin.users.confirmDeactivateMessage", { user: name }),
      confirmLabel: t("admin.users.confirmActiveAction"),
      tone: nextActive ? "primary" : "danger"
    });
    if (accepted) {
      applyUpdate(user, { is_active: nextActive });
    }
  }

  return (
    <Section title={t("admin.users.title")} description={t("admin.users.subtitle")}>
      {!canManageUsers ? (
        <Alert tone="warning" title={t("admin.users.title")} message={t("admin.users.accessDenied")} />
      ) : usersQuery.isPending ? (
        <p className="text-sm text-fg-muted" role="status">
          {t("common.status.loading")}
        </p>
      ) : usersQuery.isError ? (
        <QueryErrorBanner
          error={usersQuery.error}
          title={t("admin.users.loadError")}
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isFetching}
        />
      ) : users.length || page > 0 ? (
        <div className="flex flex-col gap-4">
          {notice ? (
            <Alert
              tone={notice.tone}
              title={t("admin.users.noticeTitle")}
              message={notice.message}
              role={notice.tone === "danger" ? "alert" : "status"}
            />
          ) : null}
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {users.map((user) => {
              const name = user.display_name || user.email;
              const roleSelectId = `admin-user-role-${user.id}`;
              const isBusy = pendingUserId === user.id;
              return (
                <li key={user.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3" aria-busy={isBusy || undefined}>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium text-fg">{name}</p>
                    <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">
                      {t("admin.users.sessionsMeta", {
                        email: user.email,
                        exam: user.exam_session_count,
                        study: user.study_session_count
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label htmlFor={roleSelectId} className="sr-only">
                      {t("admin.users.roleSelectLabel", { user: name })}
                    </label>
                    <Select
                      id={roleSelectId}
                      className="h-9 w-36"
                      value={user.role}
                      disabled={isBusy}
                      onChange={(event) => void handleRoleChange(user, event.target.value)}
                    >
                      {ADMIN_USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {userRoleLabel(t, role)}
                        </option>
                      ))}
                    </Select>
                    <label className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-fg has-disabled:cursor-not-allowed has-disabled:text-fg-subtle">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={user.is_active}
                        disabled={isBusy}
                        aria-label={t("admin.users.activeToggleLabel", { user: name })}
                        onChange={(event) => void handleActiveChange(user, event.target.checked)}
                      />
                      {t("admin.users.active")}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
          <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={t("admin.users.pagination.label")}>
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasPreviousPage || usersQuery.isFetching}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              {t("admin.users.pagination.previous")}
            </Button>
            <span className="nums text-xs text-fg-muted" role="status" aria-live="polite">
              {total !== null
                ? t("admin.users.pagination.rangeWithTotal", { start: rangeStart, end: rangeEnd, total })
                : t("admin.users.pagination.range", { start: rangeStart, end: rangeEnd })}
              {pageCount !== null ? ` · ${t("admin.users.pagination.page", { page: page + 1, pages: pageCount })}` : null}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasNextPage || usersQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("admin.users.pagination.next")}
            </Button>
          </nav>
        </div>
      ) : (
        <EmptyState size="compact" description={t("admin.users.empty")} />
      )}
      {dialog}
    </Section>
  );
}
