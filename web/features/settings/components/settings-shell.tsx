"use client";

import { useState } from "react";
import Link from "next/link";

import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { useCurrentUser, useLogoutMutation, useStudyOverviewQuery } from "@/lib/query/hooks";
import type { StudyOverview } from "@/types/api";

import { AccountPanel } from "@/features/dashboard/components/account-panel";
import type { DashboardNotice } from "@/features/dashboard/types";

const DEFAULT_STUDY_OVERVIEW: StudyOverview = {
  scope: "device",
  bookmark_count: 0,
  note_count: 0,
  due_review_count: 0,
  next_due_at: null,
  recent_bookmarks: [],
  recent_notes: [],
  due_reviews: []
};

export function SettingsShell() {
  const { t } = useI18n();
  const overviewQuery = useStudyOverviewQuery();
  const currentUserQuery = useCurrentUser();
  const logoutMutation = useLogoutMutation();
  const [authNotice, setAuthNotice] = useState<DashboardNotice | null>(null);

  function handleLogout() {
    setAuthNotice(null);
    logoutMutation.mutate(undefined, {
      onSuccess: () =>
        setAuthNotice({ tone: "success", title: t("settings.notices.loggedOutTitle"), message: t("settings.notices.loggedOutMessage") }),
      onError: (error) =>
        setAuthNotice({
          tone: "danger",
          title: t("settings.notices.logoutFailureTitle"),
          message: readErrorMessage(error, t("common.errors.unexpected"))
        })
    });
  }

  if (overviewQuery.isPending || currentUserQuery.isPending) {
    return (
      <main className="sq-app-shell" aria-busy="true">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={360} />
        </div>
      </main>
    );
  }

  const sessionNotice: DashboardNotice | null = currentUserQuery.isError
    ? {
        tone: "warning",
        title: t("common.errors.sessionUnavailable"),
        message: readErrorMessage(currentUserQuery.error, t("common.errors.unexpected"))
      }
    : null;

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <h1 className="sq-page-title">{t("settings.header.title")}</h1>
              <p className="sq-page-subtitle">{t("settings.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/start">{t("common.labels.start")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
          </div>
        </header>

        {overviewQuery.isError ? (
          <QueryErrorBanner
            tone="warning"
            title={t("common.errors.attention")}
            error={overviewQuery.error}
            onRetry={() => void overviewQuery.refetch()}
            retrying={overviewQuery.isFetching}
          />
        ) : null}

        <AccountPanel
          user={currentUserQuery.data ?? null}
          overview={overviewQuery.data ?? DEFAULT_STUDY_OVERVIEW}
          notice={authNotice ?? sessionNotice}
          pendingAction={logoutMutation.isPending ? "logout" : null}
          onLogout={handleLogout}
        />
      </div>
    </main>
  );
}
