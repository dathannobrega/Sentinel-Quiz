"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";

import { useLqReducedMotion } from "@/components/quiz-kit/motion";
import { cn } from "@/lib/utils/cn";

export type LiveToastTone = "neutral" | "success" | "warning" | "danger";

export interface LiveToastMessage {
  /** Distinct id per toast so the same text can be announced twice. */
  id: number;
  text: string;
  tone: LiveToastTone;
}

const TONES: Record<LiveToastTone, string> = {
  neutral: "border-lq-line bg-lq-surface-2 text-lq-fg",
  success: "border-lq-success bg-lq-surface-2 text-lq-fg",
  warning: "border-lq-warning bg-lq-surface-2 text-lq-fg",
  danger: "border-lq-danger bg-lq-surface-2 text-lq-fg"
};

const MARKS: Record<LiveToastTone, string> = { neutral: "i", success: "✓", warning: "!", danger: "!" };

/** Toast state with auto-dismiss; `show` replaces whatever is on screen. */
export function useLiveToast(durationMs = 4500) {
  const [toast, setToast] = useState<LiveToastMessage | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string, tone: LiveToastTone = "neutral") => {
    counter.current += 1;
    setToast({ id: counter.current, text, tone });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = setTimeout(() => setToast((current) => (current?.id === toast.id ? null : current)), durationMs);
    return () => clearTimeout(timer);
  }, [toast, durationMs]);
  return { toast, show, dismiss };
}

/**
 * Live-themed toast. The polite live region is always mounted (announcements need an existing
 * region); errors use `role="alert"` inside it. Never moves focus.
 */
export function LiveToast({
  toast,
  onDismiss,
  dismissLabel,
  contained = false
}: {
  toast: LiveToastMessage | null;
  onDismiss: () => void;
  dismissLabel: string;
  /** Inside a positioned container (phone preview) instead of the viewport. */
  contained?: boolean;
}) {
  const reduced = useLqReducedMotion();
  return (
    <div aria-live="polite" aria-atomic="true" className={cn(
        "pointer-events-none inset-x-0 z-[60] flex justify-center px-3",
        contained ? "absolute top-3" : "fixed top-[max(0.75rem,env(safe-area-inset-top))]"
      )}>
      <AnimatePresence>
        {toast ? (
          <m.div
            key={toast.id}
            role={toast.tone === "danger" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-[min(92vw,34rem)] items-start gap-3 rounded-[var(--lq-radius)] border-[length:max(1.5px,var(--lq-border-w))] px-4 py-3 text-sm font-semibold shadow-[0_20px_50px_-20px_rgb(0_0_0/0.7)]",
              TONES[toast.tone]
            )}
            initial={reduced ? false : { y: -32, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: -24, opacity: 0 }}
            transition={{ type: "spring", visualDuration: 0.28, bounce: 0.15 }}
          >
            <span aria-hidden="true" className="mt-px font-lq-mono text-xs">
              {MARKS[toast.tone]}
            </span>
            <span className="min-w-0 flex-1">{toast.text}</span>
            <button type="button" onClick={onDismiss} className="focus-ring -my-1 rounded-md px-2 py-1 text-lq-fg-muted hover:text-lq-fg" aria-label={dismissLabel}>
              ✕
            </button>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
