"use client";

import { Badge } from "@/components/ui/badge";
import { AlertIcon, CircleCheckIcon, CircleXIcon, InfoIcon } from "@/components/ui/icons";
import { bandTone, barWidth, formatPercent, pctValue } from "@/features/quiz-reports/lib/report-format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveDomainBand, LiveReportDomain } from "@/types/api";

const BAND_ICON: Record<LiveDomainBand, typeof InfoIcon> = {
  ready: CircleCheckIcon,
  approaching: AlertIcon,
  not_ready: CircleXIcon,
  insufficient_data: InfoIcon
};

const BAND_FILL: Record<LiveDomainBand, string> = {
  ready: "bg-success",
  approaching: "bg-warning",
  not_ready: "bg-danger",
  insufficient_data: "bg-line-strong"
};

/** Clean bar list: domain, % correct bar, band badge (icon + label, never colour alone). */
export function DomainBars({ domains }: { domains: LiveReportDomain[] }) {
  const { t, locale } = useI18n();
  const sorted = [...domains].sort((a, b) => (pctValue(a.pct_correct) ?? 0) - (pctValue(b.pct_correct) ?? 0));
  return (
    <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
      {sorted.map((domain, index) => {
        const pct = pctValue(domain.pct_correct);
        const Icon = BAND_ICON[domain.band] ?? InfoIcon;
        const insufficient = domain.band === "insufficient_data";
        return (
          <li key={`${domain.certification ?? "-"}-${domain.domain}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-fg" title={domain.domain}>
                {domain.domain}
              </p>
              <p className="text-xs text-fg-muted">
                {domain.certification ?? t("quizReports.domains.noCertification")} ·{" "}
                {t("quizReports.domains.meta", { items: domain.items, answers: domain.answers })}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className={cn(
                    "block h-full origin-left rounded-full motion-safe:animate-[grow-x_600ms_var(--ease-out)_both]",
                    BAND_FILL[domain.band],
                    insufficient && "[background-image:repeating-linear-gradient(135deg,transparent_0_3px,var(--color-surface)_3px_5px)]"
                  )}
                  style={{ width: `${barWidth(pct)}%`, animationDelay: `${index * 50}ms` }}
                />
              </span>
              <span className="nums w-12 text-right text-sm font-semibold text-fg">{formatPercent(pct, locale)}</span>
            </div>
            <Badge tone={bandTone(domain.band)} className="justify-self-start sm:justify-self-end">
              <Icon />
              {t(`quizReports.domains.bands.${domain.band}`)}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
