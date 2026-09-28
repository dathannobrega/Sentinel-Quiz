"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

import { useOptionalI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";

const sizeClasses: Record<ButtonSize, string> = {
  md: "sq-button--md",
  sm: "sq-button--sm"
};

export function buttonClassName(variant: ButtonVariant = "primary", size: ButtonSize = "md"): string {
  return cn("sq-button", `sq-button--${variant}`, sizeClasses[size]);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
  /** Text shown while busy. Defaults to the localized "Processing..." label. */
  busyLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, disabled, variant = "primary", size = "md", busy = false, busyLabel, type = "button", ...props },
  ref
) {
  const i18n = useOptionalI18n();
  const resolvedBusyLabel = busyLabel ?? i18n?.t("system.busy") ?? "...";

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(buttonClassName(variant, size), className)}
    >
      {busy ? resolvedBusyLabel : children}
    </button>
  );
});

Button.displayName = "Button";
