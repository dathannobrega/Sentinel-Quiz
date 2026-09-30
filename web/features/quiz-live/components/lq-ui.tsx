"use client";

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

import { SpinnerIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils/cn";

export type LqButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<LqButtonVariant, string> = {
  primary: "bg-lq-accent text-lq-on-accent hover:brightness-110 disabled:brightness-75",
  secondary: "border-[length:max(1px,var(--lq-border-w))] border-lq-line bg-lq-surface text-lq-fg hover:bg-lq-surface-2",
  ghost: "text-lq-fg-muted hover:bg-lq-surface-2 hover:text-lq-fg",
  danger: "border-[length:max(1px,var(--lq-border-w))] border-lq-danger bg-lq-surface text-lq-danger hover:bg-lq-surface-2"
};

/** Live-themed button (≥ 44 px target, press feedback at 0.96). */
export function lqButtonClass(variant: LqButtonVariant = "primary", size: "md" | "lg" = "md"): string {
  return cn(
    "focus-ring inline-flex select-none items-center justify-center gap-2 rounded-[calc(var(--lq-radius)*0.7)] font-lq font-bold",
    "transition-[transform,filter,background-color] duration-150 ease-out active:scale-[0.96] disabled:cursor-not-allowed disabled:active:scale-100",
    size === "lg" ? "min-h-14 px-6 text-lg" : "min-h-11 px-4 text-[0.9375rem]",
    variants[variant]
  );
}

export const LqButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: LqButtonVariant; size?: "md" | "lg"; busy?: boolean; busyLabel?: string }
>(function LqButton({ variant = "primary", size = "md", busy = false, busyLabel, className, children, disabled, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(lqButtonClass(variant, size), className)}
      {...props}
    >
      {busy ? (
        <>
          <SpinnerIcon />
          {busyLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
});

export const lqInputClass =
  "focus-ring block min-h-12 w-full rounded-[calc(var(--lq-radius)*0.6)] border-[length:max(1.5px,var(--lq-border-w))] border-lq-line bg-lq-surface px-4 text-lg text-lq-fg placeholder:text-lq-fg-muted focus:border-lq-accent aria-invalid:border-lq-danger";

export const LqInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function LqInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(lqInputClass, className)} {...props} />;
});

/** Card surface on live screens. */
export const lqCardClass =
  "rounded-[var(--lq-radius)] border-[length:max(1px,var(--lq-border-w))] border-lq-line bg-lq-surface/95 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.6)]";

/** Inline error with icon + text (never colour only). */
export function LqError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={cn("flex items-start gap-2 rounded-[calc(var(--lq-radius)*0.5)] bg-lq-danger px-3 py-2 text-sm font-semibold text-lq-on-danger", className)}>
      <span aria-hidden="true" className="font-lq-mono">!</span>
      <span>{children}</span>
    </p>
  );
}
