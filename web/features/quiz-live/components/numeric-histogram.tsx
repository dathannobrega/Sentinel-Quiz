"use client";

import { formatWithUnit, statDecimals, histogramBins, rangeFraction } from "@/features/quiz-live/lib/numeric";
import type { NumericResults } from "@/features/quiz-live/lib/protocol";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

const VARIANTS = {
  stage: {
    root: "gap-[1.4cqh]",
    chart: "min-h-[18cqh]",
    gap: "gap-[0.35cqw]",
    axis: "text-[max(0.8rem,1.9cqmin)]",
    chip: "text-[max(0.8rem,1.9cqmin)] px-[1.2cqmin] py-[0.4cqmin]",
    stats: "text-[max(0.8rem,1.9cqmin)]"
  },
  compact: {
    root: "gap-2",
    chart: "min-h-32",
    gap: "gap-px",
    axis: "text-xs",
    chip: "text-xs px-2 py-0.5",
    stats: "text-sm"
  }
} as const;

/**
 * Numeric distribution (T06): 20 bars over the author's range. With the answer known (reveal on
 * the stage/presenter, or on a phone when the quiz shows it) a band marks the tolerance and a line
 * the correct value; `mine` marks the person's own number. Mean, median and n are written out, and
 * a visually hidden summary carries every bin for screen readers.
 */
export function NumericHistogram({
  result,
  unit,
  value = null,
  tolerance = null,
  mine = null,
  variant = "stage",
  className
}: {
  result: NumericResults;
  unit: string;
  value?: number | null;
  tolerance?: number | null;
  mine?: number | null;
  variant?: "stage" | "compact";
  className?: string;
}) {
  const { t, locale } = useI18n();
  const styles = VARIANTS[variant];
  const bins = histogramBins(result);
  const known = typeof value === "number";
  const band = known && typeof tolerance === "number" && tolerance > 0 ? { from: value - tolerance, to: value + tolerance } : null;
  const fmt = (number: number | null | undefined) => formatWithUnit(number, unit, locale, 4);
  const at = (number: number) => `${rangeFraction(number, result.min, result.max) * 100}%`;
  const inBand = (from: number, to: number) => (band ? to >= band.from && from <= band.to : known ? value >= from && value <= to : false);

  return (
    <figure className={cn("flex min-h-0 flex-col", styles.root, className)}>
      <div className={cn("relative min-h-0 flex-1", styles.chart)}>
        {band ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-sm border-x-2 border-dashed border-lq-success bg-[color-mix(in_srgb,var(--lq-success)_16%,transparent)]"
            style={{ left: at(band.from), width: `calc(${at(band.to)} - ${at(band.from)})` }}
          />
        ) : null}
        <div aria-hidden="true" className={cn("absolute inset-0 flex items-end", styles.gap)}>
          {bins.map((bin) => (
            <span key={bin.index} className="flex h-full min-w-0 flex-1 items-end">
              <span
                className={cn("lq-hist-bar block w-full rounded-t-[3px]", known && inBand(bin.from, bin.to) ? "bg-lq-success" : "bg-lq-accent")}
                style={{ height: "100%", transform: `scaleY(${bin.count > 0 ? Math.max(0.03, bin.height) : 0})` }}
              />
            </span>
          ))}
        </div>
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-lq-line" />
        {known ? (
          <span aria-hidden="true" className="absolute inset-y-0 w-0 border-l-[3px] border-lq-success" style={{ left: at(value) }}>
            <span className={cn("absolute -top-1 left-0 -translate-x-1/2 -translate-y-full rounded-full bg-lq-success font-bold whitespace-nowrap text-lq-on-success", styles.chip)}>
              ✓ {fmt(value)}
            </span>
          </span>
        ) : null}
        {typeof mine === "number" ? (
          <span aria-hidden="true" className="absolute inset-y-0 w-0 border-l-[3px] border-dashed border-lq-fg" style={{ left: at(mine) }}>
            <span className={cn("absolute bottom-1 left-1 rounded-full border border-lq-line bg-lq-surface font-bold whitespace-nowrap text-lq-fg", styles.chip)}>
              {t("quizPresent.numeric.you", { value: fmt(mine) })}
            </span>
          </span>
        ) : null}
      </div>
      <div aria-hidden="true" className={cn("flex justify-between gap-2 font-lq-mono text-lq-fg-muted", styles.axis)}>
        <span>{fmt(result.min)}</span>
        <span>{fmt(result.max)}</span>
      </div>
      <figcaption className={cn("flex flex-wrap gap-x-4 gap-y-1 font-semibold text-lq-fg", styles.stats)}>
        <span>{t("quizPresent.numeric.count", { count: new Intl.NumberFormat(locale).format(result.n) })}</span>
        {result.mean !== null ? <span>{t("quizPresent.numeric.mean", { value: formatWithUnit(result.mean, unit, locale, statDecimals(result.min, result.max)) })}</span> : null}
        {result.median !== null ? <span>{t("quizPresent.numeric.median", { value: fmt(result.median) })}</span> : null}
        {known ? (
          <span className="text-lq-success">
            {band ? t("quizPresent.numeric.answerTolerance", { value: fmt(value), tolerance: formatWithUnit(tolerance, unit, locale, 4) }) : t("quizPresent.numeric.answer", { value: fmt(value) })}
          </span>
        ) : null}
        <span className="sr-only">
          {bins
            .filter((bin) => bin.count > 0)
            .map((bin) => t("quizPresent.numeric.binSummary", { from: fmt(bin.from), to: fmt(bin.to), count: bin.count }))
            .join("; ")}
        </span>
      </figcaption>
    </figure>
  );
}
