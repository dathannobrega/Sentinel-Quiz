"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Largest font size (px) in [min, max] for which `fits(size)` holds, by binary search.
 * Exported for tests.
 */
export function findFittingSize(min: number, max: number, fits: (size: number) => boolean, precision = 0.5): number {
  if (fits(max)) {
    return max;
  }
  let low = min;
  let high = max;
  while (high - low > precision) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return Math.max(min, Math.floor(low * 2) / 2);
}

/**
 * Shrinks long prompts until they fit their box (projector legibility): short prompts render huge,
 * long ones step down to `min`. Measures on resize and when the content changes; writes the size
 * straight to the DOM (one layout per change, no render loop).
 */
export function FitText({
  children,
  className,
  innerClassName,
  min = 18,
  max,
  maxHeightRatio = 0.42,
  maxWidthRatio = 0.075,
  contentKey
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  min?: number;
  /** Upper bound in px; defaults to a fraction of the box. */
  max?: number;
  maxHeightRatio?: number;
  maxWidthRatio?: number;
  /** Change to force a re-measure (e.g. the prompt text). */
  contentKey?: string | number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const box = boxRef.current;
    const text = textRef.current;
    if (!box || !text) {
      return undefined;
    }
    let frame = 0;
    const measure = () => {
      const width = box.clientWidth;
      const height = box.clientHeight;
      if (!width || !height) {
        return;
      }
      const upper = Math.max(min, max ?? Math.min(height * maxHeightRatio, width * maxWidthRatio));
      const size = findFittingSize(min, upper, (candidate) => {
        text.style.fontSize = `${candidate}px`;
        return text.scrollHeight <= height + 1 && text.scrollWidth <= width + 1;
      });
      text.style.fontSize = `${size}px`;
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [min, max, maxHeightRatio, maxWidthRatio, contentKey]);

  return (
    <div ref={boxRef} className={cn("relative min-h-0 min-w-0 overflow-hidden", className)}>
      <div ref={textRef} className={cn("leading-[1.12] text-balance break-words", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
