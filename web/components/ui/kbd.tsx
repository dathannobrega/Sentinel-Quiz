import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

/**
 * Visual keyboard hint. aria-hidden: it must never change a control's accessible name; shortcuts are
 * documented for assistive tech in the shortcuts dialog and the options' description.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-current/30 px-1 font-mono text-[0.6875rem] font-medium",
        className
      )}
    >
      {children}
    </kbd>
  );
}
