"use client";

import { m } from "motion/react";

import { AnimatedNumber } from "@/components/quiz-kit/animated-number";
import { springs, useLqReducedMotion } from "@/components/quiz-kit/motion";
import { OptionBadge, OptionPattern } from "@/components/quiz-kit/option-shape";
import { optionLetter } from "@/features/quiz-live/lib/protocol";
import { cn } from "@/lib/utils/cn";

export interface BarDatum {
  id: string;
  index: number;
  label: string;
  value: number;
  /** true/false after reveal; undefined while hidden or for polls. */
  correct?: boolean;
}

export interface BarChartLabels {
  correct: string;
  summary: (letter: string, text: string, count: number, percent: number, correct: boolean | undefined) => string;
}

function percentOf(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

/** Animated check mark drawn with stroke-dashoffset. */
export function DrawnCheck({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="lq-draw"
        style={{ animationDelay: `${delay}ms` }}
      />
    </svg>
  );
}

/**
 * Vertical answer distribution. Bars are SVG rects grown with a spring (transform only, staggered);
 * counts count up. After reveal the correct bars get a drawn ✓ + "Correta" and the others recede.
 * A visually hidden list carries the same data for screen readers.
 */
export function BarChart({
  bars,
  total,
  revealed = false,
  delay = 0,
  stagger = 0.08,
  labels,
  className,
  showPercent = true
}: {
  bars: BarDatum[];
  /** Denominator for percentages (answered). */
  total: number;
  revealed?: boolean;
  /** Seconds before the bars start growing (reveal suspense). */
  delay?: number;
  stagger?: number;
  labels: BarChartLabels;
  className?: string;
  showPercent?: boolean;
}) {
  const reduced = useLqReducedMotion();
  const max = Math.max(1, ...bars.map((bar) => bar.value));

  return (
    <div className={cn("flex min-h-0 w-full flex-col", className)}>
      <ul className="sr-only">
        {bars.map((bar) => (
          <li key={bar.id}>{labels.summary(optionLetter(bar.index), bar.label, bar.value, percentOf(bar.value, total), revealed ? bar.correct : undefined)}</li>
        ))}
      </ul>
      <div aria-hidden="true" className="flex min-h-0 flex-1 items-stretch justify-center gap-[clamp(0.5rem,2cqw,2.5rem)]">
        {bars.map((bar, position) => {
          const scale = bar.value / max;
          const isCorrect = revealed && bar.correct === true;
          const isWrong = revealed && bar.correct === false;
          const barDelay = reduced ? 0 : delay + position * stagger;
          return (
            <div key={bar.id} className={cn("flex min-w-0 flex-1 basis-0 flex-col items-center gap-2", `lq-slot-${bar.index % 6}`)} style={{ maxWidth: "14rem" }}>
              <div className="flex flex-col items-center font-lq leading-none">
                <AnimatedNumber value={bar.value} from={0} delay={barDelay} className="text-[clamp(1.25rem,3.4cqmin,3rem)] font-extrabold text-lq-fg" />
                {showPercent ? (
                  <span className="mt-1 text-[clamp(0.8rem,1.6cqmin,1.35rem)] font-semibold text-lq-fg-muted">{percentOf(bar.value, total)}%</span>
                ) : null}
              </div>
              <div className="relative w-full min-h-0 flex-1">
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                  <rect x="0" y="0" width="100" height="100" rx="10" fill="var(--lq-chart-track)" opacity={0.55} />
                  <m.rect
                    x="0"
                    y="0"
                    width="100"
                    height="100"
                    rx="10"
                    fill={isWrong ? "color-mix(in srgb, var(--lq-tile) 38%, var(--lq-surface))" : "var(--lq-tile)"}
                    style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: Math.max(scale, bar.value > 0 ? 0.02 : 0) }}
                    transition={{ ...springs.gentle, delay: barDelay }}
                  />
                </svg>
                {isCorrect ? (
                  <m.span
                    className="absolute top-[1.2cqmin] left-1/2 grid size-[clamp(2rem,5cqmin,3.75rem)] -translate-x-1/2 place-items-center rounded-full bg-lq-success text-lq-on-success shadow-[0_0_0_4px_var(--lq-bg)]"
                    initial={{ scale: 0.4 }}
                    animate={{ scale: 1 }}
                    transition={{ ...springs.bouncy, delay: reduced ? 0 : delay + bars.length * stagger + 0.2 }}
                  >
                    <DrawnCheck className="size-[62%]" delay={reduced ? 0 : Math.round((delay + bars.length * stagger + 0.3) * 1000)} />
                  </m.span>
                ) : null}
              </div>
              <div className={cn("lq-tile flex w-full items-center justify-center gap-2 px-2 py-1.5")} data-dim={isWrong || undefined} data-glow={isCorrect || undefined}>
                <OptionBadge index={bar.index} size="sm" />
                {isCorrect ? <span className="text-[clamp(0.75rem,1.4cqmin,1.1rem)] font-bold">{labels.correct}</span> : null}
                <OptionPattern className="inset-x-2 bottom-0.5 h-1.5 rounded-full" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
