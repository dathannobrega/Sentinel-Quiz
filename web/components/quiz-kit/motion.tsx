"use client";

/**
 * Motion policy for live screens (PLANO §9.2, §9.7, §9.8).
 * - `LazyMotion` + `m` keep the bundle small: `domAnimation` on phones, `domMax` (layout/FLIP) on
 *   the stage, loaded asynchronously.
 * - `MotionConfig reducedMotion="user"` honours prefers-reduced-motion; the room's calm mode forces it.
 * - `useLqReducedMotion()` is the single source for JS-driven effects (count-ups, confetti, podium).
 */
import { createContext, useContext, type ReactNode } from "react";
import { LazyMotion, MotionConfig, useReducedMotion } from "motion/react";

/** Springs (visualDuration in s, bounce). */
export const springs = {
  snappy: { type: "spring", visualDuration: 0.25, bounce: 0.15 },
  gentle: { type: "spring", visualDuration: 0.45, bounce: 0.1 },
  bouncy: { type: "spring", visualDuration: 0.5, bounce: 0.35 },
  layout: { type: "spring", visualDuration: 0.5, bounce: 0.2 }
} as const;

/** Durations (s) and curves mirroring the CSS tokens in styles/live-themes.css. */
export const durations = {
  instant: 0.08,
  fast: 0.16,
  base: 0.24,
  slow: 0.42,
  reveal: 0.7,
  epic: 1.2
} as const;

export const easings = {
  out: [0.2, 0.8, 0.2, 1],
  emph: [0.05, 0.7, 0.1, 1],
  exit: [0.3, 0, 0.8, 0.15],
  back: [0.34, 1.56, 0.64, 1]
} as const;

export const staggers = { phone: 0.04, stage: 0.06, maxTotal: 0.4 } as const;

/** Stagger delay for item `index`, capped so a list never takes longer than 400 ms to enter. */
export function staggerDelay(index: number, count: number, step: number): number {
  const effective = count > 1 ? Math.min(step, staggers.maxTotal / (count - 1)) : step;
  return index * effective;
}

const loadDomAnimation = () => import("motion/react").then((module) => module.domAnimation);
const loadDomMax = () => import("motion/react").then((module) => module.domMax);

const CalmContext = createContext(false);

export function LiveMotionProvider({
  children,
  features = "dom",
  calm = false
}: {
  children: ReactNode;
  /** "max" adds layout animations (FLIP leaderboard) — use on the stage. */
  features?: "dom" | "max";
  /** Room calm mode (Z): behaves as reduced motion regardless of the device setting. */
  calm?: boolean;
}) {
  return (
    <CalmContext.Provider value={calm}>
      <LazyMotion features={features === "max" ? loadDomMax : loadDomAnimation} strict>
        <MotionConfig reducedMotion={calm ? "always" : "user"}>{children}</MotionConfig>
      </LazyMotion>
    </CalmContext.Provider>
  );
}

/** True when animations should be replaced by their static alternative. */
export function useLqReducedMotion(): boolean {
  const prefers = useReducedMotion();
  const calm = useContext(CalmContext);
  return calm || Boolean(prefers);
}
