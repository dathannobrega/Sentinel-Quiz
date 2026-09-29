import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils/cn";

export type BadgeTone = "neutral" | "primary" | "success" | "danger" | "warning";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-fg-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning"
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status label. Use sparingly: only for states the reader must scan for. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        tones[tone],
        className
      )}
    />
  );
}
