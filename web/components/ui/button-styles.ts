import { cn } from "@/lib/utils/cn";

/** Pure class builder (no "use client"): usable from server components such as not-found. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "focus-ring inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium " +
  "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-active " +
    "disabled:bg-surface-muted disabled:text-fg-subtle",
  secondary:
    "border border-line-strong bg-surface text-fg hover:border-fg-subtle hover:bg-surface-muted " +
    "disabled:border-line disabled:bg-surface disabled:text-fg-subtle",
  ghost: "text-fg-muted hover:bg-surface-muted hover:text-fg disabled:bg-transparent disabled:text-fg-subtle",
  danger:
    "border border-danger/40 bg-surface text-danger hover:bg-danger-soft disabled:border-line disabled:bg-surface disabled:text-fg-subtle"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[0.9375rem]"
};

/** Class list for elements that must look like a button (e.g. next/link). */
export function buttonClassName(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return cn(base, variants[variant], sizes[size]);
}
