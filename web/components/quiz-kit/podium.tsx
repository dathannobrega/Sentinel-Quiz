"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { Avatar } from "@/components/quiz-kit/avatar";
import { fireConfetti, resetConfetti } from "@/components/quiz-kit/confetti";
import { springs, useLqReducedMotion } from "@/components/quiz-kit/motion";
import type { Standing } from "@/features/quiz-live/lib/protocol";
import { cn } from "@/lib/utils/cn";

export interface PodiumLabels {
  drumroll: string;
  skip: string;
  place: (rank: number) => string;
  points: string;
  winner: string;
}

/** Suspense timeline (ms): drumroll → 3rd → 2nd → 1st (+ spotlight, confetti) → done. */
export const PODIUM_TIMELINE = [1500, 1200, 1200, 1400] as const;

const HEIGHTS: Record<number, string> = { 1: "62%", 2: "46%", 3: "34%" };
const ORDER = [2, 1, 3];

export function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3Zm-1 4v1a2 2 0 0 0 2 2V7Zm12 0h-2v3a2 2 0 0 0 2-2Z" />
    </svg>
  );
}

/**
 * Final podium (≈ 5 s, skippable): drumroll, then 3rd → 2nd → 1st rise with `back` easing, the
 * winner gets a spotlight and confetti from both sides + fireworks. Reduced motion / calm: the final
 * frame with a static trophy, no confetti.
 */
export function Podium({
  top,
  labels,
  calm = false,
  onDone,
  children
}: {
  top: Standing[];
  labels: PodiumLabels;
  calm?: boolean;
  onDone?: () => void;
  /** Room stats shown under the podium once it settles. */
  children?: ReactNode;
}) {
  const reduced = useLqReducedMotion() || calm;
  const [step, setStep] = useState(reduced ? 4 : 0);
  const shown = reduced ? 4 : step;

  useEffect(() => {
    if (reduced || step >= 4) {
      return undefined;
    }
    const timer = setTimeout(() => setStep((value) => value + 1), PODIUM_TIMELINE[step]);
    return () => clearTimeout(timer);
  }, [step, reduced]);

  useEffect(() => {
    if (shown === 3 && !reduced) {
      void fireConfetti("sides", { calm });
      const timer = setTimeout(() => void fireConfetti("fireworks", { calm }), 700);
      return () => clearTimeout(timer);
    }
    if (shown === 4) {
      onDone?.();
    }
    return undefined;
  }, [shown, reduced, calm, onDone]);

  useEffect(() => () => resetConfetti(), []);

  const byRank = new Map(top.map((entry) => [entry.rank, entry]));
  const visible = (rank: number) => (rank === 3 ? shown >= 1 : rank === 2 ? shown >= 2 : shown >= 3);

  return (
    <div className="relative flex size-full flex-col items-center">
      <AnimatePresence>
        {shown === 0 ? (
          <m.p
            key="drumroll"
            className="absolute top-1/3 font-lq text-[clamp(1.5rem,5cqmin,4rem)] font-extrabold text-lq-fg"
            initial={{ scale: 0.9 }}
            animate={{ scale: [0.9, 1.04, 0.98, 1.04, 1] }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 1.4 }}
          >
            {labels.drumroll}
          </m.p>
        ) : null}
      </AnimatePresence>

      {shown >= 3 && !reduced ? (
        <m.div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-20%] left-1/2 h-[120%] w-[42cqw] -translate-x-1/2 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--lq-accent)_40%,transparent),transparent_70%)]"
          initial={{ opacity: 0, scaleX: 0.4 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.7, ease: [0.05, 0.7, 0.1, 1] }}
        />
      ) : null}

      <ol className="relative mt-auto flex h-[78%] w-full max-w-[min(100%,72rem)] items-end justify-center gap-[clamp(0.75rem,2.5cqw,2.5rem)]">
        {ORDER.map((rank) => {
          const entry = byRank.get(rank);
          if (!entry) {
            return <li key={rank} className="flex-1" aria-hidden="true" />;
          }
          const isVisible = visible(rank);
          return (
            <li key={rank} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" aria-hidden={!isVisible || undefined}>
              {isVisible ? (
                <m.div
                  className="mb-3 flex min-w-0 flex-col items-center gap-2 text-center"
                  initial={reduced ? false : { y: -120, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ ...springs.bouncy, delay: reduced ? 0 : 0.45 }}
                >
                  {rank === 1 && reduced ? <TrophyIcon className="size-[clamp(2rem,6cqmin,4.5rem)] text-lq-warning" /> : null}
                  <Avatar seed={entry.avatar_seed} size={96} className={rank === 1 ? "size-[clamp(3.5rem,11cqmin,8rem)]" : "size-[clamp(2.75rem,8cqmin,6rem)]"} />
                  <span className={cn("max-w-full truncate font-lq font-extrabold text-lq-fg", rank === 1 ? "text-[clamp(1.25rem,4cqmin,3.25rem)]" : "text-[clamp(1rem,3cqmin,2.25rem)]")}>
                    {entry.display_name}
                  </span>
                  <span className="font-lq-mono text-[clamp(0.9rem,2.2cqmin,1.6rem)] text-lq-fg-muted">
                    <AnimatedNumber value={entry.score} from={0} delay={reduced ? 0 : 0.6} /> {labels.points}
                  </span>
                </m.div>
              ) : null}
              <m.div
                className={cn(
                  "relative grid w-full place-items-start justify-center rounded-t-[var(--lq-radius)] border-x border-t border-lq-line pt-3",
                  rank === 1 ? "bg-lq-accent text-lq-on-accent" : "bg-lq-surface-2 text-lq-fg"
                )}
                style={{ height: HEIGHTS[rank], transformOrigin: "50% 100%" }}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: isVisible ? 1 : 0 }}
                transition={{ type: "tween", duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <span className="font-lq-mono text-[clamp(1.75rem,7cqmin,5.5rem)] leading-none font-medium">{rank}</span>
                <span className="sr-only">{labels.place(rank)}</span>
              </m.div>
            </li>
          );
        })}
      </ol>

      {shown >= 4 && children ? (
        <m.div className="relative mt-4 w-full" initial={reduced ? false : { y: 16 }} animate={{ y: 0 }} transition={springs.gentle}>
          {children}
        </m.div>
      ) : null}

      {shown < 4 ? (
        <button
          type="button"
          onClick={() => setStep(4)}
          className="focus-ring absolute top-2 right-2 rounded-full border border-lq-line bg-lq-surface px-4 py-2 text-sm font-semibold text-lq-fg hover:bg-lq-surface-2"
        >
          {labels.skip}
        </button>
      ) : null}
    </div>
  );
}
