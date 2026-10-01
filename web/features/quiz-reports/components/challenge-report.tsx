"use client";

import { AttemptsDistribution, FunnelBars } from "@/features/quiz-challenge/components/challenge-widgets";
import { formatDurationShort } from "@/features/quiz-challenge/lib/challenge-time";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { LiveReportChallenge } from "@/types/api";

/**
 * Report block of a self-paced challenge (CONTRATO-INCREMENTO-6 §2 "Relatório"): the funnel (who
 * opened, joined, started, finished), the attempts per person, the median duration and how many
 * attempts were flagged as a possible repeat (RF-813). The rest of the report counts one attempt
 * per participant: the best finished one.
 */
export function ChallengeReportBlock({ block }: { block: LiveReportChallenge }) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(locale);
  const stats = [
    { id: "attempts", label: t("quizChallenge.report.attempts"), value: number.format(block.attempts) },
    { id: "median", label: t("quizChallenge.report.median"), value: formatDurationShort(block.median_duration_ms) },
    { id: "repeat", label: t("quizChallenge.report.repeat"), value: number.format(block.repeat_suspects), warn: block.repeat_suspects > 0 }
  ];
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.id} className={cn("flex flex-col gap-1.5 rounded-lg border bg-surface p-4", stat.warn ? "border-warning/40" : "border-line")}>
            <dt className="text-[0.8125rem] text-fg-muted">{stat.label}</dt>
            <dd className="nums text-[1.75rem] leading-none font-semibold tracking-tight text-fg">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {block.repeat_suspects > 0 ? <p className="text-[0.8125rem] text-fg-muted">{t("quizChallenge.report.repeatHint")}</p> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{t("quizChallenge.funnel.title")}</h3>
          <FunnelBars funnel={block.funnel} />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{t("quizChallenge.attempts.title")}</h3>
          <AttemptsDistribution distribution={block.attempts_per_person} />
        </div>
      </div>
    </div>
  );
}
