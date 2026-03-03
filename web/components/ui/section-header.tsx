import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function SectionHeader({ className, title, subtitle, actions, ...props }: SectionHeaderProps) {
  if (!title && !subtitle && !actions) {
    return null;
  }

  return (
    <header {...props} className={cn("sq-section-header", className)}>
      <div>
        {title ? <h2 className="sq-section-title">{title}</h2> : null}
        {subtitle ? <p className="sq-section-subtitle">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}
