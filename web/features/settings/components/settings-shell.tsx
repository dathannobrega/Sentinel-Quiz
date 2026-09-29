"use client";

import { useState } from "react";
import { LocaleSwitch, ThemeSwitch } from "@/components/navigation/app-shell";

import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Divider, Page, PageHeader, Section } from "@/components/ui/section";
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
      <Page aria-busy="true">
        <div role="status" className="flex flex-col gap-8">
          <span className="sr-only">{t("system.loading")}</span>
          <Skeleton height={56} className="max-w-sm" />
          <Skeleton height={96} />
          <Skeleton height={240} />
        </div>
      </Page>
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
    <Page>
      <PageHeader title={t("settings.header.title")} description={t("settings.header.subtitle")} />

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

      <Divider />

      <Section title={t("settings.preferences.title")} description={t("settings.preferences.description")}>
        <dl className="flex flex-col divide-y divide-line border-y border-line">
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <dt className="text-sm text-fg">{t("navigation.theme.label")}</dt>
            <dd>
              <ThemeSwitch />
            </dd>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <dt className="text-sm text-fg">{t("navigation.locale.label")}</dt>
            <dd>
              <LocaleSwitch />
            </dd>
          </div>
        </dl>
      </Section>
    </Page>
  );
}
