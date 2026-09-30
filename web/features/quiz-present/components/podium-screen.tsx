"use client";

import type { ReactNode } from "react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { Podium } from "@/components/quiz-kit/podium";
import type { PodiumStats, Standing } from "@/features/quiz-live/lib/protocol";
import { useI18n } from "@/lib/i18n";

/** Lazy-loaded (next/dynamic) with canvas-confetti: only the stage at the end of a session pays for it. */
export function PodiumScreen({ top, stats, calm }: { top: Standing[]; stats: PodiumStats; calm: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center px-[5cqw] pt-[4cqh] pb-[3cqh]">
      <h1 className="font-lq text-[max(1.5rem,5.5cqmin)] font-black text-lq-fg">{t("quizPresent.podium.title")}</h1>
      <div className="flex min-h-0 w-full flex-1">
        <Podium
          top={top}
          calm={calm}
          labels={{
            drumroll: t("quizPresent.podium.drumroll"),
            skip: t("quizPresent.podium.skip"),
            place: (rank) => t("quizPresent.podium.place", { rank }),
            points: t("quizPresent.podium.points"),
            winner: t("quizPresent.podium.winner")
          }}
        >
          <dl className="flex flex-wrap items-stretch justify-center gap-[2cqw]">
            <Stat label={t("quizPresent.podium.participants")}>
              <AnimatedNumber value={stats.participants} from={0} />
            </Stat>
            {stats.avg_pct !== null ? (
              <Stat label={t("quizPresent.podium.avgPct")}>
                <AnimatedNumber value={Math.round(stats.avg_pct)} from={0} suffix="%" />
              </Stat>
            ) : null}
            {stats.hardest_qi !== null ? <Stat label={t("quizPresent.podium.hardest")}>{t("quizPresent.podium.hardestValue", { n: stats.hardest_qi + 1 })}</Stat> : null}
          </dl>
        </Podium>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-[16cqw] flex-col items-center rounded-[var(--lq-radius)] border border-lq-line bg-lq-surface px-[2cqmin] py-[1.2cqmin]">
      <dt className="text-[max(0.75rem,1.7cqmin)] font-semibold tracking-[0.08em] text-lq-fg-muted uppercase">{label}</dt>
      <dd className="font-lq text-[max(1.25rem,4cqmin)] font-black text-lq-fg">{children}</dd>
    </div>
  );
}
