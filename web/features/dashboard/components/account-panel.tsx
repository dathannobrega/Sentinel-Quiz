"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { useI18n } from "@/lib/i18n";
import { formatDateTime, formatScope } from "@/lib/utils/format";
import type { AuthUser, StudyOverview } from "@/types/api";

import type { DashboardNotice } from "@/features/dashboard/types";

interface AccountPanelProps {
  user: AuthUser | null;
  overview: StudyOverview;
  notice: DashboardNotice | null;
  pendingAction: "logout" | null;
  onLogout: () => void;
}

function StudyList({
  title,
  items,
  emptyCopy,
  updatedAtLabel
}: {
  title: string;
  items: StudyOverview["recent_bookmarks"];
  emptyCopy: string;
  updatedAtLabel: string;
}) {
  return (
    <div className="sq-surface-block">
      <div className="sq-list-title">{title}</div>
      {items.length ? (
        <div className="sq-list">
          {items.slice(0, 3).map((item) => (
            <div key={`${title}-${item.question_id}`} className="sq-list-item">
              <div className="sq-list-title">{item.prompt}</div>
              <div className="sq-list-meta">
                {item.excerpt ? `${item.excerpt} · ` : ""}
                {updatedAtLabel.replace("{date}", formatDateTime(item.updated_at))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="sq-empty">{emptyCopy}</div>
      )}
    </div>
  );
}

export function AccountPanel({
  user,
  overview,
  notice,
  pendingAction,
  onLogout
}: AccountPanelProps) {
  const { t } = useI18n();

  return (
    <Card
      title={t("account.card.title")}
      subtitle={t("account.card.subtitle")}
      actions={
        <span className="sq-chip" aria-live="polite">
          {formatScope(overview.scope)}
        </span>
      }
    >
      <div className="sq-surface-block">
        {notice ? <StatusBanner tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        {user ? (
          <div className="sq-surface-block">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "var(--sq-space-4)",
                flexWrap: "wrap"
              }}
            >
              <div>
                <div className="sq-list-title">{user.display_name || user.email}</div>
                <div className="sq-list-meta">
                  {user.email} · {t("account.user.roleLabel")} {user.role} · {t("account.user.sinceLabel")} {formatDateTime(user.created_at)}
                </div>
              </div>
              <Button variant="ghost" size="sm" busy={pendingAction === "logout"} onClick={onLogout}>
                {t("common.actions.signOut")}
              </Button>
            </div>

            <div className="sq-metric-grid" aria-label={t("account.summary.ariaLabel")}>
              <div className="sq-metric-card">
                <span className="sq-muted">{t("account.summary.bookmarks")}</span>
                <strong>{overview.bookmark_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">{t("account.summary.notes")}</span>
                <strong>{overview.note_count}</strong>
              </div>
              <div className="sq-metric-card">
                <span className="sq-muted">{t("account.summary.dueReviews")}</span>
                <strong>{overview.due_review_count}</strong>
              </div>
            </div>

            <StudyList
              title={t("account.lists.recentBookmarks")}
              items={overview.recent_bookmarks}
              emptyCopy={t("account.lists.noBookmarks")}
              updatedAtLabel={t("account.lists.updatedAt")}
            />
            <StudyList
              title={t("account.lists.recentNotes")}
              items={overview.recent_notes}
              emptyCopy={t("account.lists.noNotes")}
              updatedAtLabel={t("account.lists.updatedAt")}
            />
            <StudyList
              title={t("account.lists.reviewQueue")}
              items={overview.due_reviews}
              emptyCopy={t("account.lists.noDueReviews")}
              updatedAtLabel={t("account.lists.updatedAt")}
            />
          </div>
        ) : (
          <div className="sq-surface-block">
            <div className="sq-list">
              <div className="sq-list-item">
                <div className="sq-list-title">{t("account.guest.localModeTitle")}</div>
                <div className="sq-list-meta">
                  {t("account.guest.localModeMessage")}
                </div>
              </div>
              <div className="sq-list-item">
                <div className="sq-list-title">{t("account.guest.signInTitle")}</div>
                <div className="sq-list-meta">
                  {t("account.guest.signInMessage")}
                </div>
              </div>
            </div>

            <div className="sq-actions">
              <Link href="/login" className="sq-button sq-button--md sq-button--primary">
                {t("common.actions.signIn")}
              </Link>
              <Link href="/register" className="sq-button sq-button--md sq-button--ghost">
                {t("common.actions.createAccount")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
