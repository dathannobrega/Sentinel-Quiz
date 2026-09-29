"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

import { buttonClassName, type ButtonSize, type ButtonVariant } from "@/components/ui/button-styles";
import { SpinnerIcon } from "@/components/ui/icons";
import { useOptionalI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils/cn";

export { buttonClassName, type ButtonSize, type ButtonVariant };

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
      {busy ? (
        <>
          <SpinnerIcon />
          {resolvedBusyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
});

Button.displayName = "Button";
