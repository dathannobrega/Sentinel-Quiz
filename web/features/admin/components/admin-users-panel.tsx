"use client";

import { Card } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import { StatusBanner } from "@/components/ui/status-banner";
import { useAdminUpdateUserMutation, useAdminUsersQuery } from "@/lib/query/admin-hooks";
import { useCurrentUserQuery } from "@/lib/query/hooks";

export function AdminUsersPanel() {
  const { t } = useI18n();
  const currentUserQuery = useCurrentUserQuery();
  const usersQuery = useAdminUsersQuery();
  const updateUserMutation = useAdminUpdateUserMutation();
  const canManageUsers = currentUserQuery.data?.role === "admin";

  return (
    <Card title={t("admin.users.title")} subtitle={t("admin.users.subtitle")}>
      {!canManageUsers ? (
        <StatusBanner tone="warning" title={t("admin.users.title")} message={t("admin.users.accessDenied")} />
      ) : null}
      {usersQuery.isLoading ? (
        <div className="sq-empty">{t("common.status.loading")}</div>
      ) : usersQuery.isError ? (
        <div className="sq-empty">{t("admin.users.loadError")}</div>
      ) : usersQuery.data?.length ? (
        <div className="sq-list">
          {usersQuery.data.slice(0, 8).map((user) => (
            <div key={user.id} className="sq-list-item">
              <div className="sq-list-title">{user.display_name || user.email}</div>
              <div className="sq-list-meta">
                {user.email} · {user.exam_session_count} exam · {user.study_session_count} study
              </div>
              <div className="sq-actions">
                <select
                  className="sq-select"
                  value={user.role}
                  disabled={!canManageUsers}
                  onChange={(event) => {
                    void updateUserMutation.mutateAsync({
                      userId: user.id,
                      payload: { role: event.target.value },
                    });
                  }}
                >
                  {["student", "editor", "reviewer", "admin"].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <label className="sq-checkbox-row">
                  <input
                    type="checkbox"
                    checked={user.is_active}
                    disabled={!canManageUsers}
                    onChange={(event) => {
                      void updateUserMutation.mutateAsync({
                        userId: user.id,
                        payload: { is_active: event.target.checked },
                      });
                    }}
                  />
                  {t("admin.users.active")}
                </label>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sq-empty">{t("admin.users.empty")}</div>
      )}
    </Card>
  );
}
