"use client";

import { useCallback, useRef } from "react";

import { useLqReducedMotion } from "@/components/quiz-kit/motion";
import type { ClockSync } from "@/features/quiz-live/lib/clock-sync";
import type { CountdownValue } from "@/features/quiz-live/lib/countdown";
import type { LiveTimer } from "@/features/quiz-live/lib/protocol";
import { useCountdown } from "@/features/quiz-live/lib/use-live-session";
import { cn } from "@/lib/utils/cn";

const RADIUS = 44;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function quantized(value: CountdownValue): number {
  if (value.stage !== "open" || !value.totalMs) {
    return value.fraction;
  }
  return Math.min(1, (value.seconds * 1000) / value.totalMs);
}

/**
 * Countdown ring anchored on the server deadline. The arc is driven by rAF straight into the SVG
 * (no React render per frame); the number re-renders at most once per second. Reduced motion:
 * the arc moves in discrete one-second steps. A paused timer (host pause) is frozen, drawn in the
 * muted tone and "breathes" slowly (off under reduced motion / calm mode).
 */
export function CountdownRing({
  timer,
  clock,
  size = 96,
  label,
  className,
  showReading = true
}: {
  timer: LiveTimer | null | undefined;
  clock: ClockSync;
  size?: number | string;
  /** Accessible label, e.g. "12 segundos restantes". */
  label: (value: CountdownValue) => string;
  className?: string;
  /** Show the reading-phase countdown inside the ring. */
  showReading?: boolean;
}) {
  const reduced = useLqReducedMotion();
  const arcRef = useRef<SVGCircleElement>(null);
  const onFrame = useCallback(
    (value: CountdownValue) => {
      const arc = arcRef.current;
      if (!arc) {
        return;
      }
      const fraction = reduced ? quantized(value) : value.fraction;
      arc.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - fraction));
    },
    [reduced]
  );
  const value = useCountdown(timer, clock, onFrame);

  if (value.stage === "idle" || value.stage === "untimed") {
    return null;
  }
  const number = value.stage === "reading" ? (showReading ? value.seconds : "") : value.seconds;

  return (
    <div
      role="timer"
      aria-label={label(value)}
      className={cn("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
      data-warning={value.warning || undefined}
      data-paused={value.paused || undefined}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="var(--lq-chart-track)" strokeWidth="8" />
        <circle
          ref={arcRef}
          cx="50"
          cy="50"
          r={RADIUS}
          fill="none"
          stroke={value.paused ? "var(--lq-fg-muted)" : value.warning ? "var(--lq-warning)" : "var(--lq-accent)"}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - value.fraction)}
        />
      </svg>
      <span
        aria-hidden="true"
        className={cn(
          "relative font-lq-mono leading-none font-medium tabular-nums",
          value.paused ? "lq-paused-breathe text-lq-fg-muted" : value.warning ? "lq-warn-pulse text-lq-warning" : "text-lq-fg"
        )}
        style={{ fontSize: `calc(${typeof size === "number" ? `${size}px` : size} * 0.36)` }}
      >
        {number}
      </span>
    </div>
  );
}

/** Thin horizontal timer bar (phone header), same rAF driving. */
export function CountdownBar({ timer, clock, className }: { timer: LiveTimer | null | undefined; clock: ClockSync; className?: string }) {
  const reduced = useLqReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const onFrame = useCallback(
    (value: CountdownValue) => {
      if (barRef.current) {
        barRef.current.style.transform = `scaleX(${reduced ? quantized(value) : value.fraction})`;
      }
    },
    [reduced]
  );
  const value = useCountdown(timer, clock, onFrame);
  if (value.stage === "idle" || value.stage === "untimed") {
    return null;
  }
  return (
    <div aria-hidden="true" className={cn("h-1.5 w-full overflow-hidden rounded-full bg-lq-track", className)}>
      <div
        ref={barRef}
        className={cn("h-full origin-left rounded-full", value.paused ? "lq-paused-breathe bg-lq-fg-muted" : value.warning ? "bg-lq-warning" : "bg-lq-accent")}
        style={{ transform: `scaleX(${value.fraction})` }}
      />
    </div>
  );
}
