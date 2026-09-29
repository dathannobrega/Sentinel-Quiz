"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { Divider, Section } from "@/components/ui/section";
import { Stat, StatList } from "@/components/ui/stat";
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
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {items.length ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {items.slice(0, 3).map((item) => (
            <li key={`${title}-${item.question_id}`} className="flex flex-col gap-0.5 py-3">
              <p className="line-clamp-2 text-sm text-fg">{item.prompt}</p>
              <p className="text-xs text-fg-muted">
                {item.excerpt ? `${item.excerpt} · ` : ""}
                {updatedAtLabel.replace("{date}", formatDateTime(item.updated_at))}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-y border-line py-3 text-sm text-fg-muted">{emptyCopy}</p>
      )}
    </div>
  );
}

/** Account identity + the personal study notebook (bookmarks, notes, review queue). */
export function AccountPanel({ user, overview, notice, pendingAction, onLogout }: AccountPanelProps) {
  const { t } = useI18n();

  return (
    <>
      <Section
        title={t("account.card.title")}
        description={t("account.card.subtitle")}
        actions={
          <Badge tone={overview.scope === "user" ? "success" : "neutral"} aria-live="polite">
            {formatScope(overview.scope)}
          </Badge>
        }
      >
        {notice ? <Alert tone={notice.tone} title={notice.title} message={notice.message} /> : null}

        {user ? (
          <div className="flex flex-wrap items-center gap-4">
            <span
              aria-hidden="true"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-base font-semibold text-primary uppercase"
            >
              {(user.display_name || user.email).slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-fg">{user.display_name || user.email}</p>
              <p className="text-[0.8125rem] text-fg-muted [overflow-wrap:anywhere]">
                {user.email} · {t("account.user.roleLabel")} {user.role} · {t("account.user.sinceLabel")} {formatDateTime(user.created_at)}
              </p>
            </div>
            <Button variant="secondary" size="sm" busy={pendingAction === "logout"} onClick={onLogout}>
              {t("common.actions.signOut")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-sm font-medium text-fg">{t("account.guest.localModeTitle")}</dt>
                <dd className="text-[0.8125rem] leading-relaxed text-fg-muted">{t("account.guest.localModeMessage")}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-sm font-medium text-fg">{t("account.guest.signInTitle")}</dt>
                <dd className="text-[0.8125rem] leading-relaxed text-fg-muted">{t("account.guest.signInMessage")}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Link href="/login" className={buttonClassName("primary")}>
                {t("common.actions.signIn")}
              </Link>
              <Link href="/register" className={buttonClassName("secondary")}>
                {t("common.actions.createAccount")}
              </Link>
            </div>
          </div>
        )}
      </Section>

      {user ? (
        <>
          <Divider />
          <Section title={t("account.summary.ariaLabel")}>
            <StatList aria-label={t("account.summary.ariaLabel")}>
              <Stat label={t("account.summary.bookmarks")} value={overview.bookmark_count} />
              <Stat label={t("account.summary.notes")} value={overview.note_count} />
              <Stat label={t("account.summary.dueReviews")} value={overview.due_review_count} />
            </StatList>
            <div className="grid gap-8 pt-2 lg:grid-cols-3">
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
          </Section>
        </>
      ) : null}
    </>
  );
}
