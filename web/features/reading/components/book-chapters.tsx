"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { Badge } from "@/components/ui/badge";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, CircleCheckIcon, PlayIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { useReadingChapterQuery, useReadingLibraryQuery } from "@/features/reading/hooks";
import { formatCount } from "@/features/reading/lib/format";
import { buildReaderHref } from "@/features/reading/lib/hrefs";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { ReadingBook, ReadingChapterSummary } from "@/types/api";

const INDENT_BY_LEVEL: Record<number, string> = { 1: "pl-0", 2: "pl-5", 3: "pl-10" };

function ChapterSections({ slug, file, enabled, currentSectionId }: { slug: string; file: string; enabled: boolean; currentSectionId: string | null }) {
  const { t, locale } = useI18n();
  const query = useReadingChapterQuery(slug, file, enabled);

  if (!enabled || query.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton height={16} className="max-w-md" />
        <Skeleton height={16} className="max-w-sm" />
        <Skeleton height={16} className="max-w-lg" />
      </div>
    );
  }
  if (query.isError) {
    return <QueryErrorBanner title={t("reading.book.chapterLoadFailed")} error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  }
  const sections = query.data.sections;
  if (!sections.length) {
    return <EmptyState size="compact" description={t("reading.book.chapterEmpty")} />;
  }
  return (
    <ol className="flex flex-col divide-y divide-line">
      {sections.map((section) => {
        const isCurrent = section.id === currentSectionId;
        return (
          <li key={section.id} className={cn("flex items-center gap-3 py-2", INDENT_BY_LEVEL[Math.min(3, Math.max(1, section.level))])}>
            <span className="grid size-5 shrink-0 place-items-center" aria-hidden={!section.completed}>
              {section.completed ? <CircleCheckIcon size={16} className="text-success" aria-hidden={false} aria-label={t("reading.book.completed")} /> : null}
            </span>
            <Link
              href={buildReaderHref(section.id)}
              aria-current={isCurrent ? "location" : undefined}
              className={cn(
                "focus-ring min-w-0 flex-1 rounded-sm text-sm hover:underline",
                section.level <= 1 ? "font-medium text-fg" : "text-fg",
                section.completed && "text-fg-muted"
              )}
            >
              {section.title}
            </Link>
            {isCurrent ? (
              <Badge tone="primary">
                <PlayIcon />
                {t("reading.book.continueHere")}
              </Badge>
            ) : null}
            <span className="nums shrink-0 text-xs text-fg-muted">
              {t("reading.book.sectionMeta", { words: formatCount(section.words, locale), minutes: formatCount(section.minutes, locale) })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Chapter file of the section the user stopped at ("book:c04:head-3-30" → "c04"). */
function chapterFileOfSection(sectionId: string | null | undefined): string | null {
  if (!sectionId) {
    return null;
  }
  const parts = sectionId.split(":");
  return parts.length >= 3 ? parts[1] : null;
}

function ChapterList({ book }: { book: ReadingBook }) {
  const { t, locale } = useI18n();
  const currentSectionId = book.progress?.section_id ?? null;
  const currentFile = chapterFileOfSection(currentSectionId);
  const [opened, setOpened] = useState<Set<string>>(() => new Set(currentFile ? [currentFile] : []));

  const markOpened = (file: string) => {
    setOpened((previous) => {
      if (previous.has(file)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(file);
      return next;
    });
  };

  return (
    <div className="flex flex-col">
      {book.chapters.map((chapter: ReadingChapterSummary) => (
        <Disclosure
          key={chapter.file}
          variant="plain"
          defaultOpen={chapter.file === currentFile}
          onToggle={(event) => {
            if (event.currentTarget.open) {
              markOpened(chapter.file);
            }
          }}
          summary={
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{t("reading.book.chapterLabel", { index: chapter.index })}</span>
              <span>{chapter.title}</span>
            </span>
          }
          hint={t("reading.book.chapterMeta", { sections: formatCount(chapter.sections, locale), minutes: formatCount(chapter.minutes, locale) })}
          meta={chapter.file === currentFile ? <Badge tone="primary">{t("reading.library.continueButton")}</Badge> : null}
        >
          <ChapterSections slug={book.slug} file={chapter.file} enabled={opened.has(chapter.file)} currentSectionId={currentSectionId} />
        </Disclosure>
      ))}
    </div>
  );
}

/** `/read/[book]`: the chapters of one book, each expanding to its readable sections. */
export function BookChapters({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const library = useReadingLibraryQuery();

  const back = (
    <Link href="/read" className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg">
      <ArrowLeftIcon />
      {t("reading.book.back")}
    </Link>
  );

  if (library.isPending) {
    return (
      <Page aria-busy="true">
        {back}
        <span className="sr-only" role="status">
          {t("reading.book.loading")}
        </span>
        <Skeleton height={40} className="max-w-md" />
        <Skeleton height={320} />
      </Page>
    );
  }

  if (library.isError) {
    const status = library.error instanceof ApiError ? library.error.status : 0;
    return (
      <Page>
        {back}
        {status === 401 ? (
          <AuthRequiredNotice title={t("reading.library.loginRequiredTitle")} message={t("reading.library.loginRequiredMessage")} />
        ) : (
          <QueryErrorBanner title={t("reading.library.loadFailed")} error={library.error} onRetry={() => void library.refetch()} retrying={library.isFetching} />
        )}
      </Page>
    );
  }

  const book = library.data.books.find((item) => item.slug === slug);
  if (!book) {
    return (
      <Page>
        {back}
        <EmptyState title={t("reading.book.notFoundTitle")} description={t("reading.book.notFoundMessage")} />
      </Page>
    );
  }

  const percent = book.progress ? Math.round(book.progress.percent) : 0;
  return (
    <Page>
      {back}
      <PageHeader
        context={book.certification ?? undefined}
        title={book.title}
        description={
          <>
            {t("reading.library.chapters", { count: formatCount(book.chapters.length, locale) })} ·{" "}
            {t("reading.library.sections", { count: formatCount(book.sections, locale) })} ·{" "}
            {t("reading.library.words", { count: formatCount(book.words, locale) })} ·{" "}
            {t("reading.library.minutes", { count: formatCount(book.minutes, locale) })}
          </>
        }
      />
      <div className="flex items-center gap-3">
        <Meter value={percent} label={t("reading.library.progressLabel", { book: book.title })} className="max-w-md" />
        <span className="nums text-xs text-fg-muted">
          {book.progress ? t("reading.library.percentRead", { percent }) : t("reading.library.notStarted")}
        </span>
      </div>
      <section aria-label={t("reading.book.chaptersTitle")}>
        <ChapterList book={book} />
      </section>
    </Page>
  );
}
