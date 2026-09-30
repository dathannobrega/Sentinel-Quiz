"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { BookIcon, PlayCircleIcon } from "@/components/ui/icons";
import { QueryErrorBanner } from "@/components/ui/query-error-banner";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSectionSource } from "@/features/study-sections/components/study-sections";
import { usePracticeSectionMutation, useWeakSectionsQuery } from "@/features/study-sections/hooks";
import { readErrorMessage } from "@/lib/api/client";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/utils/format";
import { buildSectionReaderHref } from "@/lib/utils/materials";

/** "Sections to reinforce": the book sections behind the student's mistakes, most urgent first. */
export function WeakSections({ limit = 6 }: { limit?: number }) {
  const { t } = useI18n();
  const query = useWeakSectionsQuery(limit);
  const practice = usePracticeSectionMutation();

  let body;
  if (query.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton height={56} />
        <Skeleton height={56} />
      </div>
    );
  } else if (query.isError) {
    body = <QueryErrorBanner tone="warning" error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  } else if (!query.data.length) {
    body = <EmptyState size="compact" description={t("theory.weak.empty")} />;
  } else {
    body = (
      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {query.data.map((section) => (
          <li key={section.section_id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link
                href={buildSectionReaderHref(section.section_id)}
                className="focus-ring rounded-sm text-[0.9375rem] font-semibold text-fg hover:text-primary hover:underline"
              >
                {section.title}
              </Link>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                <BookIcon size={12} className="shrink-0 text-fg-subtle" />
                {formatSectionSource(section, t)}
              </p>
              <p className="mt-1.5 text-[0.8125rem] text-fg-muted">
                <span className="font-medium text-danger">{t("theory.weak.counts", { open: section.open_questions, mistakes: section.mistakes })}</span>
                {section.last_mistake_at ? <span> · {t("theory.weak.lastMistake", { date: formatDateTime(section.last_mistake_at) })}</span> : null}
              </p>
            </div>
            {section.practice_questions > 0 ? (
              <Button
                variant="secondary"
                size="sm"
                busy={practice.isPending && practice.variables?.sectionId === section.section_id}
                disabled={practice.isPending}
                onClick={() => practice.mutate({ sectionId: section.section_id, available: section.practice_questions })}
              >
                <PlayCircleIcon />
                {t("theory.sections.practice")}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <Section title={t("theory.weak.title")} description={t("theory.weak.description")}>
      {body}
      {practice.isError ? (
        <p role="alert" className="text-xs text-danger">
          {readErrorMessage(practice.error, t("theory.sections.practiceFailed"))}
        </p>
      ) : null}
    </Section>
  );
}
