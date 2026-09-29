import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface AuthLayoutProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Secondary content under the form (links, disclosures). */
  footer?: ReactNode;
  busy?: boolean;
  className?: string;
}

/** Narrow, centered column for account flows: one h1, one form, quiet secondary links. */
export function AuthLayout({ title, description, children, footer, busy, className }: AuthLayoutProps) {
  return (
    <main
      aria-busy={busy || undefined}
      className={cn("mx-auto flex w-full max-w-md flex-col gap-8 px-4 pt-12 pb-20 sm:px-6 sm:pt-20", className)}
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.01em] text-fg sm:text-[1.75rem] sm:leading-tight">{title}</h1>
        {description ? <p className="text-[0.9375rem] leading-relaxed text-fg-muted">{description}</p> : null}
      </header>
      {children}
      {footer ? <div className="flex flex-col gap-4 border-t border-line pt-6">{footer}</div> : null}
    </main>
  );
}

/** Inline text link used for secondary auth navigation. */
export const authLinkClassName =
  "focus-ring rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline";
