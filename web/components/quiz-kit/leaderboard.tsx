"use client";

import { AnimatePresence, LayoutGroup, m } from "motion/react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { Avatar } from "@/components/quiz-kit/avatar";
import { springs, staggerDelay, useLqReducedMotion } from "@/components/quiz-kit/motion";
import type { Standing } from "@/features/quiz-live/lib/protocol";
import { cn } from "@/lib/utils/cn";

export interface LeaderboardLabels {
  points: string;
  up: (n: number) => string;
  down: (n: number) => string;
  same: string;
  biggestClimb: string;
  rankOrdinal: (rank: number) => string;
}

/** Rank delta ▲n / ▼n with text for screen readers (never colour only). */
export function RankDelta({ delta, labels, className }: { delta: number; labels: Pick<LeaderboardLabels, "up" | "down" | "same">; className?: string }) {
  if (!delta) {
    return (
      <span className={cn("font-lq-mono text-lq-fg-muted", className)}>
        <span aria-hidden="true">–</span>
        <span className="sr-only">{labels.same}</span>
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-lq-mono font-medium", up ? "text-lq-success" : "text-lq-fg-muted", className)}>
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span aria-hidden="true">{Math.abs(delta)}</span>
      <span className="sr-only">{up ? labels.up(delta) : labels.down(Math.abs(delta))}</span>
    </span>
  );
}

/**
 * Top-N leaderboard. Rows reorder with FLIP (Motion `layout`, spring "layout"); scores count up;
 * the biggest climber gets a luminous trail. Reduced motion: instant swap, arrows remain.
 */
export function Leaderboard({
  standings,
  labels,
  highlightId,
  size = "stage",
  className
}: {
  standings: Standing[];
  labels: LeaderboardLabels;
  highlightId?: string | null;
  size?: "stage" | "compact";
  className?: string;
}) {
  const reduced = useLqReducedMotion();
  const climber = standings.reduce<Standing | null>((best, entry) => (entry.delta > 0 && (!best || entry.delta > best.delta) ? entry : best), null);
  const stage = size === "stage";

  return (
    <LayoutGroup>
      <ol className={cn("flex w-full flex-col", stage ? "gap-[clamp(0.4rem,1.2cqh,1rem)]" : "gap-2", className)}>
        <AnimatePresence initial={!reduced}>
          {standings.map((entry, index) => {
            const isClimber = climber?.participant_id === entry.participant_id;
            const isMe = highlightId === entry.participant_id;
            return (
              <m.li
                key={entry.participant_id}
                layout={reduced ? false : "position"}
                initial={{ x: -32 }}
                animate={{ x: 0 }}
                exit={{ x: 32 }}
                transition={{ ...springs.layout, delay: reduced ? 0 : staggerDelay(index, standings.length, 0.06) }}
                className={cn(
                  "relative flex items-center overflow-hidden rounded-[var(--lq-radius)] border-[length:max(1px,var(--lq-border-w))] border-lq-line bg-lq-surface",
                  stage ? "gap-[clamp(0.75rem,2cqw,1.75rem)] px-[clamp(0.75rem,2cqw,2rem)] py-[clamp(0.5rem,1.4cqh,1.1rem)]" : "gap-3 px-3 py-2.5",
                  isMe && "border-lq-accent bg-lq-surface-2",
                  entry.rank === 1 && "bg-lq-surface-2"
                )}
              >
                {isClimber && !reduced ? (
                  <m.span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-[linear-gradient(90deg,transparent,var(--lq-glow),transparent)]"
                    initial={{ x: "-100%" }}
                    animate={{ x: "160%" }}
                    transition={{ duration: 1.1, delay: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                  />
                ) : null}
                <span
                  className={cn(
                    "relative grid shrink-0 place-items-center rounded-full font-lq-mono font-medium tabular-nums",
                    stage ? "size-[clamp(2.25rem,5cqmin,4rem)] text-[clamp(1rem,2.4cqmin,1.9rem)]" : "size-9 text-base",
                    entry.rank <= 3 ? "bg-lq-accent text-lq-on-accent" : "bg-lq-surface-2 text-lq-fg"
                  )}
                >
                  <span aria-hidden="true">{entry.rank}</span>
                  <span className="sr-only">{labels.rankOrdinal(entry.rank)}</span>
                </span>
                <Avatar seed={entry.avatar_seed} size={stage ? 52 : 36} className={stage ? "size-[clamp(2.25rem,5.2cqmin,4.25rem)]" : undefined} />
                <span className={cn("relative min-w-0 flex-1 truncate font-lq font-bold text-lq-fg", stage ? "text-[clamp(1.1rem,3cqmin,2.6rem)]" : "text-base")}>
                  {entry.display_name}
                  {isClimber ? (
                    <span className={cn("ml-3 rounded-full bg-lq-accent px-2 py-0.5 align-middle font-lq-mono font-medium text-lq-on-accent", stage ? "text-[clamp(0.7rem,1.3cqmin,1rem)]" : "text-[0.65rem]")}>
                      {labels.biggestClimb}
                    </span>
                  ) : null}
                </span>
                <RankDelta delta={entry.delta} labels={labels} className={stage ? "text-[clamp(0.9rem,2cqmin,1.6rem)]" : "text-sm"} />
                <span className={cn("relative text-right font-lq font-extrabold text-lq-fg", stage ? "min-w-[6ch] text-[clamp(1.1rem,3cqmin,2.6rem)]" : "min-w-[5ch] text-base")}>
                  <AnimatedNumber value={entry.score} />
                  <span className="sr-only"> {labels.points}</span>
                </span>
              </m.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </LayoutGroup>
  );
}
