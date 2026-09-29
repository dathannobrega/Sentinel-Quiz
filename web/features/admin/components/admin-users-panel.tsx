"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { StatusBanner } from "@/components/ui/status-banner";
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
    <Card title={t("admin.users.title")} subtitle={t("admin.users.subtitle")}>
      {!canManageUsers ? (
        <StatusBanner tone="warning" title={t("admin.users.title")} message={t("admin.users.accessDenied")} />
      ) : usersQuery.isPending ? (
        <div className="sq-empty" role="status">
          {t("common.status.loading")}
        </div>
      ) : usersQuery.isError ? (
        <QueryErrorBanner
          error={usersQuery.error}
          title={t("admin.users.loadError")}
          onRetry={() => void usersQuery.refetch()}
          retrying={usersQuery.isFetching}
        />
      ) : users.length || page > 0 ? (
        <div className="sq-page-stack">
          {notice ? (
            <StatusBanner
              tone={notice.tone}
              title={t("admin.users.noticeTitle")}
              message={notice.message}
              role={notice.tone === "danger" ? "alert" : "status"}
            />
          ) : null}
          <div className="sq-list">
            {users.map((user) => {
              const name = user.display_name || user.email;
              const roleSelectId = `admin-user-role-${user.id}`;
              const isBusy = pendingUserId === user.id;
              return (
                <div key={user.id} className="sq-list-item" aria-busy={isBusy || undefined}>
                  <div className="sq-list-title">{name}</div>
                  <div className="sq-list-meta">
                    {t("admin.users.sessionsMeta", {
                      email: user.email,
                      exam: user.exam_session_count,
                      study: user.study_session_count
                    })}
                  </div>
                  <div className="sq-actions">
                    <label htmlFor={roleSelectId} className="sq-visually-hidden">
                      {t("admin.users.roleSelectLabel", { user: name })}
                    </label>
                    <select
                      id={roleSelectId}
                      className="sq-select"
                      value={user.role}
                      disabled={isBusy}
                      onChange={(event) => void handleRoleChange(user, event.target.value)}
                    >
                      {ADMIN_USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {userRoleLabel(t, role)}
                        </option>
                      ))}
                    </select>
                    <label className="sq-checkbox-row">
                      <input
                        type="checkbox"
                        checked={user.is_active}
                        disabled={isBusy}
                        aria-label={t("admin.users.activeToggleLabel", { user: name })}
                        onChange={(event) => void handleActiveChange(user, event.target.checked)}
                      />
                      {t("admin.users.active")}
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <nav className="sq-actions" aria-label={t("admin.users.pagination.label")}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPreviousPage || usersQuery.isFetching}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              {t("admin.users.pagination.previous")}
            </Button>
            <span className="sq-list-meta" role="status" aria-live="polite">
              {total !== null
                ? t("admin.users.pagination.rangeWithTotal", { start: rangeStart, end: rangeEnd, total })
                : t("admin.users.pagination.range", { start: rangeStart, end: rangeEnd })}
              {pageCount !== null ? ` · ${t("admin.users.pagination.page", { page: page + 1, pages: pageCount })}` : null}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasNextPage || usersQuery.isFetching}
              onClick={() => setPage((current) => current + 1)}
            >
              {t("admin.users.pagination.next")}
            </Button>
          </nav>
        </div>
      ) : (
        <div className="sq-empty">{t("admin.users.empty")}</div>
      )}
      {dialog}
    </Card>
  );
}
