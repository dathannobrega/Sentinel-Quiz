"use client";

import { Button } from "@/components/ui/button";
import { BookIcon, ExternalIcon, PlayCircleIcon } from "@/components/ui/icons";
import { usePracticeSectionMutation } from "@/features/study-sections/hooks";
import { readErrorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { buildSectionReaderHref } from "@/lib/utils/materials";
import type { StudySection } from "@/types/api";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function formatSectionSource(section: Pick<StudySection, "book_title" | "page_start" | "page_end">, t: Translate): string {
  const { page_start: start, page_end: end } = section;
  if (typeof start === "number" && typeof end === "number" && end !== start) {
    return t("theory.sections.source", { book: section.book_title, pages: t("theory.pages", { start, end }) });
  }
  if (typeof start === "number") {
    return t("theory.sections.source", { book: section.book_title, pages: t("theory.page", { start }) });
  }
  return t("theory.sections.sourceNoPages", { book: section.book_title });
}

interface StudySectionsProps {
  sections: StudySection[] | undefined;
  t: Translate;
  /** Offer "Practice this section" (starts a new session: never inside a running one). */
  allowPractice?: boolean;
  headingLevel?: 3 | 4;
  className?: string;
}

/**
 * "Where to review": the exact book sections behind the answer. A wrong choice gets its own
 * section first ("why option C isn't the answer"), then the concept behind the question.
 * The full section opens in a new tab so a running session (and its timer) stays intact.
 */
export function StudySections({ sections, t, allowPractice = false, headingLevel = 3, className }: StudySectionsProps) {
  const practice = usePracticeSectionMutation();
  if (!sections?.length) {
    return null;
  }
  const Heading = headingLevel === 3 ? "h3" : "h4";
  // Keep the resolution short: excerpts only for the student's wrong choice and the first
  // explanation; further sections are a compact title + link.
  const firstExplanation = sections.findIndex((section) => section.reason !== "your_choice");

  return (
    <section className={cn("flex flex-col gap-3", className)} aria-label={t("theory.sections.title")}>
      <Heading className="text-xs font-semibold tracking-[0.08em] text-fg-muted uppercase">{t("theory.sections.title")}</Heading>
      <ol className="flex flex-col gap-3">
        {sections.map((section, index) => {
          const isChoice = section.reason === "your_choice";
          const showExcerpt = isChoice || index === firstExplanation;
          return (
            <li
              key={section.section_id}
              className={cn("flex flex-col gap-2 border-l-[3px] py-1 pl-4", isChoice ? "border-danger/60" : "border-primary/50")}
              data-study-section={section.section_id}
            >
              <p className={cn("text-xs font-semibold", isChoice ? "text-danger" : "text-primary")}>
                {isChoice
                  ? t("theory.sections.yourChoice", { key: section.option_key || "?" })
                  : t("theory.sections.explanation")}
              </p>
              <div>
                <p className="text-[0.9375rem] font-semibold leading-snug text-fg">{section.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
                  <BookIcon size={12} className="shrink-0 text-fg-subtle" />
                  <span>{formatSectionSource(section, t)}</span>
                  {section.breadcrumb.length > 1 ? (
                    <span className="text-fg-subtle">· {section.breadcrumb.slice(0, -1).join(" › ")}</span>
                  ) : null}
                </p>
              </div>
              {showExcerpt && section.excerpt ? (
                <p className="font-serif text-[0.9375rem] leading-relaxed text-fg">
                  {section.excerpt}
                  {section.excerpt_truncated ? "…" : ""}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <a
                  href={buildSectionReaderHref(section.section_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t("theory.sections.readFull")}
                  <ExternalIcon size={13} />
                  <span className="sr-only">{t("theory.sections.newTab")}</span>
                </a>
                {allowPractice ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-2"
                    busy={practice.isPending && practice.variables?.sectionId === section.section_id}
                    disabled={practice.isPending}
                    onClick={() => practice.mutate({ sectionId: section.section_id, available: 10 })}
                  >
                    <PlayCircleIcon />
                    {t("theory.sections.practice")}
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {practice.isError ? (
        <p role="alert" className="text-xs text-danger">
          {readErrorMessage(practice.error, t("theory.sections.practiceFailed"))}
        </p>
      ) : null}
    </section>
  );
}
