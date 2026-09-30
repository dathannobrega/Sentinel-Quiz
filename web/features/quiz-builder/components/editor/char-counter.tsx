"use client";

import { AlertIcon, CircleXIcon } from "@/components/ui/icons";
import type { CharLimitState } from "@/features/quiz-builder/lib/limits";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

/**
 * Live "n of max" counter with the legibility warning and the hard block. Referenced by the field
 * via aria-describedby; the message (not only the colour) carries the state.
 */
export function CharCounter({ id, state, className }: { id: string; state: CharLimitState; className?: string }) {
  const { t } = useI18n();
  const message =
    state.level === "block"
      ? t("quizBuilder.properties.counterBlock", { max: state.max })
      : state.level === "warn" && state.warn !== null
        ? t("quizBuilder.properties.counterWarn", { warn: state.warn })
        : null;
  return (
    <div id={id} className={cn("flex items-start justify-between gap-3 text-xs", className)}>
      <span
        className={cn(
          "flex min-w-0 items-start gap-1.5 leading-snug",
          state.level === "block" ? "font-medium text-danger" : state.level === "warn" ? "text-warning" : "text-fg-muted"
        )}
      >
        {state.level === "block" ? <CircleXIcon size={14} className="mt-px shrink-0" /> : null}
        {state.level === "warn" ? <AlertIcon size={14} className="mt-px shrink-0" /> : null}
        {message}
      </span>
      <span
        className={cn(
          "nums shrink-0 font-mono tabular-nums",
          state.level === "block" ? "font-semibold text-danger" : state.level === "warn" ? "text-warning" : "text-fg-subtle"
        )}
      >
        {t("quizBuilder.properties.counter", { count: state.length, max: state.max })}
      </span>
    </div>
  );
}
