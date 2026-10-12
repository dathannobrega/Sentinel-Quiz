"use client";

import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowRightIcon, BookIcon, HeadphonesIcon, PlayIcon } from "@/components/ui/icons";
import { Meter } from "@/components/ui/meter";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page, PageHeader, Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { ReadingStats } from "@/features/reading/components/reading-stats";
import { useReadingCapabilitiesQuery, useReadingLibraryQuery } from "@/features/reading/hooks";
import { formatCount } from "@/features/reading/lib/format";
import { buildBookHref, buildReaderHref } from "@/features/reading/lib/hrefs";
import { ApiError } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { formatDate } from "@/lib/utils/format";
import type { ReadingBook, ReadingCapabilities } from "@/types/api";

/** Warns when the speech service is off: TTS falls back to the browser voice, shadowing is disabled. */
export function CapabilitiesBanner({ capabilities }: { capabilities: ReadingCapabilities | undefined }) {
  const { t } = useI18n();
  if (!capabilities?.enabled) {
    return null;
  }
  const tts = capabilities.tts;
  const assess = capabilities.assess;
  const ttsOff = tts && !tts.available;
  const assessOff = assess && !assess.available;
  if (!ttsOff && !assessOff) {
    return null;
  }
  const ttsMessage = tts?.reason === "speech_warming" ? t("reading.capabilities.ttsWarming") : t("reading.capabilities.ttsUnavailable");
  return (
    <div className="flex flex-col gap-3">
      {ttsOff ? <Alert tone="warning" title={t("reading.capabilities.ttsUnavailableTitle")} message={ttsMessage} /> : null}
      {assessOff ? <Alert tone="warning" title={t("reading.capabilities.assessUnavailableTitle")} message={t("reading.capabilities.assessUnavailable")} /> : null}
    </div>
  );
}

function mostRecentProgress(books: ReadingBook[]): ReadingBook | null {
  let best: ReadingBook | null = null;
  for (const book of books) {
    if (!book.progress) {
      continue;
    }
    if (!best?.progress || Date.parse(book.progress.updated_at) > Date.parse(best.progress.updated_at)) {
      best = book;
    }
  }
  return best;
}

function ContinueCard({ book }: { book: ReadingBook }) {
  const { t, locale } = useI18n();
  const progress = book.progress;
  if (!progress) {
    return null;
  }
  const percent = Math.round(progress.percent);
  return (
    <section
      aria-labelledby="reading-continue-title"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 shadow-raised sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <p id="reading-continue-title" className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
          <HeadphonesIcon size={14} className="text-primary" />
          {t("reading.library.continueTitle")}
        </p>
        <p className="truncate text-lg font-semibold text-fg">{book.title}</p>
        <p className="text-sm text-fg-muted">{t("reading.library.continueFrom", { section: progress.section_title || progress.section_id })}</p>
        <div className="flex items-center gap-3">
          <Meter value={percent} label={t("reading.library.progressLabel", { book: book.title })} className="max-w-56" />
          <span className="nums text-xs text-fg-muted">{t("reading.library.percentRead", { percent })}</span>
        </div>
        <p className="text-xs text-fg-subtle">{t("reading.library.lastRead", { date: formatDate(progress.updated_at, locale) })}</p>
      </div>
      <Link href={buildReaderHref(progress.section_id)} className={buttonClassName("primary", "lg")}>
        <PlayIcon />
        {t("reading.library.continueButton")}
      </Link>
    </section>
  );
}

function BookCard({ book }: { book: ReadingBook }) {
  const { t, locale } = useI18n();
  const progress = book.progress;
  const percent = progress ? Math.round(progress.percent) : 0;
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <div className="flex flex-col gap-2">
        {book.certification ? <Badge tone="primary">{book.certification}</Badge> : null}
        <h3 className="text-base font-semibold text-fg">
          <Link href={buildBookHref(book.slug)} className="focus-ring rounded-sm hover:underline">
            {book.title}
          </Link>
        </h3>
        <p className="text-[0.8125rem] text-fg-muted">
          {t("reading.library.chapters", { count: formatCount(book.chapters.length, locale) })} ·{" "}
          {t("reading.library.sections", { count: formatCount(book.sections, locale) })} ·{" "}
          {t("reading.library.words", { count: formatCount(book.words, locale) })} ·{" "}
          {t("reading.library.minutes", { count: formatCount(book.minutes, locale) })}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Meter value={percent} label={t("reading.library.progressLabel", { book: book.title })} />
        <p className="nums text-xs text-fg-muted">
          {progress ? t("reading.library.percentRead", { percent }) : t("reading.library.notStarted")}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        {progress ? (
          <Link href={buildReaderHref(progress.section_id)} className={buttonClassName("primary", "sm")}>
            <PlayIcon />
            {t("reading.library.continueButton")}
          </Link>
        ) : (
          <Link href={buildBookHref(book.slug)} className={buttonClassName("primary", "sm")}>
            <PlayIcon />
            {t("reading.library.startButton")}
          </Link>
        )}
        <Link href={buildBookHref(book.slug)} className={buttonClassName("ghost", "sm")}>
          {t("reading.library.openBook")}
          <ArrowRightIcon />
        </Link>
      </div>
    </li>
  );
}

/** `/read`: the books, "continue reading", capability warnings and the reading stats. */
export function ReadingLibrary() {
  const { t } = useI18n();
  const capabilities = useReadingCapabilitiesQuery();
  const library = useReadingLibraryQuery();

  const header = <PageHeader title={t("reading.library.title")} description={t("reading.library.subtitle")} />;

  if (capabilities.data && !capabilities.data.enabled) {
    return (
      <Page>
        {header}
        <EmptyState title={t("reading.library.disabledTitle")} description={t("reading.library.disabledMessage")} />
      </Page>
    );
  }

  if (library.isPending) {
    return (
      <Page aria-busy="true">
        {header}
        <span className="sr-only" role="status">
          {t("reading.library.loading")}
        </span>
        <Skeleton height={120} />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton height={220} />
          <Skeleton height={220} />
        </div>
      </Page>
    );
  }

  if (library.isError) {
    const status = library.error instanceof ApiError ? library.error.status : 0;
    return (
      <Page>
        {header}
        {status === 401 ? (
          <AuthRequiredNotice title={t("reading.library.loginRequiredTitle")} message={t("reading.library.loginRequiredMessage")} />
        ) : (
          <QueryErrorBanner title={t("reading.library.loadFailed")} error={library.error} onRetry={() => void library.refetch()} retrying={library.isFetching} />
        )}
      </Page>
    );
  }

  const books = library.data.books;
  const booksAvailable = capabilities.data?.books_available !== false && books.length > 0;
  const continueBook = mostRecentProgress(books);

  return (
    <Page>
      {header}
      <CapabilitiesBanner capabilities={capabilities.data} />
      {!booksAvailable ? (
        <EmptyState title={t("reading.library.emptyTitle")} description={t("reading.library.emptyMessage")}>
          <BookIcon className="text-fg-subtle" />
        </EmptyState>
      ) : (
        <>
          {continueBook ? <ContinueCard book={continueBook} /> : null}
          <Section title={t("reading.library.booksTitle")}>
            <ul className="grid gap-4 md:grid-cols-2">
              {books.map((book) => (
                <BookCard key={book.slug} book={book} />
              ))}
            </ul>
          </Section>
        </>
      )}
      <ReadingStats />
    </Page>
  );
}
