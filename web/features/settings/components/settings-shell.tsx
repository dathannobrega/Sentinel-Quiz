"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { StatusBanner } from "@/components/ui/status-banner";
import { ApiError, apiClient } from "@/lib/api/client";
import { fetchCurrentUser, logoutUser } from "@/lib/auth/session";
import { useEffectEvent } from "@/lib/hooks/use-effect-event";
import { useI18n } from "@/lib/i18n";
import type { AuthUser, StudyOverview } from "@/types/api";

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

function readErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function toNotice(
  tone: DashboardNotice["tone"],
  title: string,
  message: string
): DashboardNotice {
  return { tone, title, message };
}

export function SettingsShell() {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<"logout" | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<DashboardNotice | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [studyOverview, setStudyOverview] = useState<StudyOverview>(DEFAULT_STUDY_OVERVIEW);

  const load = useEffectEvent(async () => {
    setIsLoading(true);
    setPageNotice(null);
    setAuthNotice(null);

    const overviewPromise = apiClient.get<StudyOverview>("/study/overview");
    const userPromise = fetchCurrentUser();

    const [overviewResult, userResult] = await Promise.allSettled([overviewPromise, userPromise]);

    if (overviewResult.status === "fulfilled") {
      setStudyOverview(overviewResult.value);
    } else {
      setStudyOverview(DEFAULT_STUDY_OVERVIEW);
      setPageNotice(readErrorMessage(overviewResult.reason, t("common.errors.unexpected")));
    }

    if (userResult.status === "fulfilled") {
      setCurrentUser(userResult.value);
    } else {
      setCurrentUser(null);
      if (!isUnauthorized(userResult.reason)) {
        setAuthNotice(
          toNotice("warning", t("common.errors.sessionUnavailable"), readErrorMessage(userResult.reason, t("common.errors.unexpected")))
        );
      }
    }

    setIsLoading(false);
  });

  useEffect(() => {
    void load();
  }, [load]);

  async function handleLogout() {
    setPendingAction("logout");
    setAuthNotice(null);

    try {
      await logoutUser();
      setCurrentUser(null);
      setAuthNotice(toNotice("success", t("settings.notices.loggedOutTitle"), t("settings.notices.loggedOutMessage")));
    } catch (error) {
      setAuthNotice(
        toNotice("danger", t("settings.notices.logoutFailureTitle"), readErrorMessage(error, t("common.errors.unexpected")))
      );
    }

    setPendingAction(null);
  }

  if (isLoading) {
    return (
      <main className="sq-app-shell">
        <div className="sq-page-stack">
          <Skeleton height={180} />
          <Skeleton height={360} />
        </div>
      </main>
    );
  }

  return (
    <main className="sq-app-shell">
      <div className="sq-page-stack">
        <header className="sq-topbar">
          <div className="sq-brand">
            <div className="sq-logo" aria-hidden="true">
              SQ
            </div>
            <div className="sq-brand-copy">
              <div className="sq-page-title">{t("settings.header.title")}</div>
              <p className="sq-page-subtitle">{t("settings.header.subtitle")}</p>
            </div>
          </div>
          <div className="sq-inline-actions">
            <Link href="/dashboard">{t("common.labels.dashboard")}</Link>
            <Link href="/start">{t("common.labels.start")}</Link>
            <Link href="/review">{t("common.labels.review")}</Link>
          </div>
        </header>

        {pageNotice ? <StatusBanner tone="warning" title={t("common.errors.attention")} message={pageNotice} /> : null}

        <AccountPanel
          user={currentUser}
          overview={studyOverview}
          notice={authNotice}
          pendingAction={pendingAction}
          onLogout={() => {
            void handleLogout();
          }}
        />
      </div>
    </main>
  );
}
