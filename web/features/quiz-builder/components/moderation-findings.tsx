"use client";

import type { ReactNode } from "react";

import { AlertIcon } from "@/components/ui/icons";
import { describeFindingField, visibleFindings } from "@/features/quiz-builder/lib/moderation";
import { useI18n } from "@/lib/i18n";
import type { LiveModerationFinding } from "@/types/api";

/**
 * Filter findings of a published version (RF-1112): where each term was found. Used after publish
 * (state "flagged") and when a room with guests is refused with 422 moderation_pending.
 */
export function ModerationFindings({
  title,
  message,
  findings,
  action
}: {
  title: string;
  message: string;
  findings: LiveModerationFinding[];
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const { shown, hidden } = visibleFindings(findings);
  return (
    <section role="status" className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning-soft p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-fg">
        <AlertIcon className="text-warning" />
        {title}
      </p>
      <p className="leading-relaxed text-fg-muted">{message}</p>
      {shown.length ? (
        <ul className="flex flex-col gap-1">
          {shown.map((finding, index) => {
            const field = describeFindingField(finding.field);
            const where = finding.position !== null ? t("quizBuilder.moderation.findingItem", { position: finding.position + 1 }) : t("quizBuilder.moderation.findingQuiz");
            const fieldLabel =
              field.kind === "option" || field.kind === "accepted"
                ? t(`quizBuilder.moderation.fields.${field.kind}`, { n: field.n ?? 1 })
                : t(`quizBuilder.moderation.fields.${field.kind}`);
            return (
              <li key={`${finding.position ?? "quiz"}-${finding.field}-${index}`} className="flex flex-wrap items-baseline gap-x-2 px-1 py-0.5">
                <span className="font-medium text-fg">{where}</span>
                <span className="text-fg-muted">· {fieldLabel}</span>
                <span className="text-fg">· {t("quizBuilder.moderation.findingTerm", { term: finding.term })}</span>
                {finding.excerpt ? <span className="w-full truncate font-serif text-[0.8125rem] text-fg-muted">“{finding.excerpt}”</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {hidden ? <p className="text-xs text-fg-muted">{t("quizBuilder.moderation.more", { count: hidden })}</p> : null}
      {action ? <div className="pt-1">{action}</div> : null}
    </section>
  );
}
