"use client";

import Link from "next/link";
import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { AlertIcon, CircleCheckIcon, ClockIcon } from "@/components/ui/icons";
import { ArchiveIcon, ChallengeIcon, CopyIcon, PresentIcon, UsersIcon } from "@/features/quiz-builder/components/icons";
import { ThemeSwatch } from "@/features/quiz-builder/components/theme-picker";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";
import type { LiveQuizSummary } from "@/types/api";

interface QuizCardProps {
  quiz: LiveQuizSummary;
  index: number;
  busy?: boolean;
  onPresent: (quiz: LiveQuizSummary) => void;
  /** "Criar desafio" (Incremento 6): only for published quizzes. */
  onChallenge?: (quiz: LiveQuizSummary) => void;
  onDuplicate: (quiz: LiveQuizSummary) => void;
  onArchive: (quiz: LiveQuizSummary) => void;
}

export function QuizCard({ quiz, index, busy = false, onPresent, onChallenge, onDuplicate, onArchive }: QuizCardProps) {
  const { t, locale } = useI18n();
  const editHref = `/quizzes/${encodeURIComponent(quiz.id)}/edit`;
  const itemsLabel =
    quiz.item_count === 0
      ? t("quizBuilder.library.card.itemsNone")
      : quiz.item_count === 1
        ? t("quizBuilder.library.card.itemsOne")
        : t("quizBuilder.library.card.items", { count: quiz.item_count });

  return (
    <li
      className="group/card relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-[border-color,box-shadow,transform] duration-200 hover:border-line-strong hover:shadow-raised motion-safe:animate-[rise-in_320ms_var(--ease-out)_both] motion-safe:hover:-translate-y-0.5"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` } as CSSProperties}
    >
      <Link href={editHref} tabIndex={-1} aria-hidden="true" className="block border-b border-line bg-surface-muted p-3">
        <ThemeSwatch themeKey={quiz.theme_key} className="shadow-raised" />
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {quiz.published_version_no !== null ? (
            <Badge tone="success" title={t("quizBuilder.library.card.publishedLabel", { version: quiz.published_version_no })}>
              <CircleCheckIcon />
              <span className="sr-only">{t("quizBuilder.library.card.publishedLabel", { version: quiz.published_version_no })}</span>
              <span aria-hidden="true">{t("quizBuilder.library.card.published", { version: quiz.published_version_no })}</span>
            </Badge>
          ) : (
            <Badge tone="neutral">{t("quizBuilder.library.card.neverPublished")}</Badge>
          )}
          {quiz.has_unpublished_changes && quiz.published_version_no !== null ? (
            <Badge tone="warning">
              <AlertIcon />
              {t("quizBuilder.library.card.unpublished")}
            </Badge>
          ) : null}
        </div>
        <h3 className="text-base leading-snug font-semibold text-fg">
          <Link href={editHref} className="focus-ring rounded-sm after:absolute after:inset-0 after:content-[''] hover:underline">
            {quiz.title}
          </Link>
        </h3>
        {quiz.description ? <p className="line-clamp-2 text-[0.8125rem] text-fg-muted">{quiz.description}</p> : null}
        <ul className="mt-auto flex flex-col gap-1 text-[0.8125rem] text-fg-muted">
          <li className="flex items-center gap-1.5">
            <span>{itemsLabel}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <UsersIcon className="shrink-0 text-fg-subtle" />
            <span>
              {quiz.last_session
                ? t("quizBuilder.library.card.lastSession", {
                    status: t(`quizBuilder.sessionStatus.${quiz.last_session.status}`),
                    date: formatDateTime(quiz.last_session.created_at, locale)
                  })
                : t("quizBuilder.library.card.noSessions")}
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <ClockIcon className="shrink-0 text-fg-subtle" />
            <span>{t("quizBuilder.library.card.updated", { date: formatDateTime(quiz.updated_at, locale) })}</span>
          </li>
        </ul>
      </div>
      {/* Actions sit above the stretched title link (relative z-10). */}
      <div className="relative z-10 flex flex-wrap items-center gap-1 border-t border-line px-3 py-2">
        <Button size="sm" onClick={() => onPresent(quiz)} disabled={busy || quiz.item_count === 0}>
          <PresentIcon />
          {t("quizBuilder.library.card.present")}
        </Button>
        {onChallenge && quiz.published_version_no !== null ? (
          <Button size="sm" variant="secondary" onClick={() => onChallenge(quiz)} disabled={busy} title={t("quizChallenge.create.title")}>
            <ChallengeIcon />
            {t("quizChallenge.create.short")}
          </Button>
        ) : null}
        <Link href={editHref} className={buttonClassName("ghost", "sm")}>
          {t("quizBuilder.library.card.edit")}
        </Link>
        <Link href={`/quizzes/${encodeURIComponent(quiz.id)}/sessions`} className={buttonClassName("ghost", "sm")}>
          {t("quizBuilder.library.card.sessions")}
        </Link>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className={cn(buttonClassName("ghost", "sm"), "w-8 px-0")}
            aria-label={`${t("quizBuilder.library.card.duplicate")}: ${quiz.title}`}
            title={t("quizBuilder.library.card.duplicate")}
            disabled={busy}
            onClick={() => onDuplicate(quiz)}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            className={cn(buttonClassName("ghost", "sm"), "w-8 px-0 hover:text-danger")}
            aria-label={`${t("quizBuilder.library.card.archive")}: ${quiz.title}`}
            title={t("quizBuilder.library.card.archive")}
            disabled={busy}
            onClick={() => onArchive(quiz)}
          >
            <ArchiveIcon />
          </button>
        </span>
      </div>
    </li>
  );
}
