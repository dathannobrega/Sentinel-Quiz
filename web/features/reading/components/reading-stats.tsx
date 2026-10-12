"use client";

import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatList } from "@/components/ui/stat";
import { formatCount, scoreToPercent, secondsToMinutes } from "@/features/reading/lib/format";
import { useReadingStatsQuery } from "@/features/reading/hooks";
import { useI18n } from "@/lib/i18n";

/** Reading and shadowing totals (GET /api/reading/stats). Silent on error: the library still works. */
export function ReadingStats() {
  const { t, locale } = useI18n();
  const query = useReadingStatsQuery();

  if (query.isError) {
    return null;
  }

  if (query.isPending) {
    return (
      <Section title={t("reading.stats.title")} aria-busy="true">
        <Skeleton height={72} />
      </Section>
    );
  }

  const stats = query.data;
  const avg = stats.avg_overall === null ? "-" : `${scoreToPercent(stats.avg_overall)}%`;
  return (
    <Section title={t("reading.stats.title")}>
      <StatList>
        <Stat label={t("reading.stats.attempts")} value={formatCount(stats.attempts, locale)} />
        <Stat
          label={t("reading.stats.avgOverall")}
          value={avg}
          meta={stats.best_overall !== null && stats.attempts > 0 ? t("reading.stats.bestOverall", { percent: scoreToPercent(stats.best_overall) }) : undefined}
        />
        <Stat label={t("reading.stats.wordsRead")} value={formatCount(stats.words_read, locale)} />
        <Stat label={t("reading.stats.minutesListened")} value={formatCount(secondsToMinutes(stats.seconds_listened), locale)} />
        <Stat label={t("reading.stats.activeDays")} value={formatCount(stats.active_days_30, locale)} />
      </StatList>
    </Section>
  );
}
