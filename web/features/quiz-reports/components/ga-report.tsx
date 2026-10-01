"use client";

import { CheckIcon } from "@/components/ui/icons";
import { formatWithUnit, statDecimals, histogramBins, rangeFraction } from "@/features/quiz-live/lib/numeric";
import { barWidth, formatPercent, pctValue, rateToPercent } from "@/features/quiz-reports/lib/report-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportItem, LiveReportNumeric, LiveReportOrdering, LiveReportWordCloud } from "@/types/api";

/** Report blocks of the GA item types (Incremento 5 §8), next to the distractor chart. */
export function GaReportDetail({ item }: { item: LiveReportItem }) {
  if (item.ordering) {
    return <OrderingReport ordering={item.ordering} />;
  }
  if (item.numeric) {
    return <NumericReport numeric={item.numeric} />;
  }
  if (item.word_cloud) {
    return <WordCloudReport cloud={item.word_cloud} />;
  }
  return null;
}

/** Correct order with the share of answers that put the right item in each slot. */
export function OrderingReport({ ordering }: { ordering: LiveReportOrdering }) {
  const { t, locale } = useI18n();
  const avg = rateToPercent(ordering.avg_fraction);
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold text-fg">{t("quizReports.ga.orderingTitle")}</span>
        <span className="text-xs text-fg-muted">{t(`quizReports.ga.methods.${ordering.method}`)}</span>
      </figcaption>
      <ol className="flex flex-col gap-2.5">
        {ordering.correct_order.map((text, index) => {
          const pct = pctValue(ordering.slot_pct_correct[index]);
          const summary = t("quizReports.ga.slotSummary", { position: index + 1, text, percent: formatPercent(pct, locale) });
          return (
            <li key={`${index}-${text}`} className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)_4.5rem] items-center gap-3 max-sm:grid-cols-[minmax(0,1fr)_4.5rem]">
              <span className="flex min-w-0 items-center gap-2 text-[0.8125rem] max-sm:col-span-2">
                <span className="font-mono text-xs font-semibold text-fg-muted">{index + 1}</span>
                <span className="truncate text-fg" title={text}>
                  {text}
                </span>
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
                    width={`${barWidth(pct ?? 0)}%`}
                    className="origin-left fill-[var(--color-success)] motion-safe:animate-[grow-x_520ms_var(--ease-out)_both] print:animate-none"
                    style={{ animationDelay: `${index * 50}ms` }}
                  />
                </svg>
              </span>
              <span aria-hidden="true" className="nums text-right text-[0.8125rem] font-medium text-fg">
                {formatPercent(pct, locale)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-fg-muted">
        {t("quizReports.ga.orderingStats", { exact: ordering.exact, avg: formatPercent(avg, locale) })}
      </p>
    </figure>
  );
}

/** 20-bin histogram over the author's range with the tolerance band and the correct value. */
export function NumericReport({ numeric }: { numeric: LiveReportNumeric }) {
  const { t, locale } = useI18n();
  const bins = histogramBins(numeric);
  const fmt = (value: number | null | undefined) => formatWithUnit(value, numeric.unit, locale, 4);
  const at = (value: number) => rangeFraction(value, numeric.min, numeric.max) * 100;
  const value = numeric.value;
  const band = value !== null && numeric.tolerance > 0 ? { from: value - numeric.tolerance, to: value + numeric.tolerance } : null;
  const hit = (from: number, to: number) => (value === null ? false : band ? to >= band.from && from <= band.to : value >= from && value <= to);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.8125rem] font-semibold text-fg">{t("quizReports.ga.numericTitle")}</span>
        {value !== null ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckIcon size={12} />
            {band ? t("quizReports.ga.numericAnswerTolerance", { value: fmt(value), tolerance: fmt(numeric.tolerance) }) : t("quizReports.ga.numericAnswer", { value: fmt(value) })}
          </span>
        ) : null}
      </figcaption>
      <div className="relative h-32" aria-hidden="true">
        {band ? (
          <span
            className="absolute inset-y-0 border-x border-dashed border-success bg-success-soft/60"
            style={{ left: `${at(band.from)}%`, width: `${at(band.to) - at(band.from)}%` }}
          />
        ) : null}
        <div className="absolute inset-0 flex items-end gap-px">
          {bins.map((bin) => (
            <span key={bin.index} className="flex h-full min-w-0 flex-1 items-end" title={`${fmt(bin.from)} – ${fmt(bin.to)}: ${bin.count}`}>
              <span
                className={cn("block w-full rounded-t-[2px]", hit(bin.from, bin.to) ? "bg-success" : "bg-primary")}
                style={{ height: `${bin.count > 0 ? Math.max(3, bin.height * 100) : 0}%` }}
              />
            </span>
          ))}
        </div>
        <span className="absolute inset-x-0 bottom-0 h-px bg-line-strong" />
        {value !== null ? <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-success" style={{ left: `${at(value)}%` }} /> : null}
      </div>
      <div className="flex justify-between font-mono text-xs text-fg-muted" aria-hidden="true">
        <span>{fmt(numeric.min)}</span>
        <span>{fmt(numeric.max)}</span>
      </div>
      <p className="text-xs text-fg-muted">
        {t("quizReports.ga.numericStats", {
          n: numeric.n,
          mean: numeric.mean === null ? "–" : formatWithUnit(numeric.mean, numeric.unit, locale, statDecimals(numeric.min, numeric.max)),
          median: numeric.median === null ? "–" : fmt(numeric.median)
        })}
      </p>
      <p className="sr-only">
        {bins
          .filter((bin) => bin.count > 0)
          .map((bin) => t("quizReports.ga.binSummary", { from: fmt(bin.from), to: fmt(bin.to), count: bin.count }))
          .join("; ")}
      </p>
    </figure>
  );
}

/** Every word with its count; words the host hid stay listed, marked (never silently dropped). */
export function WordCloudReport({ cloud }: { cloud: LiveReportWordCloud }) {
  const { t, locale } = useI18n();
  const top = Math.max(1, ...cloud.words.map((word) => word.n));
  const format = new Intl.NumberFormat(locale);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.8125rem] font-semibold text-fg">
        {t("quizReports.ga.wordsTitle")} <span className="font-normal text-fg-muted">· {t("quizReports.ga.wordsDistinct", { count: format.format(cloud.distinct) })}</span>
      </p>
      {cloud.words.length ? (
        <ul className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          {cloud.words.map((word) => (
            <li
              key={word.key}
              className={cn("inline-flex items-baseline gap-1", word.hidden ? "text-fg-subtle" : "text-fg")}
              style={{ fontSize: `${0.8125 + (word.n / top) * 0.9}rem` }}
            >
              <span className={cn("font-semibold", word.hidden && "line-through")}>{word.text}</span>
              <span className="nums text-xs text-fg-muted">×{format.format(word.n)}</span>
              {word.hidden ? <span className="text-xs text-fg-muted">({t("quizReports.ga.hidden")})</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{t("quizReports.ga.noWords")}</p>
      )}
    </div>
  );
}
