"use client";

import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { AlertIcon, ChevronDownIcon } from "@/components/ui/icons";
import { ItemTypeIcon } from "@/features/quiz-builder/components/icons";
import { DistractorChart } from "@/features/quiz-reports/components/distractor-chart";
import {
  difficultyBand,
  discriminationBand,
  dominantDistractor,
  flagTone,
  formatDecimal,
  formatDuration,
  sortFlags
} from "@/features/quiz-reports/lib/report-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportItem } from "@/types/api";

export function ItemAnalysis({ items }: { items: LiveReportItem[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Set<number>>(() => new Set());

  function toggle(position: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface print:overflow-visible print:border-0">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[0.8125rem] text-fg-muted">
            <th scope="col" className="w-12 px-3 py-3 font-medium">{t("quizReports.items.columns.position")}</th>
            <th scope="col" className="px-3 py-3 font-medium">{t("quizReports.items.columns.prompt")}</th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              <abbr title={t("quizReports.items.pLabel")} className="no-underline">{t("quizReports.items.columns.p")}</abbr>
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              <abbr title={t("quizReports.items.dLabel")} className="no-underline">{t("quizReports.items.columns.d")}</abbr>
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium whitespace-nowrap">{t("quizReports.items.columns.time")}</th>
            <th scope="col" className="px-3 py-3 font-medium">{t("quizReports.items.columns.flags")}</th>
            <th scope="col" className="w-10 px-2 py-3 print:hidden">
              <span className="sr-only">{t("quizReports.items.distractors")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow key={item.position} item={item} expanded={open.has(item.position)} onToggle={() => toggle(item.position)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({ item, expanded, onToggle }: { item: LiveReportItem; expanded: boolean; onToggle: () => void }) {
  const { t, locale } = useI18n();
  const detailId = `report-item-${item.position}`;
  const pBand = difficultyBand(item.p);
  const dBand = discriminationBand(item.discrimination);
  const flags = sortFlags(item.flags);
  const dominant = dominantDistractor(item);
  const expandable = item.options.length > 0 || Boolean(item.top_answers?.length);

  return (
    <Fragment>
      <tr className={cn("border-b border-line align-top", expanded && "bg-surface-muted/40")}>
        <td className="px-3 py-3 font-mono text-xs font-semibold text-fg-muted">{item.position + 1}</td>
        <td className="px-3 py-3">
          <div className="flex items-start gap-2">
            <ItemTypeIcon type={item.item_type} className="mt-0.5 shrink-0 text-fg-subtle" aria-label={t(`quizBuilder.types.${item.item_type}.name`)} aria-hidden={false} role="img" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="line-clamp-2 text-fg print:line-clamp-none">{item.prompt}</span>
              <span className="flex flex-wrap gap-x-3 text-xs text-fg-muted">
                <span>{t("quizReports.items.answered", { count: item.answered })}</span>
                {item.domain ? <span>{item.domain}</span> : null}
                {!item.scored ? <span>{t("quizReports.items.notScored")}</span> : null}
              </span>
            </div>
          </div>
        </td>
        <td className="px-3 py-3 text-right whitespace-nowrap">
          <span className="nums font-medium text-fg">{formatDecimal(item.p, locale)}</span>
          {pBand ? <span className="block text-xs text-fg-muted">{t(`quizReports.items.difficulty.${pBand}`)}</span> : null}
        </td>
        <td className="px-3 py-3 text-right whitespace-nowrap">
          <span className={cn("nums font-medium", dBand === "negative" ? "text-danger" : "text-fg")}>{formatDecimal(item.discrimination, locale)}</span>
          {dBand ? <span className="block text-xs text-fg-muted">{t(`quizReports.items.discrimination.${dBand}`)}</span> : null}
        </td>
        <td className="nums px-3 py-3 text-right whitespace-nowrap text-fg">{formatDuration(item.median_ms, locale)}</td>
        <td className="px-3 py-3">
          {flags.length ? (
            <ul className="flex flex-col items-start gap-1">
              {flags.map((flag) => (
                <li key={flag}>
                  <Badge tone={flagTone(flag)} title={t(`quizReports.items.flags.${flag}.explanation`)}>
                    {flagTone(flag) !== "neutral" ? <AlertIcon /> : null}
                    {t(`quizReports.items.flags.${flag}.label`)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fg-subtle">–</span>
          )}
        </td>
        <td className="px-2 py-2.5 print:hidden">
          {expandable ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={detailId}
              aria-label={expanded ? t("quizReports.items.collapse", { position: item.position + 1 }) : t("quizReports.items.expand", { position: item.position + 1 })}
              onClick={onToggle}
              className="focus-ring grid size-8 place-items-center rounded-md text-fg-muted hover:bg-surface-muted hover:text-fg"
            >
              <ChevronDownIcon className={cn("transition-transform duration-200", expanded && "rotate-180")} />
            </button>
          ) : null}
        </td>
      </tr>
      <tr id={detailId} hidden={!expanded} className="border-b border-line bg-surface-muted/30">
        <td />
        <td colSpan={6} className="px-3 pt-2 pb-5">
          <div className="flex flex-col gap-4 motion-safe:animate-[rise-in_200ms_var(--ease-out)]">
            {flags.length ? (
              <ul className="flex flex-col gap-1 text-[0.8125rem] text-fg-muted">
                {flags.map((flag) => (
                  <li key={flag}>
                    <span className="font-medium text-fg">{t(`quizReports.items.flags.${flag}.label`)}:</span>{" "}
                    {t(`quizReports.items.flags.${flag}.explanation`)}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.options.length ? <DistractorChart item={item} /> : null}
            {dominant ? (
              <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[0.8125rem] text-fg">
                <AlertIcon className="mt-0.5 shrink-0 text-warning" />
                {t("quizReports.items.dominant", { letter: dominant.key })}
              </p>
            ) : null}
            {item.top_answers?.length ? (
              <div className="flex flex-col gap-2">
                <p className="text-[0.8125rem] font-semibold text-fg">{t("quizReports.items.topAnswers")}</p>
                <ul className="flex flex-wrap gap-1.5">
                  {item.top_answers.map((answer) => (
                    <li
                      key={answer.text}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8125rem]",
                        answer.accepted ? "border-success/40 bg-success-soft text-fg" : "border-line bg-surface text-fg"
                      )}
                    >
                      <span>{answer.text}</span>
                      <span className="nums text-xs text-fg-muted">×{answer.n}</span>
                      <span className="text-xs font-medium">
                        {answer.accepted ? `✓ ${t("quizReports.items.accepted")}` : t("quizReports.items.notAccepted")}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </td>
      </tr>
    </Fragment>
  );
}
