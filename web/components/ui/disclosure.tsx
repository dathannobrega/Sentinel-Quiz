"use client";

import { useState, type DetailsHTMLAttributes, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

interface DisclosureProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> {
  summary: ReactNode;
  /** Secondary line under the summary (e.g. a count or state). */
  hint?: ReactNode;
  /** Right-aligned content in the summary row (badges). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  /** "plain" = hairline-separated row (lists); "boxed" = standalone bordered block. */
  variant?: "plain" | "boxed";
  contentClassName?: string;
}

/** Progressive disclosure on native <details>/<summary> (keyboard and screen-reader support built in). */
export function Disclosure({
  summary,
  hint,
  meta,
  defaultOpen = false,
  variant = "boxed",
  className,
  contentClassName,
  children,
  onToggle,
  open: controlledOpen,
  ...props
}: DisclosureProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const open = controlledOpen ?? isOpen;

  return (
    <details
      {...props}
      open={open}
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
      className={cn(
        "group/disclosure",
        variant === "boxed" ? "rounded-lg border border-line bg-surface" : "border-b border-line last:border-b-0",
        className
      )}
    >
      <summary
        className={cn(
          "focus-ring flex list-none items-center gap-3 rounded-lg select-none [&::-webkit-details-marker]:hidden",
          variant === "boxed" ? "px-4 py-3.5 sm:px-5" : "py-3.5"
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-medium text-fg">{summary}</span>
          {hint ? <span className="mt-0.5 block text-[0.8125rem] text-fg-muted">{hint}</span> : null}
        </span>
        {meta ? <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{meta}</span> : null}
        <ChevronDownIcon className="shrink-0 text-fg-subtle transition-transform duration-150 [details[open]>summary>&]:rotate-180" />
      </summary>
      <div className={cn(variant === "boxed" ? "px-4 pb-5 sm:px-5" : "pb-5", contentClassName)}>{children}</div>
    </details>
  );
}
