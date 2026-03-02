import { forwardRef, type ButtonHTMLAttributes } from "react";

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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, disabled, variant = "primary", size = "md", busy = false, type = "button", ...props },
  ref
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy}
      className={cn(buttonClassName(variant, size), className)}
    >
      {busy ? "Processando..." : children}
    </button>
  );
});

Button.displayName = "Button";
