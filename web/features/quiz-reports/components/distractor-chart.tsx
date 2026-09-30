"use client";

import { CheckIcon } from "@/components/ui/icons";
import { barWidth, formatPercent, pctValue } from "@/features/quiz-reports/lib/report-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportItem } from "@/types/api";

/**
 * Horizontal bars per option (0–100 %). The correct option is marked with a check icon and the word
 * "Correta" (not colour only). When the 27 % groups exist, ▲ (top) and ▼ (bottom) markers sit on the
 * same scale, so the upper/lower comparison reads without a legend lookup. Each row has a text
 * summary for screen readers and print.
 */
export function DistractorChart({ item }: { item: LiveReportItem }) {
  const { t, locale } = useI18n();
  const hasGroups = item.options.some((option) => option.upper_pct !== null || option.lower_pct !== null);
  if (!item.options.length) {
    return <p className="text-sm text-fg-muted">{t("quizReports.items.noOptions")}</p>;
  }
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold text-fg">{t("quizReports.items.distractors")}</span>
        {hasGroups ? (
          <span className="flex items-center gap-3 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="text-fg">▼</span>
              {t("quizReports.items.upper")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="text-fg-muted">▲</span>
              {t("quizReports.items.lower")}
            </span>
          </span>
        ) : null}
      </figcaption>
      <ul className="flex flex-col gap-2.5">
        {item.options.map((option, index) => {
          const pct = pctValue(option.pct) ?? 0;
          const upper = pctValue(option.upper_pct);
          const lower = pctValue(option.lower_pct);
          const summary = [
            `${option.key}: ${formatPercent(pct, locale)} (${option.count})`,
            option.correct ? t("quizReports.items.correct") : null,
            upper !== null ? `${t("quizReports.items.upper")} ${formatPercent(upper, locale)}` : null,
            lower !== null ? `${t("quizReports.items.lower")} ${formatPercent(lower, locale)}` : null
          ]
            .filter(Boolean)
            .join(", ");
          return (
            <li key={option.key} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_4.5rem]">
              <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] max-sm:col-span-2">
                <span className="font-mono text-xs font-semibold text-fg-muted">{option.key}</span>
                <span className={cn("truncate", option.correct ? "font-semibold text-fg" : "text-fg")} title={option.text}>
                  {option.text}
                </span>
                {option.correct ? (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-success-soft px-1 text-[0.6875rem] font-semibold text-success">
                    <CheckIcon size={12} />
                    {t("quizReports.items.correct")}
                  </span>
                ) : null}
              </span>
              <span className="relative h-5" title={summary}>
                <span className="sr-only">{summary}</span>
                <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
                  <rect x="0" y="6" width="100%" height="8" rx="4" className="fill-[var(--color-surface-muted)]" />
                  <rect
                    x="0"
                    y="6"
                    height="8"
                    rx="4"
                    width={`${barWidth(pct)}%`}
                    className={cn(
                      "origin-left motion-safe:animate-[grow-x_520ms_var(--ease-out)_both] print:animate-none",
                      option.correct ? "fill-[var(--color-success)]" : "fill-[var(--color-primary)]"
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  />
                </svg>
                {upper !== null ? (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1.5 -translate-x-1/2 text-[0.625rem] leading-none text-fg"
                    style={{ left: `${Math.min(100, upper)}%` }}
                  >
                    ▼
                  </span>
                ) : null}
                {lower !== null ? (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-1.5 -translate-x-1/2 text-[0.625rem] leading-none text-fg-muted"
                    style={{ left: `${Math.min(100, lower)}%` }}
                  >
                    ▲
                  </span>
                ) : null}
              </span>
              <span aria-hidden="true" className="nums text-right text-[0.8125rem] font-medium text-fg">
                {formatPercent(pct, locale)}
                <span className="ml-1 text-xs font-normal text-fg-muted">({option.count})</span>
              </span>
            </li>
          );
        })}
      </ul>
      {hasGroups ? <p className="text-xs text-fg-muted">{t("quizReports.items.distractorsHint")}</p> : null}
    </figure>
  );
}
