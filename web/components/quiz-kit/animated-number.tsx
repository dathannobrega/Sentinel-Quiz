"use client";

import { useEffect, useRef } from "react";
import { animate } from "motion/react";

import { useLqReducedMotion } from "@/components/quiz-kit/motion";
import { useOptionalI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

/**
 * Count-up number. Writes `textContent` directly (no React render per frame). Reduced motion shows
 * the final value instantly. The accessible value is the final one (`aria-label`), never the
 * intermediate frames.
 */
export function AnimatedNumber({
  value,
  from,
  duration = 0.9,
  delay = 0,
  className,
  format,
  prefix = "",
  suffix = ""
}: {
  value: number;
  /** Starting value; defaults to the previously shown value (or 0 on mount). */
  from?: number;
  duration?: number;
  delay?: number;
  className?: string;
  format?: (value: number) => string;
  prefix?: string;
  suffix?: string;
}) {
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "pt-BR";
  const reduced = useLqReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shownRef = useRef<number>(from ?? 0);

  const formatValue = format ?? ((current: number) => new Intl.NumberFormat(locale).format(Math.round(current)));
  const finalText = `${prefix}${formatValue(value)}${suffix}`;

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    // Mutate React's own text node (replacing it via textContent would detach it from React).
    const node = {
      set textContent(text: string) {
        if (element.firstChild) {
          element.firstChild.nodeValue = text;
        } else {
          element.textContent = text;
        }
      }
    };
    const start = from ?? shownRef.current;
    if (reduced || start === value) {
      node.textContent = finalText;
      shownRef.current = value;
      return undefined;
    }
    const controls = animate(start, value, {
      duration,
      delay,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (current) => {
        shownRef.current = current;
        node.textContent = `${prefix}${formatValue(current)}${suffix}`;
      },
      onComplete: () => {
        shownRef.current = value;
      }
    });
    return () => controls.stop();
    // formatValue is derived from locale/format; finalText captures them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, from, duration, delay, reduced, finalText]);

  return (
    <span className={cn("nums", className)}>
      <span className="sr-only">{finalText}</span>
      <span ref={ref} aria-hidden="true">
        {reduced ? finalText : `${prefix}${formatValue(from ?? 0)}${suffix}`}
      </span>
    </span>
  );
}
