"use client";

import Link from "next/link";

import { AuthRequiredNotice } from "@/components/ui/auth-required-notice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ArrowLeftIcon, BookIcon, ChevronLeftIcon, ChevronRightIcon, PlayCircleIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Page } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSectionSource } from "@/features/study-sections/components/study-sections";
import { usePracticeSectionMutation, useStudySectionQuery } from "@/features/study-sections/hooks";
import { ApiError, readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { buildSectionReaderHref } from "@/lib/utils/materials";
import type { StudySectionDetail } from "@/types/api";

function SectionNav({ detail, t }: { detail: StudySectionDetail; t: (key: string) => string }) {
  if (!detail.previous && !detail.parent && !detail.next) {
    return null;
  }
  const card =
    "focus-ring group flex min-w-0 flex-col gap-1 rounded-lg border border-line px-4 py-3 transition-colors hover:border-primary/50 hover:bg-surface-muted";
  return (
    <nav aria-label={t("theory.reader.navigation")} className="flex flex-col gap-4 border-t border-line pt-5">
      {detail.parent ? (
        <p className="text-sm text-fg-muted">
          {t("theory.reader.up")}:{" "}
          <Link href={buildSectionReaderHref(detail.parent.id)} className="focus-ring rounded-sm font-medium text-primary hover:underline">
            {detail.parent.title}
          </Link>
        </p>
      ) : null}
      {detail.previous || detail.next ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {detail.previous ? (
            <Link href={buildSectionReaderHref(detail.previous.id)} className={card}>
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                <ChevronLeftIcon size={14} />
                {t("theory.reader.previous")}
              </span>
              <span className="truncate text-sm font-medium text-primary">{detail.previous.title}</span>
            </Link>
          ) : (
            <span aria-hidden className="hidden sm:block" />
          )}
          {detail.next ? (
            <Link href={buildSectionReaderHref(detail.next.id)} className={cn(card, "sm:items-end sm:text-right")}>
              <span className="flex items-center gap-1 text-xs text-fg-muted">
                {t("theory.reader.next")}
                <ChevronRightIcon size={14} />
              </span>
              <span className="max-w-full truncate text-sm font-medium text-primary">{detail.next.title}</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

/** Reader for one normalized book section (plus subsections), opened from "Where to review". */
export function SectionReader({ sectionId }: { sectionId: string }) {
  const { t } = useI18n();
  const query = useStudySectionQuery(sectionId);
  const practice = usePracticeSectionMutation();

  if (query.isPending) {
    return (
      <Page width="reading" aria-busy="true">
        <span className="sr-only" role="status">
          {t("theory.loading")}
        </span>
        <Skeleton height={14} className="max-w-60" />
        <Skeleton height={40} className="max-w-md" />
        <Skeleton height={320} />
      </Page>
    );
  }

  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    return (
      <Page width="reading">
        {status === 401 ? (
          <AuthRequiredNotice title={t("theory.loginRequiredTitle")} message={t("theory.loginRequiredMessage")} />
        ) : status === 404 ? (
          <EmptyState title={t("theory.reader.notFoundTitle")} description={t("theory.reader.notFoundMessage")} />
        ) : (
          <QueryErrorBanner title={t("theory.loadFailed")} error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
        )}
      </Page>
    );
  }

  const detail = query.data;
  const [head, ...rest] = detail.parts;

  return (
    <Page width="reading">
      <header className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="focus-ring -ml-1 inline-flex items-center gap-1.5 self-start rounded-sm px-1 text-sm text-fg-muted hover:text-fg"
        >
          <ArrowLeftIcon />
          {t("theory.reader.back")}
        </button>
        <p className="inline-flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-fg-muted">
          <BookIcon size={13} className="text-fg-subtle" />
          {formatSectionSource(detail, t)}
        </p>
        {detail.breadcrumb.length > 1 ? (
          <p className="text-xs text-fg-subtle">{detail.breadcrumb.slice(0, -1).join(" › ")}</p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{detail.title}</h1>
        {detail.objectives.length ? (
          <p className="text-xs text-fg-muted">{t("theory.reader.objectives", { codes: detail.objectives.join(", ") })}</p>
        ) : null}
      </header>

      <article className="flex flex-col gap-5">
        {[head, ...rest].filter(Boolean).map((part, index) => {
          const HeadingTag = part.depth <= 1 ? "h2" : "h3";
          return (
            <section key={part.id} id={part.id} className="flex flex-col gap-4" aria-labelledby={index > 0 ? `${part.id}-title` : undefined}>
              {index > 0 ? (
                <HeadingTag
                  id={`${part.id}-title`}
                  className={cn("font-semibold text-fg", part.depth <= 1 ? "mt-4 text-xl" : "mt-2 text-lg")}
                >
                  {part.title}
                </HeadingTag>
              ) : null}
              {part.blocks.map((block, blockIndex) =>
                block.label ? (
                  <aside key={blockIndex} className="rounded-md bg-surface-muted px-4 py-3" aria-label={block.label}>
                    <p className="mb-1 text-xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{block.label}</p>
                    <p className="font-serif text-[1.0625rem] leading-[1.7] text-fg">{block.text}</p>
                  </aside>
                ) : (
                  <p key={blockIndex} className="font-serif text-[1.0625rem] leading-[1.75] text-fg">
                    {block.text}
                  </p>
                )
              )}
            </section>
          );
        })}
        {detail.truncated ? <p className="text-sm text-fg-muted italic">{t("theory.reader.truncated")}</p> : null}
      </article>

      {detail.practice_questions > 0 ? (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-fg">{t("theory.reader.practiceHint")}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button busy={practice.isPending} onClick={() => practice.mutate({ sectionId: detail.section_id, available: detail.practice_questions })}>
              <PlayCircleIcon />
              {t("theory.sections.practice")}
            </Button>
            <span className="text-xs text-fg-muted">{t("theory.sections.practiceCount", { count: detail.practice_questions })}</span>
          </div>
          {practice.isError ? (
            <p role="alert" className="text-xs text-danger">
              {readErrorMessage(practice.error, t("theory.sections.practiceFailed"))}
            </p>
          ) : null}
        </section>
      ) : null}

      <SectionNav detail={detail} t={t} />
    </Page>
  );
}
